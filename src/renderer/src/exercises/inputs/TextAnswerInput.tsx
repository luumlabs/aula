// Respuesta escrita: número (con unidad y coma decimal), expresión, ecuación, conjunto, intervalo, punto, respuesta corta
// y química. Con la vista previa de lo que entiende Aula («Así lo leo», KaTeX/mhchem) y una barra de símbolos
// (fracción, raíz, potencia, π, ±, ≤, flechas de reacción…) que escribe donde está el cursor.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import type { Answer } from '@shared/schema/exercises'
import { RichText } from '@renderer/lib/RichText'
import { cx, Tooltip } from '@renderer/design'
import { keysFor, type AnswerKey } from '../keys'
import { chemTex, insertAt, mathPreview, previewIsUseful, usesDecimalComma } from '../normalize'
import { Tex } from '../ui'
import { partTone, type InputProps } from './shared'

type TextKind = Extract<Answer['kind'], 'numeric' | 'expression' | 'equation' | 'set' | 'interval' | 'point' | 'short' | 'chem' | 'unknown'>

interface Spec {
  placeholder: string
  prefix?: string
  suffix?: string
  preview: 'math' | 'chem' | 'none'
  note?: string
  numeric?: boolean
  /** La barra de símbolos se abre sola (expresiones, ecuaciones, intervalos, química). */
  keysOpen: boolean
}

function useSpec(answer: Answer): Spec {
  const { t } = useTranslation('study')
  switch (answer.kind) {
    case 'numeric':
      return { placeholder: answer.placeholder ?? t('ex.ph.answer'), prefix: answer.prefix, suffix: answer.suffix ?? answer.unit, preview: 'math', numeric: true, keysOpen: false }
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
        case 'number': return { placeholder: t('ex.ph.value'), suffix: answer.unit, preview: 'none', numeric: true, note: answer.sigFigs ? t('ex.note.sigFigs', { count: answer.sigFigs }) : undefined, keysOpen: false }
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
  const { answer, draft, set, locked, reveal, result, lang, onSubmit, autoFocus, exam } = props
  const { t, i18n } = useTranslation('study')
  // los mensajes del analizador matemático están en español (aún sin catálogo en inglés)
  const spanish = i18n.language.startsWith('es')
  const spec = useSpec(answer)
  const ref = useRef<HTMLInputElement>(null)
  const keys = useMemo(() => keysFor(answer), [answer])
  const [keysOpen, setKeysOpen] = useState(() => readKeysPref() ?? spec.keysOpen)
  const comma = usesDecimalComma(lang)
  const text = draft.text

  useEffect(() => {
    // al volver a intentarlo, la respuesta anterior queda seleccionada: lo que escribas la sustituye
    if (autoFocus && !locked) requestAnimationFrame(() => { ref.current?.focus({ preventScroll: true }); ref.current?.select() })
  }, [autoFocus, locked])

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
    const el = ref.current
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
  const wide = answer.kind === 'equation' || answer.kind === 'expression' || answer.kind === 'interval' || answer.kind === 'set' || (answer.kind === 'chem' && answer.mode !== 'number') || answer.kind === 'short'

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {spec.prefix && (
          <span className="t-reading text-text shrink-0">
            <RichText text={spec.prefix} inline />
          </span>
        )}
        <div className={cx('relative flex items-center', wide ? 'min-w-[240px] flex-1' : 'w-[260px] max-w-full')}>
          <input
            ref={ref}
            value={text}
            readOnly={locked}
            spellCheck={answer.kind === 'short' || (answer.kind === 'chem' && answer.mode === 'name')}
            autoComplete="off"
            inputMode={spec.numeric ? 'decimal' : 'text'}
            aria-label={t('ex.yourAnswer')}
            placeholder={spec.placeholder}
            onChange={(e) => set((d) => ({ ...d, text: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !locked) {
                e.preventDefault()
                onSubmit()
              }
            }}
            className={cx(
              'h-12 w-full rounded-[14px] border bg-field px-4 text-[17px] text-text tabular outline-none transition placeholder:text-text3',
              'focus:shadow-[0_0_0_3px_var(--accent-wash)]',
              keys.length > 0 && 'pr-12',
              locked && 'cursor-default'
            )}
            style={{ borderColor: tone ? `color-mix(in oklab, ${tone} 60%, transparent)` : 'color-mix(in oklab, var(--line-strong) 40%, transparent)', background: tone ? `color-mix(in oklab, ${tone} 6%, var(--field))` : undefined }}
          />
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
