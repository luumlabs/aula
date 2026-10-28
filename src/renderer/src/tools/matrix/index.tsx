// Matrices: editas A y B (fracciones exactas), eliges una operación y ves el resultado; la reducción de Gauss-Jordan y
// la inversa se reproducen paso a paso: la fila que cambia se ilumina, las cifras nuevas caen en su sitio y las filas
// que se intercambian se cruzan.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Dice5, Eraser, Pause, Play, SkipBack, SkipForward, SquareDot } from 'lucide-react'
import { Button, Card, IconButton, cx, spring } from '@renderer/design'
import { Tex } from '../shared/Tex'
import { formatNumber } from '../shared/lib/num'
import { CardTitle, ErrorLine, useComma, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { Q, add, cols, determinant, inverse, matrixTex, multiply, opTex, rank, rref, rows, transpose, type Matrix, type RowOp, type Step } from './lib/matrix'

type Op = 'det' | 'inv' | 'transpose' | 'rank' | 'rref' | 'mul' | 'add' | 'sub'
const OPS: { id: Op; tex: string }[] = [
  { id: 'det', tex: '\\det A' },
  { id: 'inv', tex: 'A^{-1}' },
  { id: 'transpose', tex: 'A^{T}' },
  { id: 'rref', tex: '\\operatorname{rref}(A)' },
  { id: 'rank', tex: '\\operatorname{rg}(A)' },
  { id: 'mul', tex: 'A\\cdot B' },
  { id: 'add', tex: 'A+B' },
  { id: 'sub', tex: 'A-B' }
]

interface Saved {
  a: string[][]
  b: string[][]
  op: Op
}

const INITIAL: Saved = {
  a: [['2', '1', '-1'], ['-3', '-1', '2'], ['-2', '1', '2']],
  b: [['1', '0', '2'], ['0', '1', '1'], ['1', '1', '0']],
  op: 'rref'
}

const parseM = (cells: string[][]): Matrix | null => {
  const out: Matrix = []
  for (const r of cells) {
    const row: Q[] = []
    for (const c of r) {
      const q = c.trim() === '' ? Q.ZERO : Q.parse(c)
      if (!q) return null
      row.push(q)
    }
    out.push(row)
  }
  return out
}

const resize = (m: string[][], r: number, c: number): string[][] => Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => m[i]?.[j] ?? '0'))

export default function MatrixTool(_props: ToolProps) {
  const { t } = useTranslation('tools')
  const [s, setS] = useStored<Saved>('aula.tools.matrix', INITIAL)
  const A = useMemo(() => parseM(s.a), [s.a])
  const B = useMemo(() => parseM(s.b), [s.b])
  const binary = s.op === 'mul' || s.op === 'add' || s.op === 'sub'

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card padded className="col-span-12 @4xl:col-span-5 flex flex-col gap-5">
        <MatrixEditor name="A" cells={s.a} onChange={(a) => setS((p) => ({ ...p, a }))} />
        <AnimatePresence initial={false}>
          {binary && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <MatrixEditor name="B" cells={s.b} onChange={(b) => setS((p) => ({ ...p, b }))} />
            </motion.div>
          )}
        </AnimatePresence>
        <div>
          <div className="t-eyebrow mb-2">{t('matrix.operation')}</div>
          <div className="flex flex-wrap gap-1.5">
            {OPS.map((o) => (
              <button key={o.id} onClick={() => setS((p) => ({ ...p, op: o.id }))} className={cx('h-8 px-3 rounded-[10px] text-[13px] transition-colors', s.op === o.id ? 'bg-accent-wash text-accent-text' : 'bg-fill2 hover:bg-fill3 text-text')}>
                <Tex tex={o.tex} />
              </button>
            ))}
          </div>
        </div>
      </Card>
      <Card padded="lg" className="col-span-12 @4xl:col-span-7">
        {!A || (binary && !B) ? <ErrorLine>{t('matrix.badCell')}</ErrorLine> : <Result op={s.op} A={A} B={B} key={`${s.op}-${JSON.stringify(s.a)}-${binary ? JSON.stringify(s.b) : ''}`} />}
      </Card>
    </div>
  )
}

