// Gráfica de funciones y «Explora» (la misma gráfica con deslizadores para sus parámetros: se redibuja en vivo con los ejes
// quietos, y los valores van en serif tabular).
import { useMemo, useState } from 'react'
import { Button, cx, Icon, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import type { ExploreParam } from '@shared/schema/plot'
import type { BlockContext, BlockProps } from '../types'
import { Caption, Eyebrow, Figure, Inline, Prose, useBlocksT } from '../shared'
import { inkColor } from '../colors'
import { PlotCanvas } from './PlotCanvas'
import { paramValues, saneParams, stableRange } from './compile'
import { formatNumber } from './ticks'

export function PlotBlockView({ block, ctx }: BlockProps<BlockOf<'plot'>>) {
  return (
    <Figure ctx={ctx} title={block.title} caption={<Caption text={block.caption} />}>
      <PlotCanvas spec={block} ctx={ctx} />
    </Figure>
  )
}

export function ExploreBlockView({ block, ctx }: BlockProps<BlockOf<'explore'>>) {
  const t = useBlocksT()
  const params = useMemo(() => saneParams(block.params), [block.params])
  const defaults = useMemo(() => paramValues(params), [params])
  const [values, setValues] = useState<Record<string, number>>(defaults)
  const range = useMemo(() => stableRange(block.plot, params), [block.plot, params])
  const changed = params.some((p) => Math.abs((values[p.name] ?? p.value) - p.value) > 1e-12)
  const print = ctx.mode === 'print'
  const set = (name: string, v: number) => {
    setValues((s) => ({ ...s, [name]: v }))
    ctx.onInteract?.(block.id, 'explore.slide')
  }
  return (
    <Figure
      ctx={ctx}
      title={block.title ?? block.plot.title}
      eyebrow={<div className="text-text2"><Eyebrow icon="sliders" label={t('explore.eyebrow')} /></div>}
      tools={
        <Button size="sm" variant="ghost" icon={<Icon name="undo" size={14} />} disabled={!changed} onClick={() => setValues(defaults)}>
          {t('explore.reset')}
        </Button>
      }
      caption={<Caption text={block.plot.caption} />}
    >
      <PlotCanvas spec={block.plot} ctx={ctx} params={values} baseRange={range} />
      {params.length > 0 && (
        <div className={cx('mt-4 grid gap-x-6 gap-y-3', params.length > 1 && ctx.mode !== 'chat' && 'md:grid-cols-2')}>
          {params.map((p) => (
            <ParamSlider key={p.name} p={p} value={values[p.name] ?? p.value} onChange={(v) => set(p.name, v)} ctx={ctx} disabled={print} />
          ))}
        </div>
      )}
      {block.prompts.length > 0 && (
        <div className="mt-5 rounded-[14px] bg-fill1 px-4 py-3">
          <div className="t-ui font-semibold text-text2">{t('explore.try')}</div>
          <ol className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
            {block.prompts.map((q, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="w-4 shrink-0 text-right font-serif text-[15px] leading-[23px] tabular text-text3">{i + 1}.</span>
                <div className="min-w-0 flex-1"><Prose text={q} ctx={ctx} size="small" /></div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Figure>
  )
}

/** Deslizador de un parámetro: nombre, pista con el relleno en la tinta del curso y el valor en serif tabular. */
function ParamSlider({ p, value, onChange, ctx, disabled }: { p: ExploreParam; value: number; onChange: (v: number) => void; ctx: BlockContext; disabled?: boolean }) {
  const { dark } = useTheme()
  const ink = inkColor(ctx.hue, dark)
  const pct = ((value - p.min) / (p.max - p.min)) * 100
  const steps = (p.max - p.min) / p.step
  // con muchísimos pasos, deslizador continuo y el valor redondeado al paso
  const snap = (v: number) => (steps <= 2000 ? v : Math.min(p.max, Math.max(p.min, p.min + Math.round((v - p.min) / p.step) * p.step)))
  const digits = Math.min(6, Math.max(0, -Math.floor(Math.log10(p.step) + 1e-9)))
  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <span className="t-ui font-medium text-text2 min-w-0 truncate">
          <Inline text={p.label ?? `$${p.name}$`} />
        </span>
        <span className="ml-auto shrink-0 font-serif text-[17px] leading-none tabular text-text">
          <span className="italic text-text2">{p.name}</span> = {formatNumber(value, ctx.language, digits)}
        </span>
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={steps <= 2000 ? p.step : 'any'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(snap(Number(e.target.value)))}
        className="blk-range mt-2 w-full"
        style={{ background: `linear-gradient(90deg, ${ink} ${pct}%, var(--fill3) ${pct}%)` }}
        aria-label={p.label ?? p.name}
        aria-valuetext={`${p.name} = ${formatNumber(value, ctx.language, digits)}`}
      />
      <span className="mt-0.5 flex justify-between t-caption tabular text-text3">
        <span>{formatNumber(p.min, ctx.language, digits)}</span>
        <span>{formatNumber(p.max, ctx.language, digits)}</span>
      </span>
    </label>
  )
}
