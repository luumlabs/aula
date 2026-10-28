// Del pedido al archivo (port de DocumentComposer.swift): carga el curso, sus lecciones y los subrayados del estudiante, prepara
// el plan y lo escribe en Word o Markdown. El PDF lo dibuja la capa de Electron con la vista de impresión (print.ts).
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DocumentKind, DocumentNote, DocumentPlan, DocumentRequest } from '@shared/documents'
import { DOCUMENT_KINDS } from '@shared/documents'
import type { Pack, Skill, StudyProgress } from '@shared/schema'
import { orderedSkills } from '@shared/schema'
import { AulaError } from '../errors'
import { tr } from '@shared/ai/i18n'
import { getLibrary, listJSONNames, type PackStore } from '../store'
import { renderDocx } from './docx'
import { renderMarkdown, type AssetReader } from './markdown'
import { displayTitle, DocumentError, fileBaseName, planDocument } from './planner'
import { imageFolderName, type RenderedDocument } from './saving'
import { docLang } from './words'

/** Las notas y subrayados de las lecciones (`<curso>/notes/<lección>.json`, formato de la app Swift), por lección. */
export function lessonNotes(store: PackStore, pack: Pack): Record<string, DocumentNote[]> {
  const out: Record<string, DocumentNote[]> = {}
  const order = new Map(orderedSkills(pack).map((s, i) => [s.id, i]))
  const files: { skill: string; title: string; notes: DocumentNote[] }[] = []
  for (const name of listJSONNames(join(store.directory, 'notes'))) {
    try {
      const raw = JSON.parse(readFileSync(join(store.directory, 'notes', `${name}.json`), 'utf8')) as Record<string, unknown>
      const skill = typeof raw.skillID === 'string' && raw.skillID ? raw.skillID : name
      const items = Array.isArray(raw.items) ? raw.items : []
      const notes = items.slice(0, 5000).flatMap((x): DocumentNote[] => {
        if (!x || typeof x !== 'object') return []
        const o = x as Record<string, unknown>
        const excerpt = typeof o.excerpt === 'string' ? Array.from(o.excerpt).slice(0, 600).join('') : ''
        const note = typeof o.note === 'string' && o.note.trim() ? o.note : undefined
        if (!excerpt && !note) return []
        const n: DocumentNote = { excerpt }
        if (note) n.note = note
        if (typeof o.color === 'string') n.color = o.color
        return [n]
      })
      if (notes.length) files.push({ skill, title: typeof raw.skillTitle === 'string' ? raw.skillTitle : '', notes })
    } catch { /* un archivo dañado se salta */ }
  }
  files.sort((a, b) => (order.get(a.skill) ?? 1e9) - (order.get(b.skill) ?? 1e9) || a.title.localeCompare(b.title))
  for (const f of files) out[f.skill] = f.notes
  return out
}

export interface CourseBundle {
  store: PackStore
  pack: Pack
  skills: Record<string, Skill>
  progress: StudyProgress
}

/** El curso de la petición (o undefined si no tiene). Lanza `not_found` si se pidió uno que no existe. */
export function loadCourse(courseID: string | undefined): CourseBundle | undefined {
  if (!courseID) return undefined
  const store = getLibrary().openPack(courseID)
  if (!store) throw new AulaError('not_found', tr('Ese curso no existe.', 'That course doesn’t exist.'))
  const pack = store.loadPack()
  const skills: Record<string, Skill> = {}
  for (const s of store.loadSkills(pack.skills.map((r) => r.id))) skills[s.id] = s
  return { store, pack, skills, progress: store.loadProgress() }
}

/** El plan del documento con el curso ya cargado desde disco. */
export function planFor(request: DocumentRequest, now = new Date()): { plan: DocumentPlan; course?: CourseBundle } {
  const course = loadCourse(request.courseID)
  const notes = course && request.kind === 'guide' && request.style.includeNotes ? lessonNotes(course.store, course.pack) : {}
  const plan = planDocument(request, { pack: course?.pack, skills: course?.skills ?? {}, progress: course?.progress, notes, now })
  return { plan, course }
}

/** Los tipos de documento que no salen de este curso y estas lecciones, con el motivo (el de `DocumentError`, en el idioma del
 *  documento): un curso sin tarjetas no tiene tarjetas para imprimir. El mismo plan que la vista previa, sin dibujar nada. */
export function unavailableKinds(request: DocumentRequest, now = new Date()): Partial<Record<DocumentKind, string>> {
  const course = loadCourse(request.courseID)
  const notes = course && request.style.includeNotes ? lessonNotes(course.store, course.pack) : {}
  const out: Partial<Record<DocumentKind, string>> = {}
  for (const kind of DOCUMENT_KINDS) {
    try {
      planDocument({ ...request, kind }, { pack: course?.pack, skills: course?.skills ?? {}, progress: course?.progress, notes: kind === 'guide' ? notes : {}, now })
    } catch (err) {
      if (!(err instanceof DocumentError)) throw err
      out[kind] = err.message
    }
  }
  return out
}

/** Lee las imágenes del curso (`assets/<id>`) para Word y Markdown. */
export function assetReader(store: PackStore | undefined): AssetReader {
  return (asset) => {
    const p = store?.assetPath(asset)
    if (!p) return undefined
    try { return { name: basename(p), data: new Uint8Array(readFileSync(p)) } } catch { return undefined }
  }
}

/** El documento en Word o Markdown (el PDF lo dibuja print.ts). */
export async function renderDocument(plan: DocumentPlan, store: PackStore | undefined, format: 'docx' | 'markdown'): Promise<RenderedDocument> {
  const base = fileBaseName(plan)
  const lang = docLang(plan.lang)
  const common = { pages: 0, title: displayTitle(plan), kind: plan.request.kind, baseName: base, ...(plan.packId ? { courseID: plan.packId } : {}) }
  if (format === 'docx') return { ...common, data: await renderDocx(plan, assetReader(store)), format: 'docx', attachments: [] }
  const md = renderMarkdown(plan, imageFolderName(base, lang), assetReader(store))
  return { ...common, data: new TextEncoder().encode(md.text), format: 'markdown', attachments: md.images }
}
