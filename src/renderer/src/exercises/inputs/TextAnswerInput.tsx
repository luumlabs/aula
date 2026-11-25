// Respuesta escrita: número (con unidad y coma decimal), expresión, ecuación, conjunto, intervalo, punto, respuesta corta
// y química. Con la vista previa de lo que entiende Aula («Así lo leo», KaTeX/mhchem) y una barra de símbolos
// (fracción, raíz, potencia, π, ±, ≤, flechas de reacción…) que escribe donde está el cursor. Las de matemáticas y química
// son de una línea. La corta crece hasta seis líneas (una lista, unos pasos): Intro comprueba, como siempre; Mayús+Intro
// hace un salto de línea y lo pegado conserva los suyos.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Answer } from '@shared/schema/exercises'
import { RichText } from '@renderer/lib/RichText'
import { canAutoFocus, cx, InkStrike, Tooltip, useTouchOnly } from '@renderer/design'
import { answerInputMode, keysFor, type AnswerKey } from '../keys'
import { api } from '@renderer/lib/api'
import { signedNumberKeyboard } from '@renderer/lib/device'
import { chemTex, insertAt, mathPreview, previewIsUseful, usesDecimalComma } from '../normalize'
import { Tex } from '../ui'
import { partTone, type InputProps } from './shared'
import type { GradeResult } from '../types'
import { answerField, enterAction } from './answerField'
import { StruckLines } from './StruckLines'

/** El campo que crece: una línea de la misma altura que el de una línea (h-12, 3rem) y hasta seis (luego desplaza). Su
 *  relleno y su letra, que también lleva la copia del tachado de varias líneas para partir los renglones igual. El texto
 *  de ejemplo, en una línea (cortado), como en el campo de una línea: partido en varias, haría crecer el campo vacío. */
const AREA_TEXT = 'px-4 py-[calc((3rem-26px)/2)] text-[17px] leading-[24px] tabular'
const AREA_BOX = 'min-h-12 max-h-[calc(3rem+120px)] resize-none overflow-y-hidden placeholder:truncate'

type TextKind = Extract<Answer['kind'], 'numeric' | 'expression' | 'equation' | 'set' | 'interval' | 'point' | 'short' | 'chem' | 'unknown'>

interface Spec {
  placeholder: string
  prefix?: string
  suffix?: string
  preview: 'math' | 'chem' | 'none'
  note?: string
  /** La barra de símbolos se abre sola (expresiones, ecuaciones, intervalos, química). */
  keysOpen: boolean
}

function useSpec(answer: Answer): Spec {
  const { t } = useTranslation('study')
  switch (answer.kind) {
    case 'numeric':
      return { placeholder: answer.placeholder ?? t('ex.ph.answer'), prefix: answer.prefix, suffix: answer.suffix ?? answer.unit, preview: 'math', keysOpen: false }
    case 'expression':
      return { placeholder: answer.placeholder ?? t('ex.ph.expression'), prefix: answer.prefix, preview: 'math', keysOpen: true }
    case 'equation':
      return { placeholder: t('ex.ph.equation'), preview: 'math', note: t('ex.note.equation'), keysOpen: true }
    case 'set':
      return { placeholder: answer.placeholder ?? t('ex.ph.set'), preview: 'math', keysOpen: false }
    case 'interval':
      return { placeholder: t('ex.ph.interval'), preview: 'math', keysOpen: true }
    case 'point':
      return { placeholder: t('ex.ph.point'), preview: 'math', note: t('ex.note.point'), keysOpen: false }
    case 'chem':
      switch (answer.mode) {
        case 'formula': return { placeholder: t('ex.ph.chemFormula'), preview: 'chem', note: t('ex.note.chemFormula'), keysOpen: true }
        case 'equation': return { placeholder: t('ex.ph.chemEquation'), preview: 'chem', note: t('ex.note.chemEquation'), keysOpen: true }
        case 'name': return { placeholder: t('ex.ph.chemName'), preview: 'none', note: t('ex.note.chemName'), keysOpen: false }
        case 'number': return { placeholder: t('ex.ph.value'), suffix: answer.unit, preview: 'none', note: answer.sigFigs ? t('ex.note.sigFigs', { count: answer.sigFigs }) : undefined, keysOpen: false }
        case 'configuration': return { placeholder: t('ex.ph.chemConfig'), preview: 'chem', note: t('ex.note.chemConfig'), keysOpen: true }
      }
      break
    case 'short':
      return { placeholder: answer.placeholder ?? t('ex.ph.answer'), preview: 'none', keysOpen: false }
    default:
      break
  }
  return { placeholder: t('ex.ph.answer'), preview: 'none', keysOpen: false }
}

