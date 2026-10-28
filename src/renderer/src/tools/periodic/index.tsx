// Tabla periódica interactiva: los 118 elementos coloreados por familia (tonos tranquilos de los cursos), por una
// propiedad (mapa de calor con una escala de un solo tono) o por su estado a la temperatura que elijas. Al pasar el
// ratón la celda crece y la ficha del hueco central la muestra en grande; abajo, la ficha completa con un modelo de Bohr
// animado (los electrones giran en sus capas) y un detalle pixel-art del estado de la materia.
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Copy, Search, X } from 'lucide-react'
import { Card, IconButton, SegmentedTabs, Select, Slider, Sprite, cx, spring, useTheme } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'
import { ALL_ELEMENTS, ELEMENT_CATEGORIES, PeriodicTable, localizedCategoryTitle, localizedElementName, localizedStateTitle, phaseAt, type Element, type ElementCategory, type StandardState } from '@engine/chem/elements'
import { ElectronConfiguration } from '@engine/chem/electron-config'
import type { CourseToneName } from '@renderer/design/pixel/tones'
import { Tex } from '../shared/Tex'
import { formatNumber } from '../shared/lib/num'
import { toneFill, toneInk } from '../shared/palette'
import { useComma, useCopy, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { HEAT_PROPERTIES, HEAT_UNIT, covalentRadius, discovery, propertyScale, propertyValue, scalePosition, type HeatProperty } from './lib/extra'

/** Tono curado de cada familia: vecinos en la tabla con tonos bien separados (como en la app Swift). */
const CATEGORY_TONE: Record<ElementCategory, CourseToneName | null> = {
  alkaliMetal: 'rose', alkalineEarthMetal: 'amber', transitionMetal: 'slate', postTransitionMetal: 'sage', metalloid: 'olive',
  reactiveNonmetal: 'teal', halogen: 'sand', nobleGas: 'navy', lanthanide: 'wine', actinide: 'coral', unknown: null
}
const PHASE_TONE: Record<StandardState, CourseToneName | null> = { solid: 'sand', liquid: 'slate', gas: 'coral', unknown: null }

type Mode = 'family' | 'heat' | 'state'

interface Saved {
  mode: Mode
  prop: HeatProperty
  kelvin: number
  selected: number
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export default function PeriodicTool(_props: ToolProps) {
  const { t, i18n } = useTranslation('tools')
  const lang = i18n.language.startsWith('es') ? 'es' : 'en'
  const { dark } = useTheme()
  const [saved, setSaved] = useStored<Saved>('aula.tools.periodic', { mode: 'family', prop: 'electronegativity', kelvin: 298, selected: 26 })
  const [hover, setHover] = useState<number | null>(null)
  const [focusCat, setFocusCat] = useState<ElementCategory | null>(null)
  const [hoverCat, setHoverCat] = useState<ElementCategory | null>(null)
  const [query, setQuery] = useState('')
  const selected = PeriodicTable.byNumber(saved.selected) ?? ALL_ELEMENTS[25]
  const shown = PeriodicTable.byNumber(hover ?? -1) ?? selected
  const scale = useMemo(() => propertyScale(ALL_ELEMENTS, saved.prop), [saved.prop])

  const matches = useMemo(() => {
    const q = fold(query.trim())
    if (!q) return null
    return new Set(
      ALL_ELEMENTS.filter((e) => String(e.atomicNumber) === q || fold(e.symbol).startsWith(q) || fold(localizedElementName(e, lang)).includes(q) || fold(e.englishName).includes(q)).map((e) => e.atomicNumber)
    )
  }, [query, lang])
  const activeCat = hoverCat ?? focusCat
  const isDim = (e: Element) => (matches ? !matches.has(e.atomicNumber) : activeCat ? e.category !== activeCat : false)

  const select = (z: number) => setSaved((s) => ({ ...s, selected: z }))

  const look = (e: Element): { bg: string; edge: string; fg: string; sub: string } => {
    if (saved.mode === 'heat') {
      const v = propertyValue(e, saved.prop)
      if (v === null) return { bg: 'var(--fill1)', edge: 'var(--line-soft)', fg: 'var(--text3)', sub: 'var(--text3)' }
      const p = scalePosition(v, scale)
      const pct = Math.round(6 + p * 84)
      const strong = pct > 52
      return { bg: `color-mix(in oklab, var(--accent) ${pct}%, var(--surface))`, edge: 'transparent', fg: strong ? 'var(--on-accent)' : 'var(--text)', sub: strong ? 'color-mix(in oklab, var(--on-accent) 75%, transparent)' : 'var(--text3)' }
    }
    const tone = saved.mode === 'state' ? PHASE_TONE[phaseAt(e, saved.kelvin)] : CATEGORY_TONE[e.category]
    if (!tone) return { bg: 'var(--fill2)', edge: 'var(--line)', fg: 'var(--text2)', sub: 'var(--text3)' }
    return { bg: `color-mix(in oklab, ${toneFill(tone, dark)} ${dark ? 26 : 17}%, var(--surface))`, edge: `color-mix(in oklab, ${toneInk(tone, dark)} ${dark ? 34 : 24}%, transparent)`, fg: 'var(--text)', sub: toneInk(tone, dark) }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = selected
    let next: Element | null = null
    const at = (col: number, row: number) => ALL_ELEMENTS.find((x) => x.gridColumn === col && x.gridRow === row) ?? null
    if (e.key === 'ArrowRight') next = PeriodicTable.byNumber(cur.atomicNumber + 1)
    else if (e.key === 'ArrowLeft') next = PeriodicTable.byNumber(cur.atomicNumber - 1)
    else if (e.key === 'ArrowDown') next = at(cur.gridColumn, cur.gridRow + (cur.gridRow === 7 ? 2 : 1)) ?? null
    else if (e.key === 'ArrowUp') next = at(cur.gridColumn, cur.gridRow - (cur.gridRow === 9 ? 2 : 1)) ?? null
    if (next) {
      e.preventDefault()
      select(next.atomicNumber)
      requestAnimationFrame(() => (document.querySelector(`[data-z="${next!.atomicNumber}"]`) as HTMLElement | null)?.focus())
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card padded className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex items-center w-full @3xl:w-[260px]">
            <Search size={15} className="absolute left-3 text-text3 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches?.size) select(Math.min(...matches))
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder={t('periodic.search')}
              aria-label={t('periodic.search')}
              className="w-full h-9 rounded-[10px] bg-field border-[0.5px] border-line-strong/40 pl-9 pr-8 text-[14px] outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-wash)]"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2 text-text3 hover:text-text" aria-label={t('periodic.clear')}>
                <X size={14} />
              </button>
            )}
          </label>
          <SegmentedTabs
            size="sm"
            value={saved.mode}
            onChange={(mode) => setSaved((s) => ({ ...s, mode }))}
            items={[
              { id: 'family', label: t('periodic.mode.family') },
              { id: 'heat', label: t('periodic.mode.heat') },
              { id: 'state', label: t('periodic.mode.state') }
            ]}
          />
          {saved.mode === 'heat' && (
            <Select className="w-[230px]" value={saved.prop} onChange={(prop) => setSaved((s) => ({ ...s, prop }))} options={HEAT_PROPERTIES.map((p) => ({ value: p, label: t(`periodic.prop.${p}`) }))} />
          )}
          {saved.mode === 'state' && (
            <div className="w-full @3xl:w-[300px]">
              <Slider label={t('periodic.temperature')} min={0} max={6000} step={1} value={saved.kelvin} onChange={(k) => setSaved((s) => ({ ...s, kelvin: k }))} format={(k) => `${k} K · ${formatNumber(k - 273.15, { sig: 5, maxDecimals: 0 })} °C`} />
            </div>
          )}
        </div>
        <AnimatePresence initial={false} mode="wait">
          {saved.mode === 'family' && (
            <motion.div key="fam" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap gap-1.5">
              {ELEMENT_CATEGORIES.map((c) => {
                const tone = CATEGORY_TONE[c]
                const on = focusCat === c
                const count = ALL_ELEMENTS.filter((e) => e.category === c).length
                return (
                  <button
                    key={c}
                    onClick={() => setFocusCat((x) => (x === c ? null : c))}
                    onMouseEnter={() => setHoverCat(c)}
                    onMouseLeave={() => setHoverCat(null)}
                    className={cx('h-7 pl-2 pr-2.5 rounded-full inline-flex items-center gap-1.5 t-ui transition-colors border-[0.5px]', on ? 'bg-accent-wash border-accent-line text-text' : 'border-line hover:bg-fill1 text-text2')}
                  >
                    <span className="w-3 h-3 rounded-[3px]" style={{ background: tone ? toneFill(tone, dark) : 'var(--fill4)', opacity: 0.75 }} />
                    {localizedCategoryTitle(c, lang)}
                    <span className="t-caption tabular">{count}</span>
                  </button>
                )
              })}
            </motion.div>
          )}
          {saved.mode === 'state' && (
            <motion.div key="st" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap gap-4 t-ui text-text2">
              {(['solid', 'liquid', 'gas', 'unknown'] as StandardState[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-[3px]" style={{ background: PHASE_TONE[s] ? toneFill(PHASE_TONE[s] as CourseToneName, dark) : 'var(--fill4)', opacity: 0.75 }} />
                  {localizedStateTitle(s, lang)}
                  <span className="t-caption tabular">{ALL_ELEMENTS.filter((e) => phaseAt(e, saved.kelvin) === s).length}</span>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <Card padded className="overflow-x-auto">
        <div
          role="grid"
          aria-label={t('periodic.name')}
          onKeyDown={onKey}
          className="relative grid gap-[3px] min-w-[620px]"
          style={{ gridTemplateColumns: 'repeat(18, minmax(0, 1fr))', gridTemplateRows: 'repeat(7, auto) 10px repeat(2, auto)' }}
          onMouseLeave={() => setHover(null)}
        >
          {ALL_ELEMENTS.map((e) => (
            <Cell key={e.atomicNumber} e={e} look={look(e)} dim={isDim(e)} selected={e.atomicNumber === selected.atomicNumber} onHover={setHover} onSelect={select} lang={lang} />
          ))}
          <SeriesMarker col={3} row={6} label="57–71" />
          <SeriesMarker col={3} row={7} label="89–103" />
          <Featured e={shown} mode={saved.mode} prop={saved.prop} kelvin={saved.kelvin} scale={scale} lang={lang} />
        </div>
      </Card>

      <Detail e={selected} lang={lang} />
    </div>
  )
}

// MARK: Celda

const Cell = memo(function Cell({ e, look, dim, selected, onHover, onSelect, lang }: {
  e: Element
  look: { bg: string; edge: string; fg: string; sub: string }
  dim: boolean
  selected: boolean
  onHover: (z: number | null) => void
  onSelect: (z: number) => void
  lang: string
}) {
  const { reducedMotion } = useTheme()
  // la entrada va en ola (por posición); después, los cambios son inmediatos
  const first = useRef(true)
  useEffect(() => {
    const id = window.setTimeout(() => (first.current = false), 1200)
    return () => clearTimeout(id)
  }, [])
  const delay = first.current ? (e.gridColumn + e.gridRow) * 0.014 : 0
  return (
    <motion.button
      data-z={e.atomicNumber}
      role="gridcell"
      tabIndex={selected ? 0 : -1}
      aria-label={`${localizedElementName(e, lang)}, ${e.atomicNumber}`}
      aria-selected={selected}
      onMouseEnter={() => onHover(e.atomicNumber)}
      onFocus={() => onHover(e.atomicNumber)}
      onClick={() => onSelect(e.atomicNumber)}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: dim ? 0.22 : 1, scale: dim ? 0.92 : 1, backgroundColor: look.bg }}
      whileHover={reducedMotion ? undefined : { scale: 1.32, zIndex: 20, boxShadow: 'var(--e3)', transition: spring.snappy }}
      transition={{ opacity: { duration: 0.25, delay }, scale: { ...spring.smooth, delay }, backgroundColor: { duration: 0.45 } }}
      className={cx('relative aspect-square rounded-[7px] flex flex-col items-center justify-center outline-none min-w-0', selected && 'z-10')}
      style={{ gridColumn: e.gridColumn, gridRow: e.gridRow, boxShadow: selected ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)' : `inset 0 0 0 0.5px ${look.edge}`, color: look.fg }}
    >
      <span className="absolute top-[3px] left-[4px] text-[9px] leading-none tabular" style={{ color: look.sub }}>
        {e.atomicNumber}
      </span>
      <span className="text-[clamp(11px,1.45cqw,19px)] font-semibold leading-none tracking-[-0.01em]">{e.symbol}</span>
    </motion.button>
  )
})

function SeriesMarker({ col, row, label }: { col: number; row: number; label: string }) {
  return (
    <div className="aspect-square rounded-[7px] grid place-items-center border-[0.5px] border-dashed border-line-strong/50 text-[9px] text-text3 tabular" style={{ gridColumn: col, gridRow: row }}>
      {label}
    </div>
  )
}

// MARK: Ficha del hueco central

function Featured({ e, mode, prop, kelvin, scale, lang }: { e: Element; mode: Mode; prop: HeatProperty; kelvin: number; scale: { min: number; max: number; log: boolean }; lang: string }) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const { dark } = useTheme()
  const tone = CATEGORY_TONE[e.category]
  const ink = tone ? toneInk(tone, dark) : 'var(--text2)'
  const v = propertyValue(e, prop)
  const config = ElectronConfiguration.groundState(e).text({ abbreviated: true, notation: 'latex' })
  return (
    <div className="flex items-stretch gap-3 px-2 py-1 min-w-0" style={{ gridColumn: '3 / span 10', gridRow: '1 / span 3' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={e.atomicNumber} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="flex items-center gap-4 min-w-0 flex-1">
          <div className="relative shrink-0 w-[clamp(64px,9cqw,104px)] aspect-square rounded-[14px] grid place-items-center" style={{ background: tone ? `color-mix(in oklab, ${toneFill(tone, dark)} ${dark ? 26 : 17}%, var(--surface))` : 'var(--fill2)', boxShadow: `inset 0 0 0 0.5px ${ink}` }}>
            <span className="absolute top-1.5 left-2 text-[11px] tabular" style={{ color: ink }}>
              {e.atomicNumber}
            </span>
            <span className="font-serif text-[clamp(28px,4cqw,46px)] leading-none">{e.symbol}</span>
            <span className="absolute bottom-1.5 text-[10px] tabular text-text3">{e.atomicWeight.text}</span>
          </div>
          <div className="min-w-0">
            <div className="font-serif text-[clamp(17px,2.2cqw,26px)] leading-tight truncate">{localizedElementName(e, lang)}</div>
            <div className="t-ui truncate" style={{ color: ink }}>
              {localizedCategoryTitle(e.category, lang)}
            </div>
            <div className="text-[13px] text-text2 mt-1 whitespace-nowrap overflow-hidden">
              <Tex tex={config} />
            </div>
            {mode === 'heat' && (
              <div className="mt-1 t-ui text-text">
                {t(`periodic.prop.${prop}`)}: <span className="tabular font-semibold">{v === null ? '—' : prop === 'discovery' ? discoveryText(e.atomicNumber, t) : `${formatNumber(v, { comma, sig: 4 })} ${HEAT_UNIT[prop]}`}</span>
              </div>
            )}
            {mode === 'state' && <div className="mt-1 t-ui text-text">{t('periodic.stateAt', { state: localizedStateTitle(phaseAt(e, kelvin), lang).toLowerCase(), k: kelvin })}</div>}
          </div>
          {mode === 'family' && (
            <div className="hidden @5xl:grid grid-cols-2 gap-x-5 gap-y-2 ml-auto pl-4 border-l-[0.5px] border-line-soft shrink-0">
              <Mini k={t('periodic.f.en')} v={e.electronegativity === null ? '—' : formatNumber(e.electronegativity, { comma, sig: 3 })} />
              <Mini k={t('periodic.f.radius')} v={covalentRadius(e.atomicNumber) === null ? '—' : `${covalentRadius(e.atomicNumber)} pm`} />
              <Mini k={t('periodic.f.ie')} v={e.firstIonizationEnergy === null ? '—' : `${formatNumber(e.firstIonizationEnergy, { comma, sig: 4 })} kJ/mol`} />
              <Mini k={t('periodic.f.state')} v={<span className="inline-flex items-center gap-1.5"><StateSprite state={e.standardState} />{localizedStateTitle(e.standardState, lang)}</span>} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {mode === 'heat' && <HeatLegend prop={prop} scale={scale} />}
    </div>
  )
}

function Mini({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="t-caption">{k}</div>
      <div className="t-ui font-semibold tabular text-text whitespace-nowrap">{v}</div>
    </div>
  )
}

function HeatLegend({ prop, scale }: { prop: HeatProperty; scale: { min: number; max: number; log: boolean } }) {
  const comma = useComma()
  const { t } = useTranslation('tools')
  const lo = scale.log ? Math.pow(10, scale.min) : scale.min
  const hi = scale.log ? Math.pow(10, scale.max) : scale.max
  const fmt = (x: number) => (prop === 'discovery' ? (x <= 1000 ? t('periodic.ancient') : String(Math.round(x))) : formatNumber(x, { comma, sig: 3 }))
  return (
    <div className="hidden @4xl:flex flex-col justify-end pb-2 shrink-0 w-[150px]">
      <div className="flex gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => (
          <motion.span key={i} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.03 }} className="h-3 flex-1 rounded-[2px]" style={{ background: `color-mix(in oklab, var(--accent) ${Math.round(6 + (i / 9) * 84)}%, var(--surface))` }} />
        ))}
      </div>
      <div className="flex justify-between t-caption mt-1 tabular">
        <span>{fmt(lo)}</span>
        <span>
          {fmt(hi)} {HEAT_UNIT[prop]}
        </span>
      </div>
    </div>
  )
}

function discoveryText(z: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const d = discovery(z)
  if (!d) return '—'
  if (d === 'ancient') return t('periodic.ancient')
  return d.approx ? t('periodic.circa', { year: d.year }) : String(d.year)
}

// MARK: Ficha completa

function Detail({ e, lang }: { e: Element; lang: string }) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const copy = useCopy()
  const { dark } = useTheme()
  const tone = CATEGORY_TONE[e.category]
  const ink = tone ? toneInk(tone, dark) : 'var(--text2)'
  const conf = ElectronConfiguration.groundState(e)
  const fmt = (x: number | null, sig = 5) => (x === null ? '—' : formatNumber(x, { comma, sig }))
  const kelvin = (k: number | null) => (k === null ? '—' : `${fmt(k)} K · ${fmt(k - 273.15)} °C`)
  const ox = e.commonOxidationStates.map((x) => (x > 0 ? `+${x}` : `−${-x}`)).join(', ')
  const groupText = e.category === 'lanthanide' || e.category === 'actinide' ? t('periodic.fSeries', { period: e.period }) : t('periodic.groupPeriod', { group: e.group, period: e.period })
  const name = localizedElementName(e, lang)
  return (
    <Card padded="lg">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={e.atomicNumber} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }} className="flex flex-col @4xl:flex-row gap-8">
          <div className="flex flex-col items-center gap-2 shrink-0">
            <Bohr e={e} ink={ink} fill={tone ? toneFill(tone, dark) : 'var(--text3)'} />
            <div className="t-callout font-medium text-text2 tabular">{t('periodic.shells', { shells: conf.shells.join(' · ') })}</div>
            {e.valenceElectrons !== null && <div className="t-footnote">{t('periodic.valence', { count: e.valenceElectrons })}</div>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="t-title1">{name}</h2>
              <span className="font-serif text-[22px] text-text2">{e.symbol}</span>
              {lang === 'es' && <span className="t-footnote">{t('periodic.inEnglish', { name: e.englishName })}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className="t-ui font-medium" style={{ color: ink }}>
                {localizedCategoryTitle(e.category, lang)}
              </span>
              <span className="inline-flex items-center gap-1.5 t-ui text-text2">
                <StateSprite state={e.standardState} />
                {t('periodic.at25', { state: localizedStateTitle(e.standardState, lang) })}
              </span>
              {e.isConfigurationPredicted && <span className="t-ui text-warning">{t('periodic.predicted')}</span>}
            </div>
            <div className="grid grid-cols-2 @3xl:grid-cols-3 gap-x-6 gap-y-4 mt-5">
              <Prop k={t('periodic.f.z')} v={String(e.atomicNumber)} hint={t('periodic.h.z')} />
              <Prop k={t('periodic.f.mass')} v={`${e.atomicWeight.isStandard ? (comma ? e.atomicWeight.text.replace('.', ',') : e.atomicWeight.text) : e.atomicWeight.text} u`} hint={e.atomicWeight.isStandard ? t('periodic.h.mass') : t('periodic.h.massNumber')} />
              <Prop k={t('periodic.f.position')} v={groupText} hint={t('periodic.blockOf', { block: e.block })} />
              <Prop k={t('periodic.f.en')} v={e.electronegativity === null ? '—' : formatNumber(e.electronegativity, { comma, sig: 3 })} hint={t('periodic.h.en')} />
              <Prop k={t('periodic.f.radius')} v={covalentRadius(e.atomicNumber) === null ? '—' : `${covalentRadius(e.atomicNumber)} pm`} hint={t('periodic.h.radius')} />
              <Prop k={t('periodic.f.ie')} v={e.firstIonizationEnergy === null ? '—' : `${fmt(e.firstIonizationEnergy)} kJ/mol`} hint={t('periodic.h.ie')} />
              <Prop k={t('periodic.f.density')} v={e.density === null ? '—' : `${fmt(e.density)} ${e.densityUnit}`} hint={e.standardState === 'gas' ? t('periodic.h.gasDensity') : undefined} />
              <Prop k={t('periodic.f.melting')} v={kelvin(e.meltingPoint)} hint={e.sublimationPoint !== null ? t('periodic.h.sublimes', { t: kelvin(e.sublimationPoint) }) : undefined} />
              <Prop k={t('periodic.f.boiling')} v={kelvin(e.boilingPoint)} />
              <Prop k={t('periodic.f.ox')} v={ox || '—'} hint={t('periodic.h.ox')} />
              <Prop k={t('periodic.f.discovery')} v={discoveryText(e.atomicNumber, t)} />
            </div>
            <div className="mt-5 rounded-[14px] bg-sunken border-[0.5px] border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="t-eyebrow">{t('periodic.config')}</span>
                <IconButton label={t('common.copy')} size="sm" onClick={() => copy(conf.text({ abbreviated: true, notation: 'plain' }))}>
                  <Copy size={13} />
                </IconButton>
              </div>
              <div className="text-[18px] mt-1 overflow-x-auto overflow-y-hidden">
                <Tex tex={conf.text({ abbreviated: true, notation: 'latex' })} />
              </div>
              {e.atomicNumber > 2 && <div className="t-mono text-text2 mt-1 break-words selectable">{conf.text({ notation: 'unicode' })}</div>}
              {ElectronConfiguration.isException(e) && <div className="t-footnote mt-1.5 text-warning">{t('periodic.exception', { aufbau: ElectronConfiguration.aufbau(e.atomicNumber).text({ abbreviated: true, notation: 'unicode' }) })}</div>}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </Card>
  )
}

function Prop({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="t-footnote">{k}</div>
      <div className="t-headline tabular mt-0.5 selectable">{v}</div>
      {hint && <div className="t-caption mt-0.5">{hint}</div>}
    </div>
  )
}

// MARK: Modelo de Bohr

/** Modelo de Bohr: núcleo con el tono de la familia y electrones que giran en sus capas (las de dentro, más deprisa). */
function Bohr({ e, ink, fill }: { e: Element; ink: string; fill: string }) {
  const { reducedMotion } = useTheme()
  const shells = ElectronConfiguration.groundState(e).shells
  const size = 220
  const c = size / 2
  const nucleus = 22
  const inner = nucleus + 10
  const outer = c - 6
  const n = Math.max(1, shells.length)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Bohr ${e.symbol}: ${shells.join(', ')}`}>
      {shells.map((count, i) => {
        const r = n === 1 ? (inner + outer) / 2 : inner + ((outer - inner) * i) / (n - 1)
        const dot = Math.max(2, Math.min(3.6, 26 / (n + 3)))
        return (
          <g key={i}>
            <motion.circle cx={c} cy={c} r={r} fill="none" stroke="var(--line-strong)" strokeOpacity={0.45} strokeWidth={1} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: i * 0.08 }} />
            <g transform={`rotate(${i * 23} ${c} ${c})`}>
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.2 + i * 0.08 }}>
                <g style={reducedMotion ? undefined : { transformOrigin: `${c}px ${c}px`, transformBox: 'view-box', animation: `aula-spin ${9 + i * 5}s linear infinite`, animationDirection: i % 2 ? 'reverse' : 'normal' }}>
                  {Array.from({ length: count }, (_, k) => {
                    const a = (2 * Math.PI * k) / count
                    return <circle key={k} cx={c + r * Math.cos(a)} cy={c + r * Math.sin(a)} r={dot} fill={ink} />
                  })}
                </g>
              </motion.g>
            </g>
          </g>
        )
      })}
      <motion.circle cx={c} cy={c} r={nucleus} fill={fill} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.bouncy} />
      <text x={c} y={c + 6} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fff" fontFamily="var(--font-sans)">
        {e.symbol}
      </text>
    </svg>
  )
}

// MARK: Pixel-art del estado

const SOLID = [
  ['..aaaaa.', '.abbbbaa', 'aaaaaaba', 'acccca.a', 'accccaba', 'accccab.', 'acccca..', 'aaaaaa..'],
  ['..aaaaa.', '.abbbbaa', 'aaaaaaba', 'ahccca.a', 'accccaba', 'accccab.', 'acccca..', 'aaaaaa..']
]
const LIQUID = [
  ['...a....', '...a....', '..aba...', '..abba..', '.abhbba.', '.abbbba.', '.abbbba.', '..aaaa..'],
  ['........', '...a....', '...a....', '..aba...', '.abbba..', '.ahbbba.', '.abbbba.', '..aaaa..']
]
const GAS = [
  ['........', '.aa.....', 'abba..a.', '.aa..aba', '.....aa.', '..a.....', '.aba....', '..a.....'],
  ['........', '..aa....', '.abba..a', '..aa..ab', '......aa', '...a....', '..aba...', '...a....']
]

function StateSprite({ state }: { state: StandardState }) {
  const { reducedMotion, dark } = useTheme()
  const [f, setF] = useState(0)
  const timer = useRef<number | null>(null)
  const moving = useAmbient()
  useEffect(() => {
    if (reducedMotion || !moving || state === 'unknown') return
    timer.current = window.setInterval(() => setF((v) => 1 - v), state === 'gas' ? 520 : 760)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [reducedMotion, moving, state])
  if (state === 'unknown') return null
  const tone = PHASE_TONE[state] as CourseToneName
  const rows = (state === 'solid' ? SOLID : state === 'liquid' ? LIQUID : GAS)[f]
  return <Sprite rows={rows} legend={{ a: toneInk(tone, dark), b: `color-mix(in oklab, ${toneFill(tone, dark)} 45%, transparent)`, c: `color-mix(in oklab, ${toneFill(tone, dark)} 25%, transparent)`, h: '#fff' }} size={16} />
}
