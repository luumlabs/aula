// El menú del clic derecho: qué ofrece con texto seleccionado, en los campos y en los enlaces; qué quita en el simulacro y en
// los campos de respuesta; y que lo que sale hacia la web va limpio, recortado y solo por https.
import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import {
  buildContextMenuTemplate,
  cleanQuery,
  createContextGuard,
  FIELD_NOTICE_MS,
  MAX_QUERY,
  searchURL,
  translateTarget,
  translateURL,
  type ContextActions,
  type ContextOptions,
  type ContextTarget
} from './context-menu'

const target = (p: Partial<ContextTarget> = {}): ContextTarget => ({
  selectionText: '',
  isEditable: false,
  linkURL: '',
  misspelledWord: '',
  dictionarySuggestions: [],
  editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
  ...p
})
const opts = (o: Partial<ContextOptions> = {}): ContextOptions => ({ lang: 'es', platform: 'darwin', exam: false, exerciseField: false, translateTo: 'es', ...o })
const actions = () => ({
  lookUp: vi.fn<ContextActions['lookUp']>(),
  openExternal: vi.fn<ContextActions['openExternal']>(),
  replaceMisspelling: vi.fn<ContextActions['replaceMisspelling']>(),
  copyText: vi.fn<ContextActions['copyText']>()
})
const labels = (items: MenuItemConstructorOptions[]): string[] => items.map((i) => (i.type === 'separator' ? '—' : (i.label ?? '')))
const click = (items: MenuItemConstructorOptions[], label: string): void => {
  const item = items.find((i) => i.label === label)
  if (!item?.click) throw new Error(`sin «${label}»`)
  ;(item.click as () => void)()
}
const field = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

describe('menú del clic derecho', () => {
  it('sin selección, ni campo, ni enlace: ningún menú', () => {
    expect(buildContextMenuTemplate(target(), opts(), actions())).toEqual([])
    expect(buildContextMenuTemplate(target({ selectionText: '  \n ' }), opts(), actions())).toEqual([])
  })

  it('con texto seleccionado en macOS: copiar, consultar, traducir y buscar', () => {
    const items = buildContextMenuTemplate(target({ selectionText: 'fotosíntesis' }), opts(), actions())
    expect(labels(items)).toEqual(['Copiar', '—', 'Consultar “fotosíntesis”', 'Traducir', 'Buscar en la web'])
    expect(items[0].role).toBe('copy')
  })

  it('en inglés, y sin «Consultar» fuera de macOS', () => {
    expect(labels(buildContextMenuTemplate(target({ selectionText: 'photosynthesis' }), opts({ lang: 'en', platform: 'darwin' }), actions()))).toEqual([
      'Copy', '—', 'Look Up “photosynthesis”', 'Translate', 'Search the web'
    ])
    for (const platform of ['win32', 'linux'] as const)
      expect(labels(buildContextMenuTemplate(target({ selectionText: 'x' }), opts({ platform }), actions()))).toEqual(['Copiar', '—', 'Traducir', 'Buscar en la web'])
  })

  it('«Consultar» recorta una selección larga y la consulta la hace el sistema', () => {
    const act = actions()
    const items = buildContextMenuTemplate(target({ selectionText: 'la fotosíntesis es el proceso\npor el que las plantas' }), opts(), act)
    expect(items[2].label).toBe('Consultar “la fotosíntesis es el p…”')
    click(items, items[2].label as string)
    expect(act.lookUp).toHaveBeenCalledOnce()
  })

  it('traducir y buscar abren la web por https con el texto limpio', () => {
    const act = actions()
    const items = buildContextMenuTemplate(target({ selectionText: '  ácido   desoxirribonucleico\n' }), opts({ translateTo: 'en' }), act)
    click(items, 'Traducir')
    click(items, 'Buscar en la web')
    const [tr, se] = act.openExternal.mock.calls.map((c) => new URL(c[0] as string))
    expect(tr.protocol).toBe('https:')
    expect(tr.host).toBe('translate.google.com')
    expect(tr.searchParams.get('sl')).toBe('auto')
    expect(tr.searchParams.get('tl')).toBe('en')
    expect(tr.searchParams.get('text')).toBe('ácido desoxirribonucleico')
    expect(se.protocol).toBe('https:')
    expect(se.host).toBe('duckduckgo.com')
    expect(se.searchParams.get('q')).toBe('ácido desoxirribonucleico')
  })

  it('en el simulacro solo copiar', () => {
    expect(labels(buildContextMenuTemplate(target({ selectionText: 'enunciado' }), opts({ exam: true }), actions()))).toEqual(['Copiar'])
  })

  it('en un campo: cortar, copiar, pegar y seleccionar todo, según lo que se pueda', () => {
    const items = buildContextMenuTemplate(target({ isEditable: true, editFlags: { ...field, canCut: false, canCopy: false } }), opts(), actions())
    expect(labels(items)).toEqual(['Cortar', 'Copiar', 'Pegar', '—', 'Seleccionar todo'])
    expect(items.map((i) => i.role).filter(Boolean)).toEqual(['cut', 'copy', 'paste', 'selectAll'])
    expect(items.map((i) => i.enabled)).toEqual([false, false, true, undefined, true])
  })

  it('las sugerencias de ortografía van arriba y cambian la palabra', () => {
    const act = actions()
    const items = buildContextMenuTemplate(
      target({ isEditable: true, editFlags: field, misspelledWord: 'fotosintesis', dictionarySuggestions: ['fotosíntesis', 'a', 'b', 'c', 'd', 'e'] }),
      opts(),
      act
    )
    expect(labels(items)).toEqual(['fotosíntesis', 'a', 'b', 'c', 'd', '—', 'Cortar', 'Copiar', 'Pegar', '—', 'Seleccionar todo'])
    click(items, 'fotosíntesis')
    expect(act.replaceMisspelling).toHaveBeenCalledWith('fotosíntesis')
  })

  it('en un campo de respuesta de un ejercicio: ni ortografía ni consultas (darían la respuesta)', () => {
    const p = target({ isEditable: true, editFlags: field, selectionText: 'Hund', misspelledWord: 'Hund', dictionarySuggestions: ['Hund'] })
    expect(labels(buildContextMenuTemplate(p, opts({ exerciseField: true }), actions()))).toEqual(['Cortar', 'Copiar', 'Pegar', '—', 'Seleccionar todo'])
    // en un campo cualquiera (el chat), sí
    expect(labels(buildContextMenuTemplate(p, opts(), actions()))).toEqual([
      'Hund', '—', 'Cortar', 'Copiar', 'Pegar', '—', 'Seleccionar todo', '—', 'Consultar “Hund”', 'Traducir', 'Buscar en la web'
    ])
  })

  it('en el simulacro, en los campos: editar sin ortografía', () => {
    const p = target({ isEditable: true, editFlags: field, selectionText: 'x', misspelledWord: 'x', dictionarySuggestions: ['y'] })
    expect(labels(buildContextMenuTemplate(p, opts({ exam: true }), actions()))).toEqual(['Cortar', 'Copiar', 'Pegar', '—', 'Seleccionar todo'])
  })

  it('en un enlace web: copiar el enlace (las citas internas y otras direcciones, no)', () => {
    const act = actions()
    const items = buildContextMenuTemplate(target({ linkURL: 'https://es.wikipedia.org/wiki/Fotos%C3%ADntesis' }), opts(), act)
    expect(labels(items)).toEqual(['Copiar enlace'])
    click(items, 'Copiar enlace')
    expect(act.copyText).toHaveBeenCalledWith('https://es.wikipedia.org/wiki/Fotos%C3%ADntesis')
    for (const linkURL of ['app://aula/index.html#aula-page-3', 'file:///etc/passwd', 'javascript:alert(1)'])
      expect(buildContextMenuTemplate(target({ linkURL }), opts(), actions())).toEqual([])
  })
})

