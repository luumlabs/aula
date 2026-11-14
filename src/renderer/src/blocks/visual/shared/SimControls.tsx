// Controles compartidos por las simulaciones y los dibujos que se mueven: el reloj (reproducir, arrastrar, velocidad y bucle)
// y los deslizadores de los parámetros. Sacados de SimulationBlock sin cambiar cómo se comportan.
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Icon, IconButton, cx } from '@renderer/design'
import type { SimParam } from '@shared/schema/visual'
import { RichText } from '@renderer/lib/RichText'
import { decimalsFor, formatSimValue } from '../lib/simulation'

export const SPEEDS = [0.5, 1, 2] as const

/** La unidad tras la cifra: «45°» pegado; el resto con un espacio («25 m/s»). */
export const unitText = (u: string): string => (u === '°' || u === '′' || u === '″' ? u : ` ${u}`)

export function Clock({ interactive, playing, now, lo, hi, label, name, unit, rate, loop, sep, onToggle, onScrub, onRate, onLoop }: {
  interactive: boolean; playing: boolean; now: number; lo: number; hi: number; label: string; name: string; unit?: string; rate: number; loop: boolean; sep: string
  onToggle: () => void; onScrub: (v: number) => void; onRate: (r: number) => void; onLoop: () => void
}) {
  const { t } = useTranslation('visual')
  const pct = hi > lo ? ((now - lo) / (hi - lo)) * 100 : 0
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {interactive && (
        <motion.button
          type="button"
          onClick={onToggle}
          whileTap={{ scale: 0.92 }}
          aria-label={playing ? t('pause') : t('play')}
          title={playing ? t('pause') : t('play')}
          className="grid place-items-center w-9 h-9 rounded-full bg-accent text-on-accent shadow-[var(--accent-halo)] shrink-0"
        >
          <Icon name={playing ? 'pause' : 'play'} size={15} />
        </motion.button>
      )}
      <div className="flex-1 min-w-[160px] flex flex-col gap-1">
        {interactive ? (
          <input
            type="range"
            min={lo}
            max={hi}
            step={(hi - lo) / 1000}
            value={now}
            onChange={(e) => onScrub(Number(e.target.value))}
            aria-label={label}
            className="aula-range w-full"
            style={{ background: `linear-gradient(90deg, var(--accent) ${pct}%, var(--fill3) ${pct}%)` }}
          />
        ) : (
          <div className="h-1 rounded-full bg-fill3 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
        )}
      </div>
      <span className="t-number-inline text-text2 min-w-[92px] text-right">
        <span className="font-serif italic">{name}</span> = {formatSimValue(now, 2, sep)}
        {unit && <span className="text-text3"> {unit}</span>}
      </span>
      {interactive && (
        <div className="flex items-center gap-0.5 rounded-full bg-fill2 p-[3px]">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onRate(s)}
              aria-pressed={rate === s}
              title={t('sim.speed', { x: formatSimValue(s, undefined, sep) })}
              className={cx('h-6 px-2 rounded-full t-caption font-semibold tabular transition-colors', rate === s ? 'bg-raised text-text shadow-[var(--e1)]' : 'text-text3 hover:text-text')}
            >
              {formatSimValue(s, undefined, sep)}×
            </button>
          ))}
        </div>
      )}
      {interactive && (
        <IconButton size="sm" label={loop ? t('sim.loopOn') : t('sim.loopOff')} active={loop} onClick={onLoop}>
          <Icon name="repeat" size={14} />
        </IconButton>
      )}
    </div>
  )
}

export function ParamSlider({ p, value, interactive, sep, onChange }: { p: SimParam; value: number; interactive: boolean; sep: string; onChange: (v: number) => void }) {
  const pct = p.max > p.min ? ((value - p.min) / (p.max - p.min)) * 100 : 0
  const dec = Math.max(decimalsFor(p.step), decimalsFor(p.min))
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="t-ui font-medium text-text2 min-w-0">
          <RichText text={p.label ?? p.name} inline />
        </span>
        <span className="t-number-inline text-text whitespace-nowrap">
          {formatSimValue(value, dec, sep)}
          {p.unit && <span className="text-text3 font-normal">{unitText(p.unit)}</span>}
        </span>
      </span>
      {interactive ? (
        <input
          type="range"
          min={p.min}
          max={p.max}
          step={(p.max - p.min) / p.step <= 400 ? p.step : 'any'}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="aula-range w-full"
          style={{ background: `linear-gradient(90deg, var(--accent) ${pct}%, var(--fill3) ${pct}%)` }}
        />
      ) : (
        <div className="h-1 rounded-full bg-fill3 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
      )}
    </label>
  )
}
