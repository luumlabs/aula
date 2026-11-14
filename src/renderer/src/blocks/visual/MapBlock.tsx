// Mapa (`map`): plano propio del mundo sin conexión (Natural Earth con d3-geo), encuadrado en su contenido o en una región con
// nombre, con marcadores que caen en su sitio, países de verdad coloreados por su nombre (o por un valor: mapa de
// coropletas), regiones, rutas que se trazan (con sentido: arco y flecha) y una ficha con la explicación (Markdown) al
// pulsar. Los nombres se reparten para no pisarse. Con `practice`, «¿Dónde está…?» con marcadores y países. Zoom con los
// botones, Ctrl + rueda o el pellizco; arrastrar para moverse. Port de StudyUI/Blocks/Map/MapBlockView.swift; los países,
// los encuadres y las rutas con sentido, adaptados de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs:
// src/figures/map.ts.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { geoArea, geoContains, geoGraticule10, geoPath } from 'd3-geo'
import type { Feature, Polygon } from 'geojson'
import { Button, Icon, IconButton, cx, spring, useTheme } from '@renderer/design'
import type { BlockOf } from '@shared/schema/blocks'
import { RichText } from '@renderer/lib/RichText'
import { countryLabel, findCountry } from '@engine/geo/countries'
import type { BlockProps } from '../types'
import { formatNumber } from '../plot/ticks'
import { compactNumber } from '../chart/scale'
import { boundsAspect, fitProjection, mapBounds, needsDetail, regionFeature, regionIndexAt, routeFeature, routeMidpoint, sanitizeMap } from './lib/mapGeo'
import { choroplethClasses, classColor, classOf, legendStops } from './lib/mapChoropleth'
import { bowedRoute, bowLabelSpot, polylinePath, routePolyline, routeSamples, routeTip, type Pt } from './lib/mapRoutes'
import { pinBody, pinCandidates, placeMapLabels, pointCandidates, unnamedPinNumbers, type Box, type Candidate, type LabelItem } from './lib/mapLabels'
import { chipCandidates, countryFeature, featureAt, featuresByName, labelSpot, quizPool, resolveCountries, tappedCountry, type CountryFeature, type QuizItem } from './lib/mapCountries'
import { shuffle } from './lib/figure'
import { INK, vizColor, wash } from './shared/colors'
import { canvasMeasure, useFontsReady } from './shared/measure'
import { usePanZoom } from './shared/usePanZoom'
import { loadWorld, type World } from './shared/worldData'
import { BlockHeader, Caption, ZoomControls, useInView, useInk, useSize } from './shared/ui'
import { useAskTrigger } from '../ask/AskLayer'
import { PenGlyph } from '../ask/glyphs'
import { ChoroplethLegend, GroupLegend, MapChip, MapPin, PrintedLegend, QuizPanel, stateColor, type Feedback, type MarkState, type PrintedItem } from './map/MapParts'

type Sel = { kind: 'marker' | 'region' | 'country'; index: number; x?: number; y?: number } | null

/** Un país de la lección listo para dibujar. */
interface Shape {
  index: number
  ne: string
  name: string
  label?: string
  md?: string
  value?: number
  color?: string
  feature: CountryFeature
  d: string
  /** Área en la esfera (el más pequeño gana al pulsar) y en el plano (px² antes del zoom). */
  area: number
  planeArea: number
  centroid: Pt
  spot?: { x: number; y: number; w: number; h: number; piece: Feature<Polygon> }
}

/** Un país más pequeño que esto en pantalla (px²) lleva además un anillo para verse y pulsarse. */
const TINY = 30
const CHIP_H = 19

/** Texto de un rótulo sin marcas (para medirlo). */
const plain = (s: string): string => s.replace(/\$([^$]*)\$/g, '$1').replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}_^*\\]/g, '')
const chipWidth = (s: string): number => canvasMeasure(plain(s), 12.5, false) * 1.06 + 16

