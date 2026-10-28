// Calculadora exacta tipo cuaderno: escribes una operación y ves al vuelo su fórmula (KaTeX) y el resultado exacto
// (fracción, π, √) con su decimal; ↩ la guarda en el historial. Variables (`a = 5`), `ans`, grados o radianes y un
// teclado en pantalla que se hunde al pulsarlo (también se ilumina con el teclado físico). Modo compacto para la ventanita.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, CornerDownLeft, Delete, Trash2, X } from 'lucide-react'
import { Button, Card, IconButton, SegmentedTabs, Sprite, cx, spring, toast, useTheme } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'
import { Tex } from '../shared/Tex'
import { localizeTex } from '../shared/lib/num'
import { useComma, useCopy } from '../shared/ui'
import type { ToolProps } from '../registry'
import { MV, type MathValue } from '@engine/math/core/types'
import { displayValue, loadValue, previewCalc, type CalcDisplay, type CalcIssue } from './lib/engine'
import { contextOf, useCalc, type CalcEntry } from './store'

// MARK: Cómo se enseña un resultado

/** Lo que se ve de un resultado: un número (exacto y decimal), una comparación (verdadero/falso) o una lista de cuentas. */
type Shown = CalcDisplay & { verdict?: boolean; lines?: string[] }

function present(r: { kind?: 'value' | 'bool' | 'list'; value: MathValue; text?: string; closedTex?: string }, comma: boolean): Shown {
  if (r.kind === 'bool') return { ...displayValue(r.value, comma), verdict: MV.double(r.value) === 1 }
  if (r.kind === 'list') {
    const lines = (r.text ?? '').split('\n').map((l) => (comma ? l.replace(/(\d)\.(\d)/g, '$1,$2') : l))
    return { ...displayValue(r.value, comma), lines, copy: lines.join('\n') }
  }
  return displayValue(r.value, comma, r.closedTex)
}

// MARK: Teclas

type Role = 'digit' | 'fn' | 'op' | 'ctl' | 'eq'
type Action = { t: 'ins'; s: string } | { t: 'wrap'; pre: string; post: string } | { t: 'back' } | { t: 'clear' } | { t: 'eval' }
interface Key {
  id: string
  label: ReactNode
  role: Role
  act: Action
  help?: string
}

const ins = (id: string, label: ReactNode, s: string, role: Role = 'fn'): Key => ({ id, label, role, act: { t: 'ins', s } })
const fn = (id: string, label: ReactNode, pre: string, post = ')'): Key => ({ id, label, role: 'fn', act: { t: 'wrap', pre, post } })
const sup = (base: string, exp: string) => (
  <span>
    {base}
    <sup className="text-[0.68em] ml-[1px]">{exp}</sup>
  </span>
)

const SCIENTIFIC: Key[] = [
  fn('sin', 'sin', 'sin('), fn('cos', 'cos', 'cos('), fn('tan', 'tan', 'tan('), fn('ln', 'ln', 'ln('), fn('log', 'log', 'log('),
  fn('asin', sup('sin', '−1'), 'sin⁻¹('), fn('acos', sup('cos', '−1'), 'cos⁻¹('), fn('atan', sup('tan', '−1'), 'tan⁻¹('), fn('exp', sup('e', 'x'), 'e^('), fn('pow10', sup('10', 'x'), '10^('),
  ins('sq', sup('x', '2'), '²'), ins('pow', sup('x', 'y'), '^'), fn('sqrt', '√x', '√('), fn('cbrt', '∛x', '∛('), fn('abs', '|x|', '|', '|'),
  ins('pi', 'π', 'π'), ins('e', 'e', 'e'), ins('fact', 'n!', '!'), fn('ncr', 'nCr', 'nCr('), ins('ans', 'ans', 'ans')
]