describe('lo que sale hacia la web', () => {
  it('recorta a ~500 caracteres sin partir un emoji y quita espacios y saltos de más', () => {
    expect(cleanQuery('  a\n\n b\tc  ')).toBe('a b c')
    const long = '😀'.repeat(MAX_QUERY + 20)
    const out = cleanQuery(long)
    expect(Array.from(out)).toHaveLength(MAX_QUERY)
    expect(out).toBe('😀'.repeat(MAX_QUERY))
    const tr = new URL(translateURL('x'.repeat(5000), 'es'))
    expect(tr.searchParams.get('text')).toHaveLength(MAX_QUERY)
    expect(new URL(searchURL('y'.repeat(5000))).searchParams.get('q')).toHaveLength(MAX_QUERY)
  })

  it('el texto va como parámetro, sin poder cambiar la dirección', () => {
    const u = new URL(searchURL('a&b=c #x /../evil?'))
    expect(u.origin).toBe('https://duckduckgo.com')
    expect(u.pathname).toBe('/')
    expect(u.hash).toBe('')
    expect(u.searchParams.get('q')).toBe('a&b=c #x /../evil?')
    expect([...u.searchParams.keys()]).toEqual(['q'])
  })

  it('traduce al idioma del sistema del estudiante', () => {
    expect(translateTarget(['es-ES', 'en-US'])).toBe('es')
    expect(translateTarget(['pt_BR'])).toBe('pt')
    expect(translateTarget(['zh-Hans-CN'])).toBe('zh-CN')
    expect(translateTarget(['zh-Hant-TW'])).toBe('zh-TW')
    expect(translateTarget(['zh-HK'])).toBe('zh-TW')
    expect(translateTarget(['', 'de-DE'])).toBe('de')
    expect(translateTarget([])).toBe('en')
    expect(translateTarget(['???'], 'es')).toBe('es')
  })
})

describe('avisos de la interfaz para el menú', () => {
  it('el simulacro vale hasta que se cierra o la página se recarga', () => {
    const g = createContextGuard(() => 0)
    expect(g.take()).toEqual({ exam: false, exerciseField: false })
    g.setExam(true)
    expect(g.take().exam).toBe(true)
    expect(g.take().exam).toBe(true)
    g.setExam(false)
    expect(g.take().exam).toBe(false)
    g.setExam(true)
    g.reset()
    expect(g.take().exam).toBe(false)
  })

  it('el campo de respuesta vale solo para el menú que se abre justo después', () => {
    let now = 1000
    const g = createContextGuard(() => now)
    g.markAnswerField(true)
    now += 20
    expect(g.take().exerciseField).toBe(true)
    // gastado: el siguiente menú (en otro sitio) ya no lo hereda
    expect(g.take().exerciseField).toBe(false)
    g.markAnswerField(true)
    now += FIELD_NOTICE_MS + 1
    expect(g.take().exerciseField).toBe(false)
    g.markAnswerField(true)
    g.markAnswerField(false)
    expect(g.take().exerciseField).toBe(false)
  })
})