const KEYS_PREF = 'aula.study.symbolKeys'
function readKeysPref(): boolean | null {
  try {
    const v = localStorage.getItem(KEYS_PREF)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

export function TextAnswerInput(props: InputProps<Extract<Answer, { kind: TextKind }>>) {
  const { answer, draft, set, locked, reveal, result, lang, onSubmit, autoFocus, exam, exerciseId } = props
  const { t, i18n } = useTranslation('study')
  // los mensajes del analizador matemático están en español (aún sin catálogo en inglés)
  const spanish = i18n.language.startsWith('es')
  const spec = useSpec(answer)
  // la respuesta corta puede ocupar varias líneas (una lista, una definición con pasos); las de números y fórmulas, una
  const multiline = answer.kind === 'short'
  const line = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const field = (): HTMLInputElement | HTMLTextAreaElement | null => area.current ?? line.current
  const keys = useMemo(() => keysFor(answer), [answer])
  const [keysOpen, setKeysOpen] = useState(() => readKeysPref() ?? spec.keysOpen)
  const comma = usesDecimalComma(lang)
  const text = draft.text
  const hintId = useId()
  // con teclado, el lector de pantalla avisa de Mayús+Intro; con el dedo no hay esa tecla (Intro comprueba, como en el chat)
  const touch = useTouchOnly()
  const keysHint = multiline && !locked && !touch

  useEffect(() => {
    // al volver a intentarlo, la respuesta anterior queda seleccionada: lo que escribas la sustituye
    // con el dedo no: sacaría el teclado al llegar a cada pregunta (se escribe al tocar el campo)
    if (autoFocus && !locked && canAutoFocus()) requestAnimationFrame(() => { field()?.focus({ preventScroll: true }); field()?.select() })
  }, [autoFocus, locked])

  // el campo que crece se mide con lo escrito: de una línea a seis y, después, desplaza (la barra, solo si no cabe)
  const [grown, setGrown] = useState(false)
  const grow = useCallback((): void => {
    const el = area.current
    if (!el) {
      setGrown(false)
      return
    }
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const one = parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    // vacío, una línea sin medir: Chromium cuenta el texto de ejemplo (partido) y el campo saltaría al escribir y al borrar
    const inner = el.value ? el.scrollHeight : one
    const want = inner + el.offsetHeight - el.clientHeight
    const max = parseFloat(cs.maxHeight)
    el.style.height = `${want}px`
    el.style.overflowY = want > max + 0.5 ? 'auto' : 'hidden'
    // ¿más de una línea? (un salto escrito o un texto que no cabe y se parte): el tachado va renglón a renglón
    setGrown(inner > one + 1)
  }, [])
  useLayoutEffect(grow, [grow, text, multiline])
  useEffect(() => {
    // otro ancho (la ventana, el tutor al lado, girar el teléfono) o el tamaño del texto: se vuelve a medir
    const el = area.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; grow() })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [grow, multiline])

  const preview = useMemo(() => {
    if (!text.trim()) return null
    if (spec.preview === 'chem' && answer.kind === 'chem') {
      const tex = chemTex(text, answer.mode)
      return tex ? { tex } : null
    }
    if (spec.preview === 'math') {
      const p = mathPreview(text, answer, comma)
      if (p.tex && !previewIsUseful(text, p.tex)) return null
      return p.tex || p.error ? p : null
    }
    return null
  }, [text, spec.preview, answer, comma])

  const insert = (k: AnswerKey): void => {
    const el = field()
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const r = insertAt(text, start, end, k.insert, k.caretBack)
    set((d) => ({ ...d, text: r.value }))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(r.caret, r.caret)
    })
  }

  const toggleKeys = (): void => {
    setKeysOpen((v) => {
      try {
        localStorage.setItem(KEYS_PREF, v ? '0' : '1')
      } catch {
        /* sin almacenamiento */
      }
      return !v
    })
  }

  const tone = !exam && reveal !== 'none' ? partTone(result) : undefined
  // lo que se comprobó: mientras no cambie, un error se queda tachado a mano en el campo (el boli rojo de quien corrige);
  // al escribir otra cosa, el tachado se va
  const [graded, setGraded] = useState<{ r: GradeResult | undefined; text: string }>({ r: result, text })
  if (graded.r !== result) setGraded({ r: result, text })
  const struck = tone !== undefined && result?.status === 'incorrect' && text.trim() !== '' && text === graded.text
  // incorrecto: una sola señal (el tachado y la nota de debajo), sin borde rojo ni fondo rosa
  const fieldTone = struck || result?.status === 'incorrect' ? undefined : tone
  const wide = answer.kind === 'equation' || answer.kind === 'expression' || answer.kind === 'interval' || answer.kind === 'set' || (answer.kind === 'chem' && answer.mode !== 'number') || answer.kind === 'short'
  const seed = `respuesta:${exerciseId}:${text}`

  // lo común a los dos campos (el de una línea y el que crece)
  const fieldProps = {
    ...answerField,
    value: text,
    readOnly: locked,
    spellCheck: answer.kind === 'short' || (answer.kind === 'chem' && answer.mode === 'name'),
    autoComplete: 'off',
    // un número exacto (√3/3, −1/2) se escribe con el teclado entero: el decimal no tiene «−» ni «/» (keys.ts)
    inputMode: answerInputMode(answer, signedNumberKeyboard(api.platform)),
    'aria-label': t('ex.yourAnswer'),
    'aria-invalid': struck || undefined,
    placeholder: spec.placeholder,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => set((d) => ({ ...d, text: e.target.value })),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      if (locked || enterAction(e.nativeEvent, multiline) !== 'check') return
      e.preventDefault()
      onSubmit()
    },
    className: cx(
      'w-full rounded-[14px] border bg-field text-text outline-none transition placeholder:text-text3',
      'focus:shadow-[0_0_0_3px_var(--accent-wash)]',
      multiline ? cx(AREA_TEXT, AREA_BOX) : 'h-12 px-4 text-[17px] tabular',
      keys.length > 0 && 'pr-12',
      locked && 'cursor-default'
    ),
    style: { borderColor: fieldTone ? `color-mix(in oklab, ${fieldTone} 60%, transparent)` : 'color-mix(in oklab, var(--line-strong) 40%, transparent)', background: fieldTone ? `color-mix(in oklab, ${fieldTone} 6%, var(--field))` : undefined, color: struck ? 'var(--text2)' : undefined }
  }

  return (
    // el campo, su vista previa y la fila de símbolos: con el teclado abierto se ven enteros (study/Chrome.tsx)
    <div data-answer-block className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {spec.prefix && (
          <span className="t-reading text-text shrink-0">
            <RichText text={spec.prefix} inline />
          </span>
        )}
        <div className={cx('relative flex items-center', wide ? 'min-w-[240px] flex-1' : 'w-[260px] max-w-full')}>
          {multiline ? (
            // Intro hace lo del botón principal (su pista lo dice); Mayús+Intro, salto de línea: el lector de pantalla lo avisa
            <textarea {...fieldProps} ref={area} rows={1} aria-multiline aria-describedby={keysHint ? hintId : undefined} />
          ) : (
            <input {...fieldProps} ref={line} />
          )}
          {/* oculto: solo se lee como descripción del campo (ni se repite al recorrer la página ni se copia al seleccionar) */}
          {keysHint && <span id={hintId} hidden>{t('ex.shortKeys')}</span>}
          {struck && !grown && (
            // el mismo texto, invisible y en la misma letra, para que el tachado mida lo escrito
            <span aria-hidden dir="auto" className={cx('pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-hidden whitespace-pre px-4 text-[17px] tabular text-transparent', keys.length > 0 ? 'right-12' : 'right-0')}>
              <InkStrike seed={seed} alpha={0.9}>{text}</InkStrike>
            </span>
          )}
          {/* lo escrito en varias líneas se tacha renglón a renglón */}
          {struck && grown && <StruckLines field={area} text={text} seed={seed} className={cx(AREA_TEXT, keys.length > 0 && 'pr-12')} />}
          {keys.length > 0 && !locked && (
            <Tooltip label={keysOpen ? t('ex.hideKeys') : t('ex.showKeys')}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleKeys}
                aria-pressed={keysOpen}
                aria-label={keysOpen ? t('ex.hideKeys') : t('ex.showKeys')}
                className={cx('absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[9px] font-serif text-[14px] transition-colors', keysOpen ? 'bg-accent-wash text-accent-text' : 'text-text3 hover:bg-fill1 hover:text-text')}
              >
                √π
              </button>
            </Tooltip>
          )}
        </div>
        {spec.suffix && <span className="t-reading text-text2 shrink-0"><RichText text={spec.suffix} inline /></span>}
      </div>

      <AnimatePresence initial={false}>
        {preview && !locked && (
          <motion.div key="pv" className="flex min-h-[30px] flex-wrap items-center gap-x-2 gap-y-1 pl-1" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <span className="t-footnote text-text3 shrink-0">{t('ex.readAs')}</span>
            {preview.tex ? <Tex tex={`\\displaystyle ${preview.tex}`} className="text-[17px] text-text" /> : <span className="t-footnote text-text3">{(spanish && preview.error) || t('ex.notUnderstood')}</span>}
            {preview.note && spanish && <span className="t-footnote text-text3">· {preview.note}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {keysOpen && keys.length > 0 && !locked && (
          <motion.div
            key="keys"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div role="toolbar" aria-label={t('ex.showKeys')} className="flex flex-wrap items-center gap-1 rounded-[14px] bg-sunken p-1.5">
              {keys.map((group, gi) => (
                <div key={gi} className={cx('flex flex-wrap items-center gap-1', gi > 0 && 'border-l-[0.5px] border-line pl-1.5 ml-0.5')}>
                  {group.map((k) => (
                    <Tooltip key={k.label + k.insert} label={t(`keys.${k.help}`, { name: k.label })}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insert(k)}
                        aria-label={t(`keys.${k.help}`, { name: k.label })}
                        className={cx('h-8 min-w-[34px] rounded-[9px] px-2 text-text transition-colors hover:bg-fill2 active:bg-fill3', k.plain ? 'text-[13px] font-medium' : 'font-serif text-[16px]')}
                      >
                        {k.label}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {spec.note && !locked && <div className="t-footnote text-text3 pl-1">{spec.note}</div>}
    </div>
  )
}