function numericKeys(sep: string): Key[] {
  const d = (n: string): Key => ({ id: `d${n}`, label: n, role: 'digit', act: { t: 'ins', s: n } })
  return [
    { id: 'back', label: <Delete size={18} strokeWidth={1.8} />, role: 'ctl', act: { t: 'back' } }, ins('lp', '(', '(', 'ctl'), ins('rp', ')', ')', 'ctl'), ins('div', '÷', '÷', 'op'),
    d('7'), d('8'), d('9'), ins('mul', '×', '×', 'op'),
    d('4'), d('5'), d('6'), ins('sub', '−', '−', 'op'),
    d('1'), d('2'), d('3'), ins('add', '+', '+', 'op'),
    { id: 'clear', label: 'C', role: 'ctl', act: { t: 'clear' } }, d('0'), { id: 'dec', label: sep, role: 'digit', act: { t: 'ins', s: sep } }, { id: 'eq', label: '=', role: 'eq', act: { t: 'eval' } }
  ]
}

function compactKeys(sep: string): Key[] {
  const all = numericKeys(sep)
  const top: Key[] = [fn('sqrt', '√', '√('), ins('pi', 'π', 'π'), ins('pow', sup('x', 'y'), '^'), all[0], ins('lp', '(', '(', 'ctl'), ins('rp', ')', ')', 'ctl'), ins('ans', 'ans', 'ans'), all[3]]
  return [...top, ...all.slice(4)]
}

/** Tecla en pantalla que corresponde a una pulsación física (para iluminarla). */
function keyIdFor(e: KeyboardEvent): string | null {
  if (e.key === 'Enter') return 'eq'
  if (e.key === 'Backspace') return 'back'
  if (e.key === 'Escape') return 'clear'
  const map: Record<string, string> = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '(': 'lp', ')': 'rp', '^': 'pow', '!': 'fact', ',': 'dec', '.': 'dec' }
  if (/^[0-9]$/.test(e.key)) return `d${e.key}`
  return map[e.key] ?? null
}

// MARK: Pantalla