export default function MapBlock({ block, ctx }: BlockProps<BlockOf<'map'>>) {
  const { t } = useTranslation('visual')
  const ink = useInk(ctx.hue)
  const { reducedMotion } = useTheme()
  const lang = ctx.language
  const printing = ctx.mode === 'print'
  const b = useMemo(() => sanitizeMap(block), [block])
  const chosen = useMemo(() => resolveCountries(b.countries), [b.countries])
  // los países que nombra la lección (Somalilandia, si se nombra, va aparte de Somalia)
  const own = useMemo(() => new Set(chosen.map((c) => c.country.ne)), [chosen])
  const bounds = useMemo(() => mapBounds(b), [b])
  const detail = needsDetail(bounds, chosen.map((c) => c.country))
  const [world, setWorld] = useState<World | null>(null)
  useEffect(() => {
    let alive = true
    void loadWorld(detail).then((w) => alive && setWorld(w))
    return () => {
      alive = false
    }
  }, [detail])

  const [box, size] = useSize<HTMLDivElement>()
  const W = Math.max(200, size.width)
  // alto según el encuadre: los altos (Europa entera, Chile) ganan algo de alto, sin pasar de 520 px
  const aspect = Math.max(0.56, Math.min(0.72, boundsAspect(bounds)))
  const H = ctx.mode === 'chat' ? 300 : Math.round(Math.min(printing ? 420 : 520, Math.max(300, W * (printing ? Math.min(aspect, 0.6) : aspect))))
  const proj = useMemo(() => fitProjection(bounds, W, H), [bounds, W, H])
  const path = useMemo(() => geoPath(proj), [proj])
  const viewRef = useRef<HTMLDivElement>(null)
  const frame = useMemo(() => ({ width: W, height: H }), [W, H])
  const pz = usePanZoom(viewRef, frame, frame, { enabled: !printing, maxScale: 8 })
  const tf = pz.t
  const seen = useInView(box, true, '-40px')
  const animate = !printing && !reducedMotion
  const run = !animate || seen
  const fonts = useFontsReady()

  const [sel, setSel] = useState<Sel>(null)
  // práctica «¿Dónde está…?»
  const [practicing, setPracticing] = useState(false)
  const ask = useAskTrigger(!practicing && !printing)
  const [quiz, setQuiz] = useState<QuizItem[]>([])
  const [qi, setQi] = useState(0)
  const [right, setRight] = useState(0)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const round = useRef(0)

  const screen = (lat: number, lon: number): { x: number; y: number } | null => {
    const p = proj([lon, lat])
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
    return { x: tf.x + p[0] * tf.scale, y: tf.y + p[1] * tf.scale }
  }
  const toScreen = (p: Pt): Pt => [tf.x + p[0] * tf.scale, tf.y + p[1] * tf.scale]

  // países de la lección sobre el contorno (por nombre de Natural Earth)
  const byName = useMemo(() => (world ? featuresByName(world.countries as CountryFeature[]) : new Map<string, CountryFeature>()), [world])
  const shapes = useMemo<Shape[]>(
    () =>
      chosen.flatMap((c) => {
        const f = countryFeature(c.country.ne, byName, own)
        if (!f) return []
        const [cx0, cy0] = path.centroid(f)
        return [{
          index: c.index, ne: c.country.ne, name: countryLabel(c.country, lang), label: c.item.label, md: c.item.md, value: c.item.value, color: c.item.color,
          feature: f, d: path(f) ?? '', area: geoArea(f), planeArea: path.area(f), centroid: [cx0, cy0] as Pt, spot: labelSpot(f, path)
        }]
      }),
    [chosen, byName, own, path, lang]
  )
  // mapa de coropletas: clases de los valores (escalones de la tinta del curso)
  const classes = useMemo(() => choroplethClasses(shapes.flatMap((s) => (s.value !== undefined ? [s.value] : []))), [shapes])
  const valueText = (v: number): string => formatNumber(v, lang, 3) + (b.unit ? ` ${b.unit}` : '')
  // rótulos de país: dentro del país si cabe sin zoom; si se repite en varios países (un grupo) o no cabe, en la leyenda
  const inside = useMemo(() => {
    const count = new Map<string, number>()
    for (const s of shapes) if (s.label) count.set(s.label, (count.get(s.label) ?? 0) + 1)
    void fonts
    return new Set(shapes.filter((s) => s.label && count.get(s.label) === 1 && s.spot && s.spot.w >= chipWidth(s.label) + 6 && s.spot.h >= CHIP_H + 6).map((s) => s.ne))
  }, [shapes, fonts])
  const groups = useMemo(() => {
    const out: Array<{ label: string; color: string }> = []
    // la muestra, del mismo tono que el país en el mapa (su color aguado sobre la tierra)
    for (const s of shapes) if (s.label && !inside.has(s.ne) && !out.some((g) => g.label === s.label)) out.push({ label: s.label, color: `color-mix(in oklab, ${vizColor(s.color)} 46%, var(--viz-land))` })
    return out
  }, [shapes, inside])

  // práctica: lo que se pregunta y, si hay países, todos los contornos del mundo (para nombrar el que se pulsó por error)
  const pool = useMemo(() => quizPool(b.markers, chosen, lang), [b.markers, chosen, lang])
  const askCountries = practicing && quiz.some((q) => q.kind === 'country')
  const worldItems = useMemo(
    () => (askCountries && world ? world.countries.map((f) => ({ feature: f, area: geoArea(f), ne: (f as CountryFeature).properties?.name ?? '' })) : []),
    [askCountries, world]
  )

  const startQuiz = (): void => {
    round.current++
    setPracticing(true)
    setQuiz(shuffle(pool))
    setQi(0)
    setRight(0)
    setFeedback(null)
    setSel(null)
    ctx.onInteract?.(block.id, 'map-practice')
  }

  const target = practicing && qi < quiz.length ? quiz[qi] : undefined

  const answer = (fb: Feedback): void => {
    if (fb.ok) setRight((r) => r + 1)
    setFeedback(fb)
    const my = round.current
    setTimeout(() => {
      if (round.current !== my) return
      setFeedback(null)
      setQi((k) => k + 1)
    }, fb.ok ? 700 : 1600)
  }

  /** Respuesta a «¿Dónde está [país]?»: el país pulsado (por su nombre de Natural Earth) o nada (el mar). */
  const answerCountry = (hit: string | undefined, nearTarget: boolean): void => {
    if (!target || target.kind !== 'country' || feedback) return
    // pulsar Somalilandia es pulsar Somalia (salvo que la lección las nombre aparte)
    const ne = hit !== undefined ? tappedCountry(hit, own) : undefined
    const ok = nearTarget || ne === target.ne
    const tapped = ne && !ok ? findCountry(ne) : undefined
    answer({ ok, correct: { kind: 'country', ne: target.ne }, tapped: ne && !ok ? { kind: 'country', ne } : undefined, said: tapped ? countryLabel(tapped, lang) : undefined })
  }

  const tapMarker = (i: number): void => {
    if (practicing) {
      if (!target || feedback) return
      if (target.kind === 'country') {
        // un marcador dentro del país también vale como pulsar el país
        const m = b.markers[i]
        answerCountry(featureAt(m.lon, m.lat, worldItems)?.ne, false)
        return
      }
      const ok = target.index === i || b.markers[i].title.toLowerCase() === b.markers[target.index].title.toLowerCase()
      answer({ ok, tapped: { kind: 'marker', index: i }, correct: { kind: 'marker', index: ok ? i : target.index } })
      return
    }
    setSel((s) => (s?.kind === 'marker' && s.index === i ? null : { kind: 'marker', index: i }))
    ctx.onInteract?.(block.id, 'map-marker')
  }

  const tinyAt = (x: number, y: number, only?: string): Shape | undefined =>
    shapes.find((s) => (!only || s.ne === only) && s.planeArea * tf.scale * tf.scale < TINY && Math.hypot(toScreen(s.centroid)[0] - x, toScreen(s.centroid)[1] - y) <= 11)

  const onMapUp = (e: RPointerEvent<HTMLDivElement>): void => {
    pz.bind.onPointerUp(e)
    if (pz.wasDrag()) return
    const r = viewRef.current?.getBoundingClientRect()
    if (!r) return
    const x = e.clientX - r.left, y = e.clientY - r.top
    const geo = proj.invert?.([(x - tf.x) / tf.scale, (y - tf.y) / tf.scale])
    if (practicing) {
      if (target?.kind !== 'country' || feedback) return
      const near = !!tinyAt(x, y, target.ne)
      answerCountry(geo ? featureAt(geo[0], geo[1], worldItems)?.ne : undefined, near)
      return
    }
    // lo más pequeño que hay bajo el dedo: un país diminuto (su anillo), un país o una región
    let best: { sel: Sel; area: number } | undefined
    const tiny = tinyAt(x, y)
    if (tiny) best = { sel: { kind: 'country', index: shapes.indexOf(tiny), x, y }, area: 0 }
    if (!best && geo) {
      const c = featureAt(geo[0], geo[1], shapes)
      if (c) best = { sel: { kind: 'country', index: shapes.indexOf(c), x, y }, area: c.area }
      const ri = regionIndexAt(geo[1], geo[0], b.regions)
      if (ri !== undefined) {
        const area = geoArea(regionFeature(b.regions[ri]))
        if (!best || area < best.area) best = { sel: { kind: 'region', index: ri, x, y }, area }
      }
    }
    setSel(best?.sel ?? null)
    if (best?.sel?.kind === 'country') ctx.onInteract?.(block.id, 'map-country')
  }

  const regionPaths = useMemo(() => b.regions.map((r) => path(regionFeature(r)) ?? ''), [b.regions, path])
  // rutas: con flecha y 2 puntos, un arco suave; si no, por el círculo máximo
  const routes = useMemo(
    () =>
      b.routes.map((r) => {
        const bowed = r.arrow ? bowedRoute(proj, r.points) : undefined
        return {
          d: bowed ? polylinePath(bowed) : path(routeFeature(r)) ?? '',
          tip: r.arrow ? routeTip(proj, r.points, bowed) : undefined,
          line: bowed ?? routePolyline(proj, r.points),
          spot: bowed ? bowLabelSpot(bowed) : undefined
        }
      }),
    [b.routes, proj, path]
  )
  const landPaths = useMemo(() => (world ? world.countries.map((c) => path(c) ?? '') : []), [world, path])
  const borderPath = useMemo(() => (world ? path(world.borders) ?? '' : ''), [world, path])
  const gratPath = useMemo(() => path(geoGraticule10()) ?? '', [path])

  const markerState = (i: number): MarkState => {
    if (!feedback) return 'idle'
    if (feedback.correct.kind === 'marker' && feedback.correct.index === i) return 'correct'
    if (feedback.tapped?.kind === 'marker' && feedback.tapped.index === i && !feedback.ok) return 'wrong'
    return 'idle'
  }
  const countryState = (ne: string): MarkState => {
    if (!feedback) return 'idle'
    if (feedback.correct.kind === 'country' && feedback.correct.ne === ne) return 'correct'
    if (feedback.tapped?.kind === 'country' && feedback.tapped.ne === ne) return 'wrong'
    return 'idle'
  }
  // el país que se pulsó por error y no es de la lección: se pinta igual, para que se vea dónde se pulsó
  const wrongExtra = feedback?.tapped?.kind === 'country' && !shapes.some((s) => s.ne === (feedback.tapped as { ne: string }).ne) ? countryFeature(feedback.tapped.ne, byName, own) : undefined

  const fillOf = (s: Shape, on: boolean): string => {
    const st = countryState(s.ne)
    if (st !== 'idle') return wash(stateColor(st, ''), 62)
    if (classes && s.value !== undefined) return classColor(classOf(s.value, classes), classes.k, INK)
    return wash(vizColor(s.color), on ? 55 : 36)
  }
  const strokeOf = (s: Shape, on: boolean): string => {
    const st = countryState(s.ne)
    if (st !== 'idle') return stateColor(st, '')
    if (classes && s.value !== undefined) return on ? 'var(--text)' : 'none'
    return vizColor(s.color)
  }

  // nombres que no se pisan: rótulos de país (en su pieza más grande), chinchetas y rutas
  const labels = useMemo(() => {
    const pins = new Map<number, Candidate | null>()
    const chips: Array<{ i: number; at: Candidate }> = []
    const routeAt: Array<Candidate | null> = b.routes.map(() => null)
    if (size.width <= 0) return { pins, chips, routeAt }
    void fonts
    const frameBox: Box = { x: 4, y: 4, w: W - 8, h: H - 8 }
    const obstacles: Box[] = []
    if (!printing) obstacles.push({ x: W - 136, y: 0, w: 136, h: 46 })
    obstacles.push({ x: 0, y: H - 28, w: Math.min(W, chipWidth(t('map.attribution')) + 10), h: 28 })
    const visible = b.markers.map((m) => {
      const p = proj([m.lon, m.lat])
      if (!p) return null
      const s = toScreen([p[0], p[1]])
      return s[0] >= -20 && s[1] >= -20 && s[0] <= W + 20 && s[1] <= H + 20 ? s : null
    })
    visible.forEach((p) => p && obstacles.push(pinBody(p[0], p[1])))
    const ink: Pt[] = routes.flatMap((r) => routeSamples(r.line, toScreen, 9))
    if (practicing) return { pins, chips, routeAt }
    const items: LabelItem[] = []
    const owners: Array<{ kind: 'chip'; i: number } | { kind: 'pin'; i: number } | { kind: 'route'; i: number }> = []
    // 1) rótulos de país: dentro de su pieza más grande, si cabe
    shapes.forEach((s, i) => {
      if (!s.label || !inside.has(s.ne) || !s.spot) return
      const w = chipWidth(s.label)
      const [x, y] = toScreen([s.spot.x, s.spot.y])
      const piece = s.spot.piece
      // cada sitio, con el rótulo entero dentro de la pieza (sus dos extremos)
      const within = (px: number, py: number): boolean =>
        [px - w / 2 + 4, px + w / 2 - 4].every((qx) => {
          const g = proj.invert?.([(qx - tf.x) / tf.scale, (py - tf.y) / tf.scale])
          return !!g && geoContains(piece, g)
        })
      const candidates = chipCandidates(x, y, s.spot.w * tf.scale, s.spot.h * tf.scale, within)
      // una pieza con forma de media luna (el centro cae fuera): en su centro, como antes
      items.push({ candidates: candidates.length ? candidates : [{ x, y, ax: 0.5, ay: 0.5 }], w, h: CHIP_H })
      owners.push({ kind: 'chip', i })
    })
    // 2) rutas: junto a la cima del arco, por fuera (o algo antes o después); si no, en su punto medio
    b.routes.forEach((r, i) => {
      if (!r.label) return
      const w = chipWidth(r.label)
      const g = routes[i]
      const candidates: Candidate[] = []
      if (g.spot) {
        const [ox, oy] = g.spot.out
        const ax = ox < -0.35 ? 1 : ox > 0.35 ? 0 : 0.5, ay = oy < -0.35 ? 1 : oy > 0.35 ? 0 : 0.5
        const n = g.line.length - 1
        for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          const [x, y] = toScreen(g.line[Math.round(n * f)])
          candidates.push({ x: x + ox * 10, y: y + oy * 10, ax, ay })
        }
        const [x, y] = toScreen(g.spot.at)
        candidates.push({ x: x - ox * 10, y: y - oy * 10, ax: 1 - ax, ay: 1 - ay })
      }
      const mid = routeMidpoint(r.points)
      const m = mid ? screen(mid[0], mid[1]) : null
      if (m) candidates.push(...pointCandidates(m.x, m.y, 10))
      if (!candidates.length) return
      items.push({ candidates, w, h: CHIP_H })
      owners.push({ kind: 'route', i })
    })
    // 3) chinchetas (la elegida primero)
    const order = b.markers.map((_, i) => i).sort((a, c) => Number(sel?.kind === 'marker' && sel.index === c) - Number(sel?.kind === 'marker' && sel.index === a))
    for (const i of order) {
      const p = visible[i]
      if (!p || !b.markers[i].title) continue
      items.push({ candidates: pinCandidates(p[0], p[1]), w: chipWidth(b.markers[i].title), h: CHIP_H })
      owners.push({ kind: 'pin', i })
    }
    const placed = placeMapLabels(items, obstacles, ink, frameBox)
    placed.forEach((c, k) => {
      const o = owners[k]
      if (o.kind === 'chip') { if (c) chips.push({ i: o.i, at: c }) }
      else if (o.kind === 'pin') pins.set(o.i, c)
      else routeAt[o.i] = c
    })
    return { pins, chips, routeAt }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf.x, tf.y, tf.scale, W, H, size.width, fonts, practicing, b, routes, shapes, inside, proj, sel, printing])

  // ficha de lo elegido: junto al marcador o donde se pulsó el país o la región
  let pop: { x: number; y: number; title: string; sub?: string; value?: string; md?: string; color: string } | null = null
  if (sel?.kind === 'marker' && b.markers[sel.index]) {
    const m = b.markers[sel.index]
    const p = screen(m.lat, m.lon)
    if (p) pop = { x: p.x, y: p.y - 22, title: m.title, md: m.md, color: vizColor(m.color) }
  } else if (sel?.kind === 'region' && b.regions[sel.index] && sel.x !== undefined && sel.y !== undefined) {
    const r = b.regions[sel.index]
    pop = { x: sel.x, y: sel.y - 6, title: r.name, md: r.md, color: vizColor(r.color) }
  } else if (sel?.kind === 'country' && shapes[sel.index] && sel.x !== undefined && sel.y !== undefined) {
    const s = shapes[sel.index]
    pop = {
      x: sel.x, y: sel.y - 6, title: s.name, sub: s.label && s.label !== s.name ? s.label : undefined, value: s.value !== undefined ? valueText(s.value) : undefined, md: s.md,
      color: classes && s.value !== undefined ? classColor(classOf(s.value, classes), classes.k, INK) : vizColor(s.color)
    }
  }

  const hasInfo = b.markers.some((m) => m.md) || b.regions.some((r) => r.md) || shapes.length > 0
  const canPractice = !printing && b.practice && pool.length >= 3
  // en papel no se puede pulsar: la chincheta cuyo nombre no cupo lleva un número y la lista de debajo dice cuál es
  const pinNumbers = printing ? unnamedPinNumbers(b.markers.map((m) => m.title), labels.pins) : new Map<number, number>()
  const printed: PrintedItem[] = printing
    ? [
        ...b.markers.flatMap((m, i): PrintedItem[] => {
          const n = pinNumbers.get(i)
          return m.md || n !== undefined ? [{ title: m.title, text: m.md, pin: n !== undefined ? { n, color: vizColor(m.color) } : undefined }] : []
        }),
        // los grupos ya están en la leyenda: aquí, lo que solo se ve al pulsar (explicación, valor, rótulo propio)
        ...shapes
          .filter((s) => s.md || s.value !== undefined || (s.label && inside.has(s.ne)))
          .map((s): PrintedItem => ({ title: s.name, text: [s.label, s.value !== undefined ? valueText(s.value) : undefined, s.md].filter(Boolean).join(' · ') })),
        ...b.regions.filter((r) => r.md).map((r): PrintedItem => ({ title: r.name, text: r.md })),
        ...b.routes.filter((r) => r.label).map((r): PrintedItem => ({ title: r.label ?? '' }))
      ]
    : []
  const scale = classes ? Array.from({ length: classes.k }, (_, i) => classColor(i, classes.k, INK)) : []
  const stops = useMemo(() => (classes ? legendStops(classes, (v) => compactNumber(v, lang)) : undefined), [classes, lang])
  const ranges = classes
    ? classes.exact
      ? classes.exact.map((v) => compactNumber(v, lang))
      : Array.from({ length: classes.k }, (_, i) => `${compactNumber(i === 0 ? classes.min : classes.cuts[i - 1], lang)} – ${compactNumber(i === classes.k - 1 ? classes.max : classes.cuts[i], lang)}`)
    : []

  // «Marcar y preguntar al tutor»: el botón va en la cabecera y se apaga durante «¿Dónde está…?» (sería una pista)
  const askBtn = ask && (
    <Button size="sm" variant="ghost" icon={<PenGlyph size={13} />} aria-pressed={ask.open} aria-label={t('ask.start')} title={t('ask.start')} className={cx(ask.open && 'bg-fill2 text-text')} onClick={ask.open ? ask.stop : ask.start}>
      {t('ask.startShort')}
    </Button>
  )

  return (
    <section className="flex flex-col gap-3" style={ink} aria-label={b.title ?? t('map.eyebrow')}>
      <BlockHeader
        icon="globe"
        eyebrow={t('map.eyebrow')}
        title={b.title}
        actions={
          canPractice || askBtn ? (
            <>
              {askBtn}
              {canPractice && (
                <Button size="sm" variant="secondary" icon={<Icon name="place" size={13} />} onClick={startQuiz}>
                  {practicing ? t('labeled.again') : t('map.whereIs')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <div ref={box} className="w-full">
        <div
          ref={viewRef}
          className={cx('relative isolate overflow-hidden rounded-[18px] border-[0.5px] border-line select-none', pz.pannable && 'viz-grab')}
          style={{ height: H, background: 'var(--viz-sea)', touchAction: pz.pannable ? 'none' : undefined }}
          onPointerDown={pz.bind.onPointerDown}
          onPointerMove={pz.bind.onPointerMove}
          onPointerUp={onMapUp}
          onPointerCancel={pz.bind.onPointerCancel}
        >
          {size.width > 0 && (
            <svg width={W} height={H} className="absolute inset-0" aria-hidden>
              <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.scale})`} style={{ transition: pz.smooth && !pz.dragging ? 'transform 260ms cubic-bezier(.2,.7,.2,1)' : undefined }}>
                <path d={gratPath} fill="none" stroke="var(--text3)" strokeOpacity={0.14} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
                <motion.g initial={animate ? { opacity: 0 } : false} animate={{ opacity: world ? 1 : 0 }} transition={{ duration: 0.5 }}>
                  {landPaths.map((d, i) => <path key={i} d={d} fill="var(--viz-land)" stroke="none" />)}
                </motion.g>
                {/* países de la lección: su frontera exacta, coloreados por grupo o por su valor */}
                {shapes.map((s, i) => {
                  const on = sel?.kind === 'country' && sel.index === i
                  return (
                    <motion.path
                      key={`c${s.ne}`}
                      d={s.d}
                      data-ask-part={`country:${s.ne}`}
                      data-ask-label={s.name}
                      data-ask-kind="area"
                      fill={fillOf(s, on)}
                      stroke={strokeOf(s, on)}
                      strokeWidth={on ? 2 : 1.2}
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      style={{ transition: 'fill 200ms, stroke 200ms' }}
                      initial={animate ? { opacity: 0 } : false}
                      animate={run && world ? { opacity: 1 } : undefined}
                      transition={{ duration: 0.5, delay: 0.15 + Math.min(i, 40) * 0.04 }}
                    />
                  )
                })}
                {wrongExtra && <path d={path(wrongExtra) ?? ''} fill={wash('var(--danger)', 55)} stroke="var(--danger)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
                <motion.path d={borderPath} fill="none" stroke="var(--viz-land-line)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" initial={animate ? { opacity: 0 } : false} animate={{ opacity: world ? 1 : 0 }} transition={{ duration: 0.5 }} />
                {b.regions.map((r, i) => {
                  const c = vizColor(r.color)
                  const on = sel?.kind === 'region' && sel.index === i
                  return (
                    <motion.path
                      key={`r${i}`}
                      d={regionPaths[i]}
                      data-ask-part={`region:${r.name || i}`}
                      data-ask-label={r.name || undefined}
                      data-ask-kind="area"
                      fill={wash(c, on ? 40 : 24)}
                      stroke={c}
                      strokeWidth={on ? 2.4 : 1.4}
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      style={{ transition: 'fill 200ms, stroke-width 200ms' }}
                      initial={animate ? { opacity: 0 } : false}
                      animate={run ? { opacity: 1 } : undefined}
                      transition={{ duration: 0.5, delay: 0.2 + i * 0.08 }}
                    />
                  )
                })}
                {/* países diminutos (Malta, Andorra): un anillo para verlos y pulsarlos */}
                {shapes.map((s, i) => {
                  if (s.planeArea * tf.scale * tf.scale >= TINY) return null
                  const on = sel?.kind === 'country' && sel.index === i
                  const st = countryState(s.ne)
                  const c = st !== 'idle' ? stateColor(st, '') : classes && s.value !== undefined ? classColor(classOf(s.value, classes), classes.k, INK) : vizColor(s.color)
                  return (
                    <g key={`t${s.ne}`} data-ask-part={`country:${s.ne}`} data-ask-label={s.name}>
                      {/* en coropletas, el anillo en tinta y el centro del color de su clase */}
                      <circle cx={s.centroid[0]} cy={s.centroid[1]} r={(on ? 7.5 : 6) / tf.scale} fill={wash(c, 22)} stroke={st === 'idle' && classes && s.value !== undefined ? INK : c} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
                      <circle cx={s.centroid[0]} cy={s.centroid[1]} r={2.6 / tf.scale} fill={c} />
                    </g>
                  )
                })}
                {b.routes.map((r, i) => {
                  const c = vizColor(r.color)
                  const g = routes[i]
                  const ask = { 'data-ask-part': `route:${i}`, 'data-ask-label': r.label ?? t('map.route', { n: i + 1 }) }
                  const common = { d: g.d, fill: 'none', stroke: c, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const }
                  const drawn = animate && !r.dashed
                  const arrowDelay = drawn ? 0.4 + i * 0.3 + 1.25 : 0.4 + i * 0.25 + 0.3
                  return (
                    <g key={`w${i}`} {...ask}>
                      {drawn ? (
                        <motion.path {...common} initial={{ pathLength: 0 }} animate={run ? { pathLength: 1 } : undefined} transition={{ duration: 1.4, delay: 0.4 + i * 0.3, ease: [0.4, 0, 0.2, 1] }} />
                      ) : (
                        <motion.path {...common} strokeDasharray={r.dashed ? '6 5' : undefined} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.6, delay: 0.4 + i * 0.25 }} />
                      )}
                      {g.tip && (
                        // la punta no crece con el zoom (escala inversa dentro del grupo escalado)
                        <g transform={`translate(${g.tip.x} ${g.tip.y}) rotate(${g.tip.angle}) scale(${1 / tf.scale})`}>
                          <motion.path d="M3 0 L-9.5 -5.5 L-6.8 0 L-9.5 5.5 Z" fill={c} stroke={c} strokeWidth={1} strokeLinejoin="round" initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.25, delay: arrowDelay }} />
                        </g>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          )}
          {size.width > 0 &&
            labels.chips.map(({ i, at }) => {
              const s = shapes[i]
              return (
                <motion.div key={`cl${s.ne}`} className="absolute pointer-events-none" style={{ left: at.x, top: at.y, transform: 'translate(-50%, -50%)' }} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ delay: 0.6 + Math.min(i, 20) * 0.05 }}>
                  <MapChip text={s.label ?? s.name} />
                </motion.div>
              )
            })}
          {size.width > 0 &&
            b.routes.map((r, i) => {
              const at = labels.routeAt[i]
              if (!at || !r.label) return null
              return (
                <motion.div key={`rl${i}`} className="absolute pointer-events-none" style={{ left: at.x, top: at.y, transform: `translate(${-at.ax * 100}%, ${-at.ay * 100}%)` }} initial={animate ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ delay: 1.2 + i * 0.3 }}>
                  <MapChip text={r.label} />
                </motion.div>
              )
            })}
          {size.width > 0 &&
            b.markers.map((m, i) => {
              const p = screen(m.lat, m.lon)
              if (!p || p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) return null
              const active = sel?.kind === 'marker' && sel.index === i
              return (
                <MapPin
                  key={`m${i}`}
                  x={p.x}
                  y={p.y}
                  color={vizColor(m.color)}
                  title={practicing ? undefined : m.title}
                  label={labels.pins.get(i) ?? null}
                  active={active}
                  state={markerState(i)}
                  delay={animate ? 0.5 + Math.min(i, 24) * 0.06 : 0}
                  animate={animate}
                  run={run}
                  ask={practicing ? undefined : { part: `place:${m.title || i}`, label: m.title }}
                  badge={pinNumbers.get(i)}
                  onTap={() => tapMarker(i)}
                />
              )
            })}
          <AnimatePresence>
            {pop && !practicing && (
              <motion.div
                key={`${sel?.kind}-${sel?.index}`}
                className={cx('absolute z-10 w-max max-w-[280px] -translate-x-1/2', pop.y > 130 && '-translate-y-full')}
                style={{ left: Math.min(W - 150, Math.max(150, pop.x)), top: pop.y > 130 ? pop.y : pop.y + (sel?.kind === 'marker' ? 34 : 18) }}
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={spring.snappy}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                <div className="rounded-[14px] bg-raised border-[0.5px] border-line shadow-[var(--e3)] px-3.5 py-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-[7px] w-2 h-2 rounded-full shrink-0" style={{ background: pop.color }} />
                    <div className="t-headline flex-1 min-w-0"><RichText text={pop.title} inline /></div>
                    <IconButton size="sm" label={t('map.close')} onClick={() => setSel(null)} className="-mr-1.5 -mt-1 h-6 w-6">
                      <Icon name="close" size={12} />
                    </IconButton>
                  </div>
                  {pop.sub && <div className="t-callout font-medium text-text2 mt-0.5"><RichText text={pop.sub} inline /></div>}
                  {pop.value && <div className="font-serif tabular text-[20px] leading-[26px] text-text mt-0.5">{pop.value}</div>}
                  {pop.md && (
                    <div className="t-callout text-text2 mt-1">
                      <RichText text={pop.md} />
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!printing && (
            <div className="absolute right-2 top-2" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
              <ZoomControls scale={tf.scale} onZoom={pz.zoomBy} onReset={pz.reset} max={8} />
            </div>
          )}
          <div className="pointer-events-none absolute left-2.5 bottom-2 t-caption text-text3 bg-raised/70 rounded-full px-2 py-0.5">{t('map.attribution')}</div>
        </div>
      </div>
      {stops && <ChoroplethLegend colors={scale} ranges={ranges} stops={stops} unit={b.unit} maxWidth={W} />}
      {/* en «¿Dónde está…?» los nombres no se ven: la leyenda emparejaría cada nombre con el color de su país */}
      {!practicing && <GroupLegend items={groups} />}
      {practicing ? (
        <QuizPanel target={target?.name} index={qi} total={quiz.length} right={right} feedback={feedback} onEnd={() => { round.current++; setPracticing(false); setFeedback(null) }} />
      ) : (
        !printing && hasInfo && !sel && (
          <p className="t-footnote text-text3 flex items-center gap-2 m-0">
            <Icon name="cursor" size={13} />
            {t('map.hint')}
          </p>
        )
      )}
      {printing && <PrintedLegend items={printed} />}
      <Caption text={b.caption} />
    </section>
  )
}
