// A3-P1-3: el formulario de «Nuevo curso» es un borrador que sobrevive a la navegación y a cerrar Aula.
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_FORM, formFromPrefill, hasDraftContent, restoreForm } from './draftStore'

describe('borrador de Nuevo curso (A3-P1-3)', () => {
  it('lo guardado se recupera campo a campo y lo roto no rompe nada', () => {
    const f = restoreForm({
      title: 'Química orgánica', date: '2026-11-12', level: 'university', topics: 'Alcanos', examNotes: 'Tipo test', more: true, depth: 'deep', web: false, verify: false,
      lessonMode: 'read', pickedLanguage: 'en', draftId: 'draft-abc123def4', official: ['m1', 3], gather: 'auto', pending: { mode: 'text', value: 'Apuntes largos…' }, eventId: 'own:x'
    })
    expect(f).toMatchObject({ title: 'Química orgánica', date: '2026-11-12', depth: 'deep', web: false, verify: false, lessonMode: 'read', draftId: 'draft-abc123def4', official: ['m1'], pending: { mode: 'text', value: 'Apuntes largos…' }, eventId: 'own:x' })
    expect(restoreForm('nada')).toEqual(EMPTY_FORM)
    expect(restoreForm({ date: 'mañana', depth: 'enorme', lessonMode: 'x', draftId: '../../etc', pending: { mode: 'raro', value: 'x' } })).toMatchObject({ date: '', depth: 'standard', lessonMode: 'stepByStep', pending: { mode: 'none', value: '' } })
    expect(restoreForm({ draftId: '../../etc' }).draftId).toBeUndefined()
  })

  it('sabe si hay algo que perder', () => {
    expect(hasDraftContent(EMPTY_FORM, [])).toBe(false)
    expect(hasDraftContent({ ...EMPTY_FORM, title: '  ' }, [])).toBe(false)
    expect(hasDraftContent({ ...EMPTY_FORM, title: 'Física' }, [])).toBe(true)
    expect(hasDraftContent(EMPTY_FORM, [{ id: 'm1' }])).toBe(true)
    expect(hasDraftContent({ ...EMPTY_FORM, pending: { mode: 'text', value: 'notas' } }, [])).toBe(true)
  })

  it('una propuesta de la ruta deja su formulario', () => {
    expect(formFromPrefill({ title: 'Parcial 2', examDate: '2026-11-03T09:00:00.000Z', topics: 'Límites', eventId: 'ev1', fromPlatform: true }, 'k')).toMatchObject({
      title: 'Parcial 2', date: '2026-11-03', topics: 'Límites', more: true, gather: 'auto', eventId: 'ev1', prefillKey: 'k'
    })
  })

  it('el store sobrevive a «salir de la pantalla» y se guarda en este ordenador', async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
    vi.resetModules()
    const { useCreateDraft } = await import('./draftStore')
    useCreateDraft.getState().set({ title: 'Termodinámica', draftId: 'draft-0123456789', pending: { mode: 'text', value: 'notas' } })
    useCreateDraft.getState().set({ materials: [{ id: 'm1', title: 'Tema 1', kind: 'pdf', pages: 3, characters: 10, status: 'ready', official: false, warnings: [] }] })
    // otra «sesión» (Aula cerrada y abierta): el formulario vuelve; los materiales los da el proceso principal
    vi.resetModules()
    const again = await import('./draftStore')
    expect(again.useCreateDraft.getState()).toMatchObject({ title: 'Termodinámica', draftId: 'draft-0123456789', pending: { mode: 'text', value: 'notas' }, materials: [] })
    // empezar de cero lo borra también de aquí
    again.useCreateDraft.getState().reset()
    expect(mem.size).toBe(0)
    expect(again.useCreateDraft.getState().title).toBe('')
    vi.unstubAllGlobals()
  })
})
