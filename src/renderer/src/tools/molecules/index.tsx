// Moléculas en 3D: eliges una de la biblioteca o escribes una fórmula ABₙ (CH4, SF6, XeF4, NH4+…) y la ves con su forma
// VSEPR real, girando despacio. Ficha con la notación AXₙEₘ, ángulos, hibridación y polaridad.
import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Pause, RotateCw } from 'lucide-react'
import { Card, IconButton, SegmentedTabs, Spinner, Switch, cx, useTheme } from '@renderer/design'
import { parseFormula } from '@engine/chem/parser'
import { Tex } from '../shared/Tex'
import { formatNumber } from '../shared/lib/num'
import { CardTitle, ErrorLine, KV, TextInput, useComma, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { LIBRARY, moleculeFor, type Molecule } from './lib/vsepr'

const Viewer = lazy(() => import('./Viewer'))
const Flat = lazy(() => import('./Flat'))

/** ¿Hay WebGL? (en máquinas virtuales o con la aceleración desactivada puede faltar). */
let webgl: boolean | null = null
function hasWebGL(): boolean {
  if (webgl !== null) return webgl
  try {
    const c = document.createElement('canvas')
    webgl = !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    webgl = false
  }
  return webgl
}

/** Si el visor 3D falla al crear el contexto, se queda la vista plana en vez de romper la pantalla. */
class Fallback3D extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch() {
    webgl = false
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

interface Saved {
  formula: string
  mode: 'ball' | 'fill'
  lone: boolean
  rotate: boolean
}

const ceOf = (f: string) => {
  try {
    return parseFormula(f).ce
  } catch {
    return `\\text{${f}}`
  }
}

export default function MoleculesTool(_props: ToolProps) {
  const { t } = useTranslation('tools')
  const comma = useComma()
  const { dark, reducedMotion } = useTheme()
  const [s, setS] = useStored<Saved>('aula.tools.molecules', { formula: 'H2O', mode: 'ball', lone: true, rotate: true })
  const [draft, setDraft] = useState(s.formula)
  const res = useMemo(() => moleculeFor(s.formula), [s.formula])
  const draftRes = useMemo(() => (draft.trim() && draft.trim() !== s.formula ? moleculeFor(draft.trim()) : null), [draft, s.formula])
  const m: Molecule | null = res.ok ? res.molecule : null
  const pick = (f: string) => {
    setDraft(f)
    setS((p) => ({ ...p, formula: f }))
  }
  const deg = (x: number) => `${formatNumber(x, { comma, sig: 4, maxDecimals: 1 })}°`
  const angleLabel = m && m.angles.length ? deg(m.angles[0]) : null
  const name = m ? t(`molecules.names.${m.formula.replace(/\s+/g, '')}`, { defaultValue: '' }) : ''
  const elements = m ? [...new Set(m.atoms.map((a) => a.el))] : []

  return (
    <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <Card padded={false} className="relative overflow-hidden h-[clamp(420px,66vh,720px)]">
        {m ? (
          <Suspense fallback={<div className="absolute inset-0 grid place-items-center"><Spinner size={22} /></div>}>
            {hasWebGL() ? (
              <Fallback3D fallback={<Flat molecule={m} mode={s.mode} showLone={s.lone} rotate={s.rotate} dark={dark} reducedMotion={reducedMotion} />}>
                <Viewer molecule={m} mode={s.mode} showLone={s.lone} rotate={s.rotate} dark={dark} reducedMotion={reducedMotion} angleLabel={angleLabel} />
              </Fallback3D>
            ) : (
              <Flat molecule={m} mode={s.mode} showLone={s.lone} rotate={s.rotate} dark={dark} reducedMotion={reducedMotion} />
            )}
          </Suspense>
        ) : (
          <div className="absolute inset-0 grid place-items-center t-callout text-text3">{t('molecules.none')}</div>
        )}
        <div className="pointer-events-none absolute top-5 left-6 right-6 flex items-start justify-between gap-4">
          <AnimatePresence mode="wait">
            {m && (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="min-w-0">
                <div className="text-[30px] leading-tight">
                  <Tex tex={ceOf(m.formula)} />
                </div>
                {name && <div className="t-callout text-text2 first-letter:uppercase">{name}</div>}
                <div className="t-ui text-accent-text mt-0.5">{t(`molecules.shape.${m.shape}`)}</div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="pointer-events-auto flex items-center gap-2 rounded-[14px] bg-raised/90 border-[0.5px] border-line shadow-[var(--e2)] p-1.5 backdrop-blur">
            <SegmentedTabs
              size="sm"
              value={s.mode}
              onChange={(mode) => setS((p) => ({ ...p, mode }))}
              items={[
                { id: 'ball', label: t('molecules.ball') },
                { id: 'fill', label: t('molecules.fill') }
              ]}
            />
            <IconButton label={s.rotate ? t('molecules.stop') : t('molecules.rotate')} size="sm" active={s.rotate} onClick={() => setS((p) => ({ ...p, rotate: !p.rotate }))}>
              {s.rotate ? <Pause size={14} /> : <RotateCw size={14} />}
            </IconButton>
          </div>
        </div>
        {m && (
          <div className="pointer-events-none absolute bottom-4 left-6 flex flex-wrap gap-3 t-caption">
            {elements.map((el) => (
              <span key={el} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full border-[0.5px] border-line" style={{ background: atomSwatch(el, dark) }} />
                {el}
              </span>
            ))}
            {s.lone && m.lone.length > 0 && s.mode === 'ball' && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(227,165,78,.45)' }} />
                {t('molecules.lonePair')}
              </span>
            )}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-4 right-6 t-caption">{t('molecules.dragHint')}</div>
      </Card>

      <div className="flex flex-col gap-4 min-w-0">
        <Card padded>
          <TextInput
            value={draft}
            onChange={setDraft}
            onEnter={() => draftRes?.ok && pick(draft.trim())}
            mono
            label={t('molecules.formula')}
            placeholder="SF6, XeF4, NH4+…"
            invalid={!!draftRes && !draftRes.ok}
          />
          {draftRes && (
            <div className="mt-2">
              {draftRes.ok ? (
                <button onClick={() => pick(draft.trim())} className="t-ui text-accent-text hover:underline">
                  {t('molecules.show', { shape: t(`molecules.shape.${draftRes.molecule.shape}`) })}
                </button>
              ) : (
                <ErrorLine>{t(`molecules.err.${draftRes.reason}`)}</ErrorLine>
              )}
            </div>
          )}
          {LIBRARY.map((g) => (
            <div key={g.group} className="mt-4">
              <div className="t-eyebrow mb-2">{t(`molecules.group.${g.group}`)}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.formulas.map((f) => (
                  <button key={f} onClick={() => pick(f)} className={cx('h-8 px-2.5 rounded-[10px] text-[13px] transition-colors', s.formula === f ? 'bg-accent-wash text-accent-text' : 'bg-fill2 hover:bg-fill3 text-text')}>
                    <Tex tex={ceOf(f)} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
        {m && (
          <Card padded>
            <CardTitle title={t('molecules.facts')} />
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              <KV k={t('molecules.geometry')} v={t(`molecules.shape.${m.shape}`)} />
              {m.axe && <KV k={t('molecules.axe')} v={<Tex tex={`\\mathrm{AX}_{${m.axe.n}}${m.axe.m ? `\\mathrm{E}_{${m.axe.m}}` : ''}`} />} />}
              {m.angles.length > 0 && <KV k={t('molecules.angle')} v={m.angles.map(deg).join(' · ')} hint={m.compressed ? t('molecules.compressed') : undefined} />}
              {m.hybrid && <KV k={t('molecules.hybrid')} v={m.hybrid} />}
              <KV k={t('molecules.polarity')} v={m.polar ? t('molecules.polar') : t('molecules.nonpolar')} />
              {m.axe && <KV k={t('molecules.lonePairs')} v={String(m.axe.m)} />}
            </div>
            <p className="t-callout text-text2 mt-4">{t(`molecules.why.${m.shape}`)}</p>
            {m.axe && m.axe.m > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="t-ui text-text2">{t('molecules.showLone')}</span>
                <Switch size="sm" checked={s.lone} onChange={(lone) => setS((p) => ({ ...p, lone }))} label={t('molecules.showLone')} />
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}

const SW: Record<string, [string, string]> = { H: ['#f3efe7', '#e9e4da'], C: ['#4a4743', '#8d8781'], N: ['#3f6797', '#93b5e0'], O: ['#c8664a', '#ee9476'], F: ['#7db693', '#8cc7a3'], Cl: ['#3f7a5a', '#7db693'], Br: ['#a54a31', '#d48a6c'], I: ['#7c2937', '#da818a'], S: ['#e3a54e', '#e8ae5c'], P: ['#cf8a4e', '#e3a54e'], B: ['#cfb184', '#d4b88e'], Be: ['#a9b65a', '#b7c46e'], Xe: ['#2e4d7b', '#88a0c4'] }
const atomSwatch = (el: string, dark: boolean) => (SW[el] ?? ['#22767a', '#74c6c6'])[dark ? 1 : 0]
