// Visor 3D (`model3d`): moléculas por fórmula o por átomos (geometría VSEPR con pares libres y ángulos de enlace; bolas y
// varillas, esferas o varillas), redes cristalinas, sólidos con sus medidas y modelos del curso (OBJ, GLB…). Se gira
// arrastrando, gira solo hasta que lo tocas y vuelve a la vista inicial. three.js se carga solo aquí y solo cuando hace falta.
// Al imprimir, imagen fija; sin WebGL, una ficha limpia. Port de StudyUI/Blocks/Model3D/Model3DView.swift.
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, Menu, Spinner, cx, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import { ALL_ELEMENTS, localizedElementName } from '@engine/chem/elements'
import type { BlockProps } from '../types'
import { elementSymbol, moleculeFor, parseFormula, safe } from './lib/molecules'
import { RichText } from '@renderer/lib/RichText'
import { sanitizeSolid } from './lib/solids'
import { formatSimValue } from './lib/simulation'
import { cpkColor, resolveCss, vizColor } from './shared/colors'
import { BlockHeader, Caption, Credit, GlassBar, GlassButton, useInView, useInk, useSize } from './shared/ui'
import type { ScenePalette } from './model3d/Scene3D'

const Scene3D = lazy(() => import('./model3d/Scene3D'))

type Style = 'ballstick' | 'spacefill' | 'stick'
const LOADABLE = new Set(['glb', 'gltf', 'obj', 'stl', 'ply', 'dae', 'usdz'])