// MARK: Editor

function MatrixEditor({ name, cells, onChange }: { name: string; cells: string[][]; onChange: (c: string[][]) => void }) {
  const { t } = useTranslation('tools')
  const r = cells.length
  const c = cells[0]?.length ?? 0
  const set = (i: number, j: number, v: string) => onChange(cells.map((row, a) => (a === i ? row.map((x, b) => (b === j ? v : x)) : row)))
  const stepper = (label: string, value: number, onSet: (v: number) => void) => (
    <span className="inline-flex items-center gap-1 t-ui text-text2">
      {label}
      <button className="w-6 h-6 rounded-[6px] hover:bg-fill2 disabled:opacity-30" disabled={value <= 1} onClick={() => onSet(value - 1)} aria-label={`${label} −`}>
        −
      </button>
      <span className="w-4 text-center tabular text-text">{value}</span>
      <button className="w-6 h-6 rounded-[6px] hover:bg-fill2 disabled:opacity-30" disabled={value >= 6} onClick={() => onSet(value + 1)} aria-label={`${label} +`}>
        +
      </button>
    </span>
  )
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="font-serif text-[22px] italic">{name}</span>
        <div className="flex items-center gap-3">
          {stepper(t('matrix.rows'), r, (v) => onChange(resize(cells, v, c)))}
          {stepper(t('matrix.cols'), c, (v) => onChange(resize(cells, r, v)))}
          <IconButton label={t('matrix.identity')} size="sm" onClick={() => onChange(cells.map((row, i) => row.map((_, j) => (i === j ? '1' : '0'))))}>
            <SquareDot size={14} />
          </IconButton>
          <IconButton label={t('matrix.random')} size="sm" onClick={() => onChange(cells.map((row) => row.map(() => String(Math.floor(Math.random() * 13) - 6))))}>
            <Dice5 size={14} />
          </IconButton>
          <IconButton label={t('matrix.clear')} size="sm" onClick={() => onChange(cells.map((row) => row.map(() => '0')))}>
            <Eraser size={14} />
          </IconButton>
        </div>
      </div>
      <div className="relative inline-block px-3 py-1.5 max-w-full overflow-x-auto">
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-2 border-l-2 border-y-2 border-text2/70 rounded-l-[6px]" />
        <span aria-hidden className="absolute right-0 top-0 bottom-0 w-2 border-r-2 border-y-2 border-text2/70 rounded-r-[6px]" />
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${c}, minmax(52px, 64px))` }}>
          {cells.map((row, i) =>
            row.map((v, j) => {
              const bad = v.trim() !== '' && !Q.parse(v)
              return (
                <motion.input
                  key={`${i}-${j}`}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  value={v}
                  onChange={(e) => set(i, j, e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`${name}${i + 1},${j + 1}`}
                  className={cx('h-9 w-full rounded-[8px] bg-field border-[0.5px] text-center text-[14px] tabular outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-wash)]', bad ? 'border-danger/60 text-danger' : 'border-line-strong/40')}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// MARK: Resultado

function Result({ op, A, B }: { op: Op; A: Matrix; B: Matrix | null }) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const sq = rows(A) === cols(A)
  switch (op) {
    case 'det': {
      if (!sq) return <ErrorLine>{t('matrix.needSquare')}</ErrorLine>
      const d = determinant(A) as Q
      const r = rref(A)
      return (
        <div>
          <CardTitle title={t('matrix.det')} detail={t('matrix.detHint')} />
          <div className="flex flex-wrap items-center gap-4 text-[22px]">
            <Tex tex={`\\det ${matrixTex(A).replace('bmatrix', 'vmatrix').replace('bmatrix', 'vmatrix')}`} />
            <span className="text-text3">=</span>
            <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={spring.bouncy} className="font-serif text-[48px]">
              <Tex tex={d.toTex()} />
            </motion.span>
          </div>
          {!d.isInt && <div className="t-callout text-text2 mt-2">≈ {formatNumber(d.toNumber(), { comma, sig: 6 })}</div>}
          <div className="t-footnote mt-4">{d.isZero ? t('matrix.singular') : t('matrix.detSteps', { count: r.steps.length, swaps: r.swaps })}</div>
          <StepPlayer start={A} steps={r.steps} />
        </div>
      )
    }
    case 'inv': {
      if (!sq) return <ErrorLine>{t('matrix.needSquare')}</ErrorLine>
      const r = inverse(A)
      return (
        <div>
          <CardTitle title={t('matrix.inverse')} detail={r.inverse ? t('matrix.inverseHint') : t('matrix.notInvertible')} />
          {r.inverse && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[20px] overflow-x-auto overflow-y-hidden">
              <Tex tex={`A^{-1} = ${matrixTex(r.inverse)}`} display />
            </motion.div>
          )}
          <StepPlayer start={r.augmented} steps={r.steps} augmentAt={cols(A)} />
        </div>
      )
    }
    case 'transpose':
      return (
        <div>
          <CardTitle title={t('matrix.transpose')} detail={t('matrix.transposeHint')} />
          <motion.div initial={{ opacity: 0, rotate: -6 }} animate={{ opacity: 1, rotate: 0 }} transition={spring.smooth} className="text-[22px] overflow-x-auto overflow-y-hidden">
            <Tex tex={`A^{T} = ${matrixTex(transpose(A))}`} display />
          </motion.div>
        </div>
      )
    case 'rank': {
      const r = rref(A)
      return (
        <div>
          <CardTitle title={t('matrix.rank')} detail={t('matrix.rankHint')} />
          <div className="font-serif text-[56px] leading-none">{rank(A)}</div>
          <StepPlayer start={A} steps={r.steps} />
        </div>
      )
    }
    case 'rref': {
      const r = rref(A)
      return (
        <div>
          <CardTitle title={t('matrix.rref')} detail={t('matrix.rrefHint', { count: r.steps.length })} />
          <StepPlayer start={A} steps={r.steps} autoPlay />
        </div>
      )
    }
    default: {
      if (!B) return null
      const res = op === 'mul' ? multiply(A, B) : add(A, B, op === 'add' ? 1 : -1)
      const label = op === 'mul' ? 'A\\cdot B' : op === 'add' ? 'A+B' : 'A-B'
      return (
        <div>
          <CardTitle title={t(`matrix.${op}`)} detail={op === 'mul' ? t('matrix.mulHint') : undefined} />
          {res ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[20px] overflow-x-auto overflow-y-hidden">
              <Tex tex={`${label} = ${matrixTex(res)}`} display />
            </motion.div>
          ) : (
            <ErrorLine>{op === 'mul' ? t('matrix.badMul', { a: `${rows(A)}×${cols(A)}`, b: `${rows(B)}×${cols(B)}` }) : t('matrix.badAdd')}</ErrorLine>
          )}
        </div>
      )
    }
  }
}

// MARK: Pasos animados

function StepPlayer({ start, steps, augmentAt, autoPlay }: { start: Matrix; steps: Step[]; augmentAt?: number; autoPlay?: boolean }) {
  const { t } = useTranslation('tools')
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(!!autoPlay && steps.length > 0)
  const total = steps.length
  useEffect(() => {
    if (!playing) return
    if (i >= total) {
      setPlaying(false)
      return
    }
    const id = window.setTimeout(() => setI((x) => x + 1), 1150)
    return () => clearTimeout(id)
  }, [playing, i, total])
  // identidad de cada fila a lo largo de los pasos (para que los intercambios se vean como un cruce)
  const ids = useMemo(() => {
    const out: number[][] = [start.map((_, k) => k)]
    for (const s of steps) {
      const prev = [...out[out.length - 1]]
      if (s.op.type === 'swap') [prev[s.op.i], prev[s.op.j]] = [prev[s.op.j], prev[s.op.i]]
      out.push(prev)
    }
    return out
  }, [start, steps])
  if (!total) return <div className="t-footnote mt-4">{t('matrix.noSteps')}</div>
  const cur = i === 0 ? start : steps[i - 1].matrix
  const op = i === 0 ? null : steps[i - 1].op
  const pivot = i === 0 ? null : steps[i - 1].pivot
  return (
    <div className="mt-6 pt-5 border-t-[0.5px] border-line-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-h-[28px] text-[17px]">
          <AnimatePresence mode="wait">
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {op ? <Tex tex={opTex(op)} /> : <span className="t-callout text-text2">{t('matrix.startStep')}</span>}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-1">
          <span className="t-ui text-text3 tabular mr-2">
            {i} / {total}
          </span>
          <IconButton label={t('matrix.first')} size="sm" onClick={() => setI(0)} disabled={i === 0}>
            <SkipBack size={14} />
          </IconButton>
          <IconButton label={t('matrix.prev')} size="sm" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
            <ChevronLeft size={15} />
          </IconButton>
          <Button size="sm" variant={playing ? 'secondary' : 'primary'} icon={playing ? <Pause size={13} /> : <Play size={13} />} onClick={() => (i >= total ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? t('common.pause') : i >= total ? t('common.replay') : t('common.play')}
          </Button>
          <IconButton label={t('matrix.next')} size="sm" onClick={() => setI((x) => Math.min(total, x + 1))} disabled={i >= total}>
            <ChevronRight size={15} />
          </IconButton>
          <IconButton label={t('matrix.last')} size="sm" onClick={() => setI(total)} disabled={i >= total}>
            <SkipForward size={14} />
          </IconButton>
        </div>
      </div>
      <div className="h-1 rounded-full bg-fill2 overflow-hidden mb-5">
        <motion.div className="h-full bg-accent rounded-full" animate={{ width: `${(i / total) * 100}%` }} transition={spring.smooth} />
      </div>
      <MatrixGrid m={cur} rowIds={ids[i]} op={op} pivot={pivot} augmentAt={augmentAt} />
    </div>
  )
}

function MatrixGrid({ m, rowIds, op, pivot, augmentAt }: { m: Matrix; rowIds: number[]; op: RowOp | null; pivot: [number, number] | null; augmentAt?: number }) {
  const c = cols(m)
  const touched = (r: number) => op !== null && (op.i === r || (op.type === 'swap' && op.j === r))
  const source = (r: number) => op !== null && op.type === 'add' && op.j === r
  return (
    <div className="relative inline-block px-3 py-1 max-w-full overflow-x-auto">
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-2 border-l-2 border-y-2 border-text2/70 rounded-l-[6px]" />
      <span aria-hidden className="absolute right-0 top-0 bottom-0 w-2 border-r-2 border-y-2 border-text2/70 rounded-r-[6px]" />
      <div className="flex flex-col gap-1">
        {m.map((row, r) => (
          <motion.div
            key={rowIds[r]}
            layout
            transition={spring.smooth}
            className={cx('grid gap-1 rounded-[8px] transition-colors duration-300', touched(r) ? 'bg-accent-wash' : source(r) ? 'bg-fill2' : '')}
            style={{ gridTemplateColumns: `repeat(${c}, minmax(56px, auto))` }}
          >
            {row.map((x, j) => (
              <div key={j} className={cx('relative h-10 grid place-items-center px-2 overflow-hidden', augmentAt !== undefined && j === augmentAt && 'border-l-[1.5px] border-text3/50', pivot && pivot[0] === r && pivot[1] === j && 'rounded-[8px] ring-2 ring-accent/60')}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={x.toString()} initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={{ duration: 0.28 }} className="text-[16px] tabular">
                    <Tex tex={x.toTex()} />
                  </motion.span>
                </AnimatePresence>
              </div>
            ))}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