export default function CalculatorTool({ compact }: ToolProps) {
  const comma = useComma()
  const sep = comma ? ',' : '.'
  const s = useCalc()
  const inputRef = useRef<HTMLInputElement>(null)
  const [lit, setLit] = useState<string | null>(null)
  const [landed, setLanded] = useState(0)
  const ctx = useMemo(() => contextOf(s), [s.vars, s.ans, s.degrees]) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => previewCalc(s.input, ctx), [s.input, ctx])
  const last = s.entries[s.entries.length - 1]
  const lastValue = last ? loadValue(last.value) : null
  const shown: { display: Shown; live: boolean } | null = preview?.result
    ? { display: present(preview.result, comma), live: true }
    : !s.input.trim() && last && lastValue
      ? { display: present({ ...last, value: lastValue }, comma), live: false }
      : null
  const degHint = useMemo(() => {
    if (s.degrees || !s.input.trim()) return false
    return /\b(sin|cos|tan|sen|tg)\s*\(?\s*-?(15|30|45|60|75|90|120|135|150|180|270|360)\b/i.test(s.input)
  }, [s.input, s.degrees])

  const flash = (id: string) => {
    setLit(id)
    window.setTimeout(() => setLit((v) => (v === id ? null : v)), 140)
  }

  const submit = () => {
    const e = useCalc.getState().submit()
    if (e) setLanded((n) => n + 1)
  }

  const press = (k: Key) => {
    flash(k.id)
    const el = inputRef.current
    const cur = useCalc.getState().input
    const start = el?.selectionStart ?? cur.length
    const end = el?.selectionEnd ?? cur.length
    let next = cur
    let caret = start
    switch (k.act.t) {
      case 'ins': {
        const before = cur.slice(0, start)
        // «ans» pegado a una letra («πans») se leería como π·a·n·s: se separa con «·»
        const glue = k.act.s.length > 1 && /^\p{L}/u.test(k.act.s) && /\p{L}$/u.test(before) ? '·' : ''
        next = before + glue + k.act.s + cur.slice(end)
        caret = start + glue.length + k.act.s.length
        break
      }
      case 'wrap': {
        const inner = cur.slice(start, end)
        next = cur.slice(0, start) + k.act.pre + inner + k.act.post + cur.slice(end)
        caret = inner ? start + k.act.pre.length + inner.length + k.act.post.length : start + k.act.pre.length
        break
      }
      case 'back':
        if (start !== end) next = cur.slice(0, start) + cur.slice(end)
        else if (start > 0) {
          next = cur.slice(0, start - 1) + cur.slice(start)
          caret = start - 1
        }
        break
      case 'clear':
        next = ''
        caret = 0
        break
      case 'eval':
        submit()
        return
    }
    s.setInput(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const id = keyIdFor(e)
    if (id) flash(id)
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      s.recall(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      s.recall(1)
    } else if (e.key === 'Escape' && s.input) {
      e.preventDefault()
      e.stopPropagation()
      s.setInput('')
    }
  }

  const display = (
    <Display
      compact={compact}
      inputRef={inputRef}
      onKeyDown={onKeyDown}
      previewTex={preview ? localizeTex(preview.tex, comma) : null}
      partial={!!preview?.partial}
      shown={shown}
      landed={landed}
      issue={s.issue}
      degHint={degHint}
    />
  )
  const keys = compact ? compactKeys(sep) : null

  if (compact) {
    return (
      <div className="p-3 flex flex-col gap-3">
        {display}
        <div className="grid grid-cols-4 gap-1.5">
          {keys!.map((k) => (
            <KeyButton key={k.id} k={k} lit={lit === k.id} onPress={press} compact />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(270px,340px)] @2xl:grid-rows-[auto_1fr]">
      <div className="min-w-0">{display}</div>
      <Keypad sep={sep} lit={lit} onPress={press} />
      <History onUse={(e) => s.setInput(e.input)} />
    </div>
  )
}

// MARK: Visor

function Display({ compact, inputRef, onKeyDown, previewTex, partial, shown, landed, issue, degHint }: {
  compact?: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  previewTex: string | null
  partial: boolean
  shown: { display: Shown; live: boolean } | null
  landed: number
  issue: CalcIssue | null
  degHint: boolean
}) {
  const { t } = useTranslation('tools')
  const s = useCalc()
  const copy = useCopy()
  const d = shown?.display
  const resultKey = `${d?.tex ?? ''}-${landed}`
  return (
    <Card padded={compact ? false : 'lg'} className={cx(compact && 'bg-transparent! border-0! shadow-none!')}>
      <div className="flex items-center justify-between gap-3">
        <SegmentedTabs
          size="sm"
          value={s.degrees ? 'deg' : 'rad'}
          onChange={(v) => s.setDegrees(v === 'deg')}
          items={[
            { id: 'deg', label: t('calculator.deg') },
            { id: 'rad', label: t('calculator.rad') }
          ]}
        />
        {!compact && <Variables />}
      </div>
      <div className={cx('relative mt-4 rounded-[16px] bg-sunken border-[0.5px] border-line', compact ? 'px-3 pt-2.5 pb-2' : 'px-5 pt-4 pb-3')}>
        <input
          ref={inputRef}
          value={s.input}
          onChange={(e) => s.setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoFocus={!compact}
          aria-label={t('calculator.inputLabel')}
          placeholder={t('calculator.placeholder')}
          className={cx('w-full bg-transparent outline-none text-text placeholder:text-text3 tracking-[-0.01em]', compact ? 'text-[18px] h-8' : 'text-[24px] h-10')}
        />
        <div className={cx('overflow-x-auto overflow-y-hidden text-text2', compact ? 'min-h-[30px] text-[15px]' : 'min-h-[40px] text-[19px]')}>
          <AnimatePresence mode="popLayout" initial={false}>
            {previewTex && (
              <motion.div key="p" initial={{ opacity: 0 }} animate={{ opacity: partial ? 0.55 : 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="py-1 whitespace-nowrap">
                <Tex tex={previewTex} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className={cx('relative', compact ? 'mt-2 min-h-[64px]' : 'mt-5 min-h-[112px]')}>
        <AnimatePresence mode="popLayout" initial={false}>
          {issue ? (
            <motion.div key="issue" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-3 py-2.5 t-callout text-danger">
              <span aria-hidden className="mt-[7px] w-1.5 h-1.5 rounded-[1px] bg-danger shrink-0" />
              <IssueText issue={issue} />
            </motion.div>
          ) : d ? (
            <motion.div key={resultKey} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: shown?.live ? 1 : 0.62, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={landed && !shown?.live ? spring.bouncy : spring.smooth}>
              {!shown?.live && <div className="t-eyebrow mb-1">{t('calculator.lastResult')}</div>}
              {d.verdict !== undefined ? (
                <div className={cx('flex items-center gap-3 font-serif', compact ? 'text-[26px]' : 'text-[40px]', d.verdict ? 'text-success' : 'text-danger')}>
                  <span className={cx('grid place-items-center rounded-full', compact ? 'w-8 h-8' : 'w-11 h-11', d.verdict ? 'bg-success-soft' : 'bg-danger-soft')}>{d.verdict ? <Check size={compact ? 16 : 22} /> : <X size={compact ? 16 : 22} />}</span>
                  {d.verdict ? t('calculator.true') : t('calculator.false')}
                </div>
              ) : d.lines ? (
                <div className="flex flex-col gap-1 font-mono text-[14px] text-text max-h-[160px] overflow-y-auto selectable">
                  {d.lines.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap">{l}</div>
                  ))}
                </div>
              ) : (
              <div className="flex items-end justify-between gap-3">
                <div className={cx('min-w-0 overflow-x-auto overflow-y-hidden font-serif', compact ? 'text-[26px]' : 'text-[44px]')}>
                  <span className="text-text3 mr-2">{d.approx ? '≈' : '='}</span>
                  <Tex tex={d.tex} />
                </div>
                {!compact && (
                  <IconButton label={t('calculator.copyExact')} size="sm" onClick={() => copy(d.copy)}>
                    <Copy size={14} />
                  </IconButton>
                )}
              </div>
              )}
              {d.verdict === undefined && !d.lines && (d.detailTex || d.mixedTex) && (
                <div className={cx('flex flex-wrap items-center gap-x-5 gap-y-1 text-text2', compact ? 'mt-0.5 text-[13px]' : 'mt-2 text-[18px]')}>
                  {d.detailTex && (
                    <button className="inline-flex items-center gap-1.5 hover:text-text" onClick={() => copy(d.decimal)} title={t('calculator.copyDecimal')}>
                      <span className="text-text3">{d.detailExact ? '=' : '≈'}</span>
                      <Tex tex={d.detailTex} />
                    </button>
                  )}
                  {d.mixedTex && !compact && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="t-caption">{t('calculator.mixed')}</span>
                      <Tex tex={d.mixedTex} />
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          ) : !compact && !s.input.trim() ? (
            <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-4 text-text3">
              <CalcSprite />
              <div className="t-callout max-w-[440px]">{t('calculator.hint')}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {degHint && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-warning-soft px-3 py-2 t-ui text-warning">
              <span className="flex-1 min-w-[180px]">{t('calculator.degHint')}</span>
              <Button size="sm" variant="secondary" onClick={() => s.setDegrees(true)}>
                {t('calculator.useDeg')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function IssueText({ issue }: { issue: CalcIssue }) {
  const { t } = useTranslation('tools')
  switch (issue.code) {
    case 'engine':
      // el motor ya da el mensaje en el idioma de la app (lo fija App con applyEngineLanguage)
      return <span>{issue.message || t(`calculator.err.${issue.kind}`)}</span>
    case 'unknown':
      return <span>{t('calculator.err.unknown', { count: issue.names.length, names: issue.names.join(', '), first: issue.names[0] })}</span>
    case 'wordSplit':
      return <span>{t('calculator.err.wordSplit', { word: issue.word, letters: issue.letters })}</span>
    case 'constantName':
    case 'missingValue':
      return <span>{t(`calculator.err.${issue.code}`, { name: issue.name })}</span>
    case 'multiLetter':
      return <span>{t('calculator.err.multiLetter', { name: issue.name, letters: issue.letters })}</span>
    default:
      return <span>{t(`calculator.err.${issue.code}`)}</span>
  }
}

function Variables() {
  const s = useCalc()
  const comma = useComma()
  if (!s.varOrder.length) return null
  return (
    <div className="flex flex-wrap justify-end gap-1.5 min-w-0">
      {s.varOrder.slice(-4).map((name) => {
        const v = loadValue(s.vars[name])
        if (!v) return null
        return (
          <button key={name} onClick={() => s.setInput(s.input + name)} className="h-7 px-2.5 rounded-full bg-fill2 hover:bg-fill3 text-[13px] text-text2 hover:text-text">
            <Tex tex={`${name} = ${displayValue(v, comma).tex}`} />
          </button>
        )
      })}
    </div>
  )
}

// MARK: Teclado

function Keypad({ sep, lit, onPress }: { sep: string; lit: string | null; onPress: (k: Key) => void }) {
  return (
    <Card padded className="@2xl:row-span-2 self-start">
      <div className="grid grid-cols-5 gap-1.5">
        {SCIENTIFIC.map((k) => (
          <KeyButton key={k.id} k={k} lit={lit === k.id} onPress={onPress} />
        ))}
      </div>
      <div className="h-px bg-line-soft my-3" />
      <div className="grid grid-cols-4 gap-1.5">
        {numericKeys(sep).map((k) => (
          <KeyButton key={k.id} k={k} lit={lit === k.id} onPress={onPress} big />
        ))}
      </div>
    </Card>
  )
}

const ROLE_LOOK: Record<Role, string> = {
  digit: 'bg-raised text-text border-[0.5px] border-line shadow-[var(--e1)] font-medium',
  fn: 'bg-fill1 text-text2 hover:text-text',
  op: 'bg-fill2 text-text font-medium',
  ctl: 'bg-fill3 text-text',
  eq: 'bg-accent text-on-accent font-semibold shadow-[var(--accent-halo)]'
}

function KeyButton({ k, lit, onPress, big, compact }: { k: Key; lit: boolean; onPress: (k: Key) => void; big?: boolean; compact?: boolean }) {
  const { t } = useTranslation('tools')
  const { reducedMotion } = useTheme()
  const help = t(`calculator.keys.${k.id}`, { defaultValue: '' })
  return (
    <motion.button
      type="button"
      aria-label={help || (typeof k.label === 'string' ? k.label : k.id)}
      title={help || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPress(k)}
      animate={lit && !reducedMotion ? { scale: 0.93, y: 1 } : { scale: 1, y: 0 }}
      whileTap={reducedMotion ? undefined : { scale: 0.9, y: 1.5 }}
      transition={{ type: 'spring', stiffness: 700, damping: 28 }}
      className={cx(
        'relative overflow-hidden rounded-[12px] select-none outline-none grid place-items-center transition-colors no-drag',
        compact ? 'h-10 text-[15px]' : big ? 'h-12 text-[18px]' : 'h-10 text-[13.5px]',
        ROLE_LOOK[k.role],
        k.role !== 'eq' && 'hover:bg-fill2',
        k.role === 'eq' && 'hover:bg-accent-hover'
      )}
    >
      <AnimatePresence>
        {lit && (
          <motion.span
            aria-hidden
            className={cx('absolute inset-0', k.role === 'eq' ? 'bg-black/15' : 'bg-accent-wash')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.35 } }}
            transition={{ duration: 0.05 }}
          />
        )}
      </AnimatePresence>
      <span className="relative tabular">{k.label}</span>
    </motion.button>
  )
}

// MARK: Historial

function History({ onUse }: { onUse: (e: CalcEntry) => void }) {
  const { t } = useTranslation('tools')
  const s = useCalc()
  const comma = useComma()
  const copy = useCopy()
  const entries = [...s.entries].reverse()
  const clear = () => {
    const before = s.clearAll()
    toast.action(t('calculator.cleared'), { label: t('calculator.undo'), run: () => useCalc.getState().restore(before) })
  }
  return (
    <Card padded={false} className="min-w-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="font-serif text-[19px] leading-6">{t('calculator.history')}</h3>
        {entries.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={clear}>
            {t('calculator.clear')}
          </Button>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="px-5 pb-5 t-callout text-text3">{t('calculator.historyEmpty')}</div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto pb-2">
          <AnimatePresence initial={false}>
            {entries.map((e) => {
              const v = loadValue(e.value)
              if (!v) return null
              const d = present({ ...e, value: v }, comma)
              return (
                <motion.div
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: -12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={spring.smooth}
                  className="group relative flex items-center gap-3 px-5 py-2 min-h-[52px] hover:bg-fill1 cursor-default border-t-[0.5px] border-line-soft first:border-t-0"
                  onClick={() => onUse(e)}
                >
                  <div className="min-w-0 flex-1 overflow-hidden text-text2 text-[16px] whitespace-nowrap">
                    <Tex tex={localizeTex(e.tex, comma)} />
                    {e.degrees && <span className="ml-2 t-caption">{t('calculator.deg')}</span>}
                  </div>
                  <div className="shrink-0 max-w-[55%] overflow-hidden whitespace-nowrap font-serif text-[19px] text-text text-right">
                    {d.verdict !== undefined ? (
                      <span className={d.verdict ? 'text-success' : 'text-danger'}>{d.verdict ? t('calculator.true') : t('calculator.false')}</span>
                    ) : d.lines ? (
                      <span className="t-ui text-text3 font-sans">{t('calculator.results', { count: d.lines.length })}</span>
                    ) : (
                      <>
                        <span className="text-text3 mr-1.5">{d.approx ? '≈' : '='}</span>
                        <Tex tex={`\\displaystyle ${d.tex}`} />
                      </>
                    )}
                  </div>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 rounded-[10px] bg-raised shadow-[var(--e2)] border-[0.5px] border-line p-0.5">
                    <IconButton label={t('calculator.reuse')} size="sm" onClick={(ev) => { ev.stopPropagation(); onUse(e) }}>
                      <CornerDownLeft size={14} />
                    </IconButton>
                    <IconButton label={t('calculator.copyExact')} size="sm" onClick={(ev) => { ev.stopPropagation(); copy(d.copy) }}>
                      <Copy size={14} />
                    </IconButton>
                    <IconButton label={t('calculator.remove')} size="sm" onClick={(ev) => { ev.stopPropagation(); s.remove(e.id) }}>
                      <X size={14} />
                    </IconButton>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </Card>
  )
}

// MARK: Pixel-art

const CALC_A = ['.bbbbbbbbb.', 'bwwwwwwwwwb', 'bwgggggggwb', 'bwgggggcgwb', 'bwgggggggwb', 'bwwwwwwwwwb', 'bwkwkwkwawb', 'bwwwwwwwwwb', 'bwkwkwkwawb', 'bwwwwwwwwwb', 'bwkwkwkwawb', 'bwwwwwwwwwb', '.bbbbbbbbb.']
const CALC_B = CALC_A.map((r, i) => (i === 3 ? 'bwgggggggwb' : r))

/** Calculadora pixel-art con el cursor parpadeando en su pantallita. */
function CalcSprite() {
  const { reducedMotion } = useTheme()
  const [f, setF] = useState(0)
  const moving = useAmbient()
  useEffect(() => {
    if (reducedMotion || !moving) return
    const id = setInterval(() => setF((v) => 1 - v), 560)
    return () => clearInterval(id)
  }, [reducedMotion, moving])
  return <Sprite rows={f ? CALC_B : CALC_A} legend={{ b: 'var(--line-strong)', w: 'var(--surface)', g: 'var(--accent-wash)', c: 'var(--accent)', k: 'var(--fill4)', a: 'var(--accent)' }} size={52} />
}