let webgl: boolean | undefined
function webglAvailable(): boolean {
  if (webgl !== undefined) return webgl
  try {
    const c = document.createElement('canvas')
    webgl = !!(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    webgl = false
  }
  return webgl
}

const ORDER: Record<string, number> = { C: 0, H: 1, N: 2, O: 3 }

export default function Model3DBlock({ block, ctx }: BlockProps<BlockOf<'model3d'>>) {
  const { t, i18n } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { dark, reducedMotion } = useTheme()
  const print = ctx.mode === 'print'
  const lang = ctx.language || i18n.language
  const sep = lang.startsWith('en') ? '.' : ','
  const b = useMemo(() => ({
    ...block,
    atoms: block.atoms.map((a) => ({ ...a, x: safe(a.x), y: safe(a.y), z: safe(a.z) })),
    solids: block.solids.map(sanitizeSolid),
    labels: block.labels.map((l) => ({ ...l, x: safe(l.x), y: safe(l.y), z: safe(l.z) }))
  }), [block])
  const molecule = useMemo(() => moleculeFor(b), [b])
  const [style, setStyle] = useState<Style>(() => (['ballstick', 'spacefill', 'stick'].includes(b.style) ? (b.style as Style) : 'ballstick'))
  const [showLabels, setShowLabels] = useState(b.atomLabels || (molecule !== undefined && molecule.atoms.length <= 12 && style !== 'spacefill'))
  const [showAngles, setShowAngles] = useState(molecule?.geometry !== undefined && !molecule.geometry.endsWith('Lattice'))
  const [autoRotate, setAutoRotate] = useState(b.autoRotate && !reducedMotion && !print)
  const [resetToken, setResetToken] = useState(0)
  const [modelFailed, setModelFailed] = useState(false)
  const [box, size] = useSize<HTMLDivElement>()
  const visible = useInView(box, false, '120px')

  const ext = b.asset?.split('.').pop()?.toLowerCase() ?? ''
  const modelUrl = b.asset && LOADABLE.has(ext) ? ctx.assetUrl(b.asset) : undefined
  const assetBroken = !!b.asset && (!LOADABLE.has(ext) || modelFailed)
  const nothing = !molecule && b.solids.length === 0 && b.labels.length === 0 && !modelUrl
  const gl = typeof document !== 'undefined' && webglAvailable()

  // colores reales del tema para three.js (no entiende `var(--…)`)
  const palette = useMemo<ScenePalette>(() => {
    const cache = new Map<string, string>()
    const res = (css: string): string => {
      let v = cache.get(css)
      if (!v) { v = resolveCss(css, box.current); cache.set(css, v) }
      return v
    }
    return { dark, color: (name, fallback) => res(vizColor(name, fallback)), cpk: (el) => cpkColor(el, dark), text: res('var(--text)'), text2: res('var(--text2)') }
  }, [dark, box])

  const elements = useMemo(() => {
    if (!molecule) return []
    const set = [...new Set(molecule.atoms.map((a) => elementSymbol(a.element)))]
    return set.sort((x, y) => (ORDER[x] ?? 4) - (ORDER[y] ?? 4) || x.localeCompare(y)).slice(0, 12)
  }, [molecule])
  const elementName = (sym: string): string => {
    const e = ALL_ELEMENTS.find((x) => x.symbol === sym)
    return e ? localizedElementName(e, lang) : sym
  }
  const info = [molecule?.vsepr, molecule?.geometry ? t(`model.geometry.${molecule.geometry}`) : undefined].filter(Boolean).join(' · ')
  const onUserMove = useCallback(() => setAutoRotate(false), [])
  const formatNumber = useCallback((v: number) => formatSimValue(v, undefined, sep), [sep])
  const fallback = !gl || nothing || (assetBroken && !molecule && b.solids.length === 0)
  const H = fallback ? 200 : print ? 300 : ctx.mode === 'chat' ? 280 : Math.round(Math.min(440, Math.max(300, size.width * 0.5)))

  return (
    <section className="flex flex-col gap-3" style={ink} aria-label={[b.title, b.alt, info].filter(Boolean).join('. ') || t('model.eyebrow')}>
      <BlockHeader icon="layers" eyebrow={t('model.eyebrow')} title={b.title} actions={info ? <span className="t-footnote text-text3">{info}</span> : undefined} />
      <div ref={box} className="relative isolate w-full overflow-hidden rounded-[18px] bg-sunken border-[0.5px] border-line" style={{ height: H }}>
        {fallback ? (
          <FallbackCard broken={assetBroken || nothing} formula={b.formula} info={info} noGL={!gl} />
        ) : (
          size.width > 0 && (
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center"><Spinner size={18} /></div>}>
              <Scene3D
                block={b}
                molecule={molecule}
                style={style}
                showLabels={showLabels}
                showAngles={showAngles}
                autoRotate={autoRotate}
                onUserMove={onUserMove}
                resetToken={resetToken}
                palette={palette}
                modelUrl={modelFailed ? undefined : modelUrl}
                print={print}
                active={visible || print}
                formatNumber={formatNumber}
                onModelError={() => setModelFailed(true)}
              />
            </Suspense>
          )
        )}
        {!print && !fallback && (
          <>
            <div className="absolute right-2 top-2 flex gap-1.5">
              <GlassBar>
                {molecule && (
                  <Menu
                    trigger={(open) => (
                      <GlassButton label={t('model.style')} onClick={open}>
                        <span className="px-1 inline-flex items-center gap-1">{t(`model.styles.${style}`)}<Icon name="chevron-down" size={11} /></span>
                      </GlassButton>
                    )}
                    items={[
                      ...(['ballstick', 'spacefill', 'stick'] as Style[]).map((s) => ({ label: t(`model.styles.${s}`), icon: s === style ? <Icon name="check" size={13} /> : <span className="w-[13px]" />, onSelect: () => setStyle(s) })),
                      { label: showLabels ? t('model.hideLabels') : t('model.showLabels'), icon: <Icon name={showLabels ? 'eye-off' : 'eye'} size={13} />, onSelect: () => setShowLabels((v) => !v), separatorBefore: true },
                      ...(molecule.geometry && !molecule.geometry.endsWith('Lattice') ? [{ label: showAngles ? t('model.hideAngles') : t('model.showAngles'), icon: <Icon name="activity" size={13} />, onSelect: () => setShowAngles((v) => !v) }] : [])
                    ]}
                  />
                )}
                <GlassButton label={autoRotate ? t('model.stopSpin') : t('model.spin')} onClick={() => setAutoRotate((v) => !v)} active={autoRotate}>
                  <Icon name={autoRotate ? 'pause' : 'play'} size={12} />
                </GlassButton>
                <GlassButton label={t('model.reset')} onClick={() => { setResetToken((k) => k + 1); setAutoRotate(b.autoRotate && !reducedMotion) }}>
                  <Icon name="refresh" size={12} />
                </GlassButton>
              </GlassBar>
            </div>
            <div className="pointer-events-none absolute left-2.5 bottom-2 t-caption text-text3 bg-raised/70 rounded-full px-2 py-0.5">{t('model.hint', { mod: /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl' })}</div>
          </>
        )}
        {assetBroken && !fallback && <div className="absolute left-2.5 top-2 t-caption text-danger bg-raised/80 rounded-full px-2 py-0.5">{t('model.broken')}</div>}
      </div>
      {elements.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {elements.map((el) => (
            <span key={el} className="inline-flex items-center gap-1.5 t-footnote text-text2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: cpkColor(el, dark), boxShadow: 'inset 0 0 0 0.5px var(--line-strong)' }} />
              <span className="font-semibold text-text">{el}</span> {elementName(el)}
            </span>
          ))}
        </div>
      )}
      <Caption text={b.caption} />
      <Credit text={b.credit} />
    </section>
  )
}

function FallbackCard({ broken, formula, info, noGL }: { broken: boolean; formula?: string; info: string; noGL: boolean }) {
  const { t } = useTranslation('visual')
  return (
    <div className={cx('absolute inset-0 grid place-items-center text-center px-6')}>
      <div className="flex flex-col items-center gap-2">
        <Icon name="layers" size={26} className="text-text3" />
        {formula && (
          <div className="font-serif text-[28px] leading-9 text-text">
            <RichText text={parseFormula(formula) ? `$\\ce{${formula}}$` : formula} inline />
          </div>
        )}
        {info && <div className="t-callout text-text2">{info}</div>}
        <div className="t-footnote text-text3 max-w-[340px]">{broken && !formula ? t('model.broken') : noGL ? t('model.noGL') : t('model.empty')}</div>
      </div>
    </div>
  )
}
