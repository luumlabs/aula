// Escena 3D del visor (three.js con react-three-fiber; se carga solo cuando hace falta): moléculas de bolas y varillas o
// esferas, pares libres, ángulos de enlace, sólidos con sus aristas y medidas, modelos del curso (OBJ, GLB/GLTF, STL, PLY, DAE,
// USDZ) y etiquetas. Luz suave de estudio (papel de día, lámpara cálida de noche), giro lento hasta que se toca, sombra de
// contacto sepia. Port de Model3DScene en StudyUI/Blocks/Model3D/Model3DView.swift.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Html as DreiHtml, Lightformer, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Label3D, Model3DBlock, Solid3D } from '@shared/schema/visual'
import { covalentRadius, elementSymbol, keyBondAngles, vdwRadius, type Molecule, type Vec3 } from '../lib/molecules'
import { dimensionLabels, faceTriangles, polyEdges, polyhedron, solidRadius } from '../lib/solids'
import { disposeObject3D, ReleaseGL } from '@renderer/lib/glRelease'
import { useAmbient } from '@renderer/design/ambient'

// Las etiquetas HTML de la escena cuelgan de una capa propia junto al lienzo, no del <div> que R3F crea para él: al
// desmontar la escena, React y drei se disputaban ese <div> («removeChild: the node to be removed is not a child»).
const LabelLayer = createContext<RefObject<HTMLDivElement | null> | undefined>(undefined)
function Html(props: ComponentProps<typeof DreiHtml>) {
  const layer = useContext(LabelLayer)
  return <DreiHtml portal={layer as RefObject<HTMLElement>} {...props} />
}

export interface ScenePalette {
  dark: boolean
  /** Color real (rgb) de un nombre de la paleta o de un color CSS. */
  color: (name: string | undefined, fallbackCss: string) => string
  cpk: (element: string) => string
  text: string
  text2: string
}

export interface Scene3DProps {
  block: Model3DBlock
  molecule?: Molecule
  style: 'ballstick' | 'spacefill' | 'stick'
  showLabels: boolean
  showAngles: boolean
  autoRotate: boolean
  onUserMove: () => void
  resetToken: number
  palette: ScenePalette
  modelUrl?: string
  print: boolean
  active: boolean
  formatNumber: (v: number) => string
  onModelError: () => void
}

const SPIN = (Math.PI * 2) / 24

// MARK: Encuadre

function atomRadius(el: string, style: Scene3DProps['style']): number {
  if (style === 'spacefill') return vdwRadius(el)
  if (style === 'stick') return 0.16
  return el === 'H' ? 0.25 : Math.min(0.55, Math.max(0.3, covalentRadius(el) * 0.5))
}

/** Centro y radio de lo que hay (moléculas, sólidos, etiquetas y el modelo, que se lleva a radio 3). */
function sceneBounds(b: Model3DBlock, m: Molecule | undefined, style: Scene3DProps['style'], hasModel: boolean): { center: Vec3; radius: number } {
  const pts: Array<{ p: Vec3; r: number }> = []
  if (m) for (const a of m.atoms.slice(0, 600)) pts.push({ p: [a.x, a.y, a.z], r: atomRadius(elementSymbol(a.element), style) + 0.2 })
  for (const s of b.solids) pts.push({ p: [s.x, s.y, s.z], r: solidRadius(s) + (s.dims || s.label ? 0.6 : 0.1) })
  for (const l of b.labels) pts.push({ p: [l.x, l.y, l.z], r: 0.4 })
  if (hasModel) pts.push({ p: [0, 0, 0], r: 3 })
  if (!pts.length) return { center: [0, 0, 0], radius: 1 }
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { p, r } of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - r); hi[k] = Math.max(hi[k], p[k] + r) }
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  const radius = pts.reduce((best, { p, r }) => Math.max(best, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) + r), 0)
  return { center, radius: Math.max(0.6, radius) }
}

export default function Scene3D(props: Scene3DProps) {
  const { block, molecule, style, palette, print, active, modelUrl } = props
  const { center, radius } = useMemo(() => sceneBounds(block, molecule, style, !!modelUrl), [block, molecule, style, modelUrl])
  const dist = (radius / Math.sin((19 * Math.PI) / 180)) * 1.06
  const dir = new THREE.Vector3(0.28, 0.32, 0.9).normalize()
  const camPos: Vec3 = [dir.x * dist, dir.y * dist, dir.z * dist]
  // el giro solo mientras alguien usa la app y la ventana se ve (design/ambient.ts); quieta, solo al cambiar algo
  const live = useAmbient()
  const frameloop = !active ? 'never' : props.autoRotate && !print && live ? 'always' : 'demand'
  const labels = useRef<HTMLDivElement>(null)
  return (
    <LabelLayer.Provider value={labels}>
      {/* antes que el lienzo para que exista cuando se pintan las etiquetas; z-[1] la deja por encima */}
      <div ref={labels} className="absolute inset-0 z-[1] overflow-hidden pointer-events-none" />
      <Canvas
        key={`${props.resetToken}-${print}`}
        frameloop={frameloop}
        dpr={print ? 2 : [1, 2]}
        camera={{ fov: 38, near: 0.01, far: dist * 40, position: camPos }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: print }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = palette.dark ? 1.05 : 1.12 }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Lights dark={palette.dark} radius={radius} />
        <Spinner on={props.autoRotate && !print} resetToken={props.resetToken}>
          <group position={[-center[0], -center[1], -center[2]]}>
            {molecule && <MoleculeView m={molecule} style={style} labels={props.showLabels} angles={props.showAngles} lonePairs={block.lonePairs} palette={palette} formatNumber={props.formatNumber} />}
            {block.solids.map((s, i) => <SolidView key={i} s={s} index={i} palette={palette} formatNumber={props.formatNumber} />)}
            {block.labels.map((l, i) => <SceneLabel key={`l${i}`} l={l} />)}
            {modelUrl && <ExternalModel url={modelUrl} asset={block.asset ?? ''} palette={palette} onError={props.onModelError} />}
          </group>
        </Spinner>
        <ContactShadows position={[0, -radius * 0.98, 0]} scale={radius * 3.2} far={radius * 2.2} blur={3.2} opacity={palette.dark ? 0.42 : 0.22} resolution={256} color="#3a2814" frames={print ? 1 : Infinity} />
        {!print && <Controls dist={dist} onStart={props.onUserMove} />}
        <ReleaseGL />
      </Canvas>
    </LabelLayer.Provider>
  )
}

/** Luz suave de estudio: de día, papel cálido; de noche, una lámpara (luz ámbar y sombras profundas). */
function Lights({ dark, radius }: { dark: boolean; radius: number }) {
  return (
    <>
      <hemisphereLight args={[dark ? '#ffe2bd' : '#fffaf1', dark ? '#1b1510' : '#d8c8b0', dark ? 0.55 : 0.85]} />
      <directionalLight position={[radius * 2, radius * 3, radius * 2.4]} intensity={dark ? 2.1 : 1.7} color={dark ? '#ffd2a0' : '#fff3e2'} />
      <directionalLight position={[-radius * 2.5, radius, -radius * 2]} intensity={dark ? 0.35 : 0.55} color={dark ? '#9fb4d6' : '#e6edf6'} />
      <Environment resolution={64} environmentIntensity={dark ? 0.35 : 0.55}>
        <Lightformer form="rect" intensity={dark ? 1.4 : 2.2} color={dark ? '#ffcf96' : '#fff6e8'} position={[0, 5, -6]} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#ffffff" position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="circle" intensity={dark ? 0.6 : 1} color={dark ? '#ffb877' : '#fffaf0'} position={[5, 3, 4]} scale={2} />
      </Environment>
    </>
  )
}

/** Gira el contenido despacio (una vuelta cada 24 s) hasta que el estudiante mueve la cámara. */
function Spinner({ on, resetToken, children }: { on: boolean; resetToken: number; children: ReactNode }) {
  const g = useRef<THREE.Group>(null)
  useEffect(() => { if (g.current) g.current.rotation.y = 0 }, [resetToken])
  useFrame((_, dt) => { if (on && g.current) g.current.rotation.y += Math.min(dt, 0.1) * SPIN })
  return <group ref={g}>{children}</group>
}

/** Girar arrastrando (con inercia); ampliar con Ctrl + rueda o el pellizco (la rueda sola sigue desplazando la página). */
function Controls({ dist, onStart }: { dist: number; onStart: () => void }) {
  const ref = useRef<OrbitControlsImpl>(null)
  const { camera, gl, invalidate } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const c = ref.current
      if (!c) return
      const off = camera.position.clone().sub(c.target)
      const len = Math.min(dist * 4, Math.max(dist * 0.25, off.length() * Math.exp(e.deltaY * 0.004)))
      camera.position.copy(c.target.clone().add(off.setLength(len)))
      c.update()
      onStart()
      invalidate()
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [camera, gl, dist, onStart, invalidate])
  return <OrbitControls ref={ref} makeDefault enableDamping dampingFactor={0.09} enableZoom={false} enablePan={false} rotateSpeed={0.8} onStart={onStart} />
}

// MARK: Moléculas

const Y = new THREE.Vector3(0, 1, 0)

function Bond({ from, to, radius, color, opacity = 1 }: { from: THREE.Vector3; to: THREE.Vector3; radius: number; color: string; opacity?: number }) {
  const d = to.clone().sub(from)
  const len = Math.max(0.001, d.length())
  const q = new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize())
  const mid = from.clone().add(to).multiplyScalar(0.5)
  return (
    <mesh position={mid} quaternion={q}>
      <cylinderGeometry args={[radius, radius, len, 18, 1]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

function perpendicularOffsets(a: THREE.Vector3, b: THREE.Vector3, count: number, spacing: number): THREE.Vector3[] {
  if (count <= 1) return [new THREE.Vector3()]
  const d = b.clone().sub(a)
  let p = new THREE.Vector3(d.y, -d.x, 0)
  if (Math.abs(p.x) + Math.abs(p.y) < 1e-6) p = new THREE.Vector3(0, d.z, -d.y)
  // dos átomos en el mismo punto: sin dirección perpendicular
  if (p.length() < 1e-9) return Array.from({ length: count }, () => new THREE.Vector3())
  p.normalize()
  const start = -(count - 1) / 2
  return Array.from({ length: count }, (_, k) => p.clone().multiplyScalar((start + k) * spacing))
}

function MoleculeView({ m, style, labels, angles, lonePairs, palette, formatNumber }: { m: Molecule; style: Scene3DProps['style']; labels: boolean; angles: boolean; lonePairs: boolean; palette: ScenePalette; formatNumber: (v: number) => string }) {
  const atoms = m.atoms.slice(0, 600)
  const pos = atoms.map((a) => new THREE.Vector3(a.x, a.y, a.z))
  const seg = atoms.length > 120 ? 16 : 36
  const rBond = style === 'stick' ? 0.16 : 0.09
  const keyAngles = useMemo(() => (angles && style !== 'spacefill' ? keyBondAngles(m) : []), [m, angles, style])
  return (
    <group>
      {atoms.map((a, i) => {
        const el = elementSymbol(a.element)
        const r = atomRadius(el, style)
        return (
          <mesh key={`a${i}`} position={pos[i]}>
            <sphereGeometry args={[r, seg, Math.round(seg * 0.75)]} />
            <meshStandardMaterial color={palette.cpk(el)} roughness={0.36} metalness={0} />
          </mesh>
        )
      })}
      {style !== 'spacefill' &&
        m.bonds.map((b, i) => {
          if (b.a >= pos.length || b.b >= pos.length || b.a === b.b) return null
          const a = pos[b.a], c = pos[b.b]
          const ca = palette.cpk(elementSymbol(atoms[b.a].element)), cb = palette.cpk(elementSymbol(atoms[b.b].element))
          const count = style === 'stick' ? 1 : b.order >= 2.75 ? 3 : b.order >= 1.75 ? 2 : 1
          const aromatic = b.order > 1.25 && b.order < 1.75 && style !== 'stick'
          const offs = perpendicularOffsets(a, c, aromatic ? 2 : count, rBond * 2.6)
          return (
            <group key={`b${i}`}>
              {offs.map((o, k) => {
                const p0 = a.clone().add(o), p1 = c.clone().add(o), mid = p0.clone().add(p1).multiplyScalar(0.5)
                const dashed = aromatic && k === 1
                return (
                  <group key={k}>
                    <Bond from={p0} to={mid} radius={dashed ? rBond * 0.6 : rBond} color={ca} opacity={dashed ? 0.55 : 1} />
                    <Bond from={mid} to={p1} radius={dashed ? rBond * 0.6 : rBond} color={cb} opacity={dashed ? 0.55 : 1} />
                  </group>
                )
              })}
            </group>
          )
        })}
      {lonePairs && m.central !== undefined && m.central < pos.length &&
        m.lonePairs.map((d, i) => {
          const dir = new THREE.Vector3(d[0], d[1], d[2])
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize())
          return (
            <mesh key={`lp${i}`} position={pos[m.central!].clone().add(dir.clone().multiplyScalar(0.85))} quaternion={q} scale={[0.75, 0.75, 1.45]}>
              <sphereGeometry args={[0.27, 28, 20]} />
              <meshStandardMaterial color={palette.color('blue', 'var(--viz-blue)')} transparent opacity={0.24} roughness={0.7} depthWrite={false} />
            </mesh>
          )
        })}
      {labels &&
        atoms.map((a, i) => {
          const el = elementSymbol(a.element)
          const r = atomRadius(el, style)
          const q = a.charge ? (Math.abs(a.charge) === 1 ? '' : String(Math.abs(a.charge))) + (a.charge > 0 ? '+' : '−') : ''
          return (
            <Html key={`t${i}`} position={[a.x, a.y + r + 0.16, a.z]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
              <span className="block rounded-[6px] bg-raised/90 px-1.5 text-[11.5px] leading-[16px] font-semibold text-text shadow-[var(--e1)] whitespace-nowrap">
                {a.label ?? el}
                {q && <sup className="text-[9px] ml-[1px]">{q}</sup>}
              </span>
            </Html>
          )
        })}
      {keyAngles.map((ang, i) => <AngleArc key={`g${i}`} c={pos[ang.center]} a={pos[ang.a]} b={pos[ang.b]} degrees={ang.degrees} palette={palette} formatNumber={formatNumber} />)}
    </group>
  )
}

/** Arco del ángulo de enlace con su valor («104,5°»). */
function AngleArc({ c, a, b, degrees, palette, formatNumber }: { c: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; degrees: number; palette: ScenePalette; formatNumber: (v: number) => string }) {
  const u = a.clone().sub(c).normalize(), v = b.clone().sub(c).normalize()
  const r = Math.min(0.75, Math.min(a.distanceTo(c), b.distanceTo(c)) * 0.55)
  const pts: THREE.Vector3[] = []
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion().setFromUnitVectors(u, v)
  for (let k = 0; k <= 24; k++) {
    const q = qa.clone().slerp(qb, k / 24)
    pts.push(c.clone().add(u.clone().applyQuaternion(q).multiplyScalar(r)))
  }
  const mid = u.clone().add(v).normalize()
  const at = c.clone().add((mid.lengthSq() > 1e-6 ? mid : new THREE.Vector3(0, 1, 0)).multiplyScalar(r + 0.32))
  const color = palette.color('accent', 'var(--accent)')
  return (
    <group>
      <Line points={pts} color={color} lineWidth={2} transparent opacity={0.9} />
      <Html position={at} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
        <span className="block rounded-full bg-raised px-1.5 text-[11px] leading-[16px] font-semibold tabular text-accent-text whitespace-nowrap shadow-[var(--e1)]" style={{ boxShadow: 'inset 0 0 0 1px var(--accent-line), var(--e1)' }}>{formatNumber(Math.round(degrees * 10) / 10)}°</span>
      </Html>
    </group>
  )
}

// MARK: Sólidos

function SolidView({ s, index, palette, formatNumber }: { s: Solid3D; index: number; palette: ScenePalette; formatNumber: (v: number) => string }) {
  const seriesName = ['blue', 'terracotta', 'teal', 'amber', 'brown', 'green', 'olive', 'rose'][index % 8]
  const c = (s.color ?? '').trim().toLowerCase()
  const color = c === 'accent' ? palette.color('accent', 'var(--accent)') : c === 'gray' || c === 'grey' || c === 'gris' ? palette.color(undefined, 'var(--text3)') : c === 'red' || c === 'rojo' ? palette.color('terracotta', 'var(--viz-terracotta)') : palette.color(c || seriesName, `var(--viz-${seriesName})`)
  const alpha = s.opacity !== undefined ? Math.min(1, Math.max(0.1, s.opacity)) : s.wireframe ? 0.12 : 0.88
  const poly = useMemo(() => polyhedron(s), [s])
  const faceGeo = useMemo(() => {
    if (!poly) return undefined
    const { positions, normals } = faceTriangles(poly)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    return g
  }, [poly])
  const edgeGeo = useMemo(() => {
    if (!poly) return undefined
    const pts: number[] = []
    for (const [a, b] of polyEdges(poly)) pts.push(...poly.vertices[a], ...poly.vertices[b])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [poly])
  const r = s.r ?? (s.a ?? 2) / 2, h = s.h ?? 3
  const radius = solidRadius(s)
  const material = <meshStandardMaterial color={color} roughness={0.45} metalness={0} transparent={alpha < 1} opacity={alpha} side={THREE.DoubleSide} depthWrite={alpha >= 0.95} wireframe={!poly && s.wireframe} flatShading={!!poly} />
  const dims = s.dims ? dimensionLabels(s, formatNumber) : []
  const lift = s.dims && dims.length === 1 && dims[0].at[0] === 0 && dims[0].at[2] === 0 ? 0.9 : 0.4
  return (
    <group position={[s.x, s.y, s.z]}>
      {faceGeo && <mesh geometry={faceGeo}>{material}</mesh>}
      {edgeGeo && (s.edges || s.wireframe) && (
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial color={palette.text2} />
        </lineSegments>
      )}
      {!poly && (
        <mesh>
          {s.shape === 'sphere' ? <sphereGeometry args={[r, 64, 48]} />
            : s.shape === 'cylinder' ? <cylinderGeometry args={[r, r, h, 64]} />
            : s.shape === 'cone' ? <cylinderGeometry args={[s.r2 ?? 0, r, h, 64]} />
            : s.shape === 'torus' ? <torusGeometry args={[r, s.r2 ?? r / 3, 32, 96]} />
            : s.shape === 'capsule' ? <capsuleGeometry args={[r, Math.max(h, 2 * r) - 2 * r, 16, 48]} />
            : <boxGeometry args={[2, 2, 2]} />}
          {material}
        </mesh>
      )}
      {!poly && s.edges && (s.shape === 'cylinder' || s.shape === 'cone') &&
        ([[-h / 2, r], [h / 2, s.shape === 'cone' ? s.r2 ?? 0 : r]] as Array<[number, number]>).filter(([, rr]) => rr > 0).map(([y, rr], i) => (
          <Line key={i} points={Array.from({ length: 65 }, (_, k) => [rr * Math.cos((k / 64) * Math.PI * 2), y, rr * Math.sin((k / 64) * Math.PI * 2)] as [number, number, number])} color={palette.text2} lineWidth={1.4} />
        ))}
      {dims.map((d, i) => (
        <Html key={`d${i}`} position={d.at} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <span className="block font-serif italic text-[14px] tabular text-text whitespace-nowrap bg-surface/80 rounded px-1">{d.text}</span>
        </Html>
      ))}
      {s.label && (
        <Html position={[0, radius + lift, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <span className="block rounded-[7px] bg-raised/90 px-2 text-[12.5px] leading-[18px] font-semibold text-text shadow-[var(--e1)] whitespace-nowrap">{s.label}</span>
        </Html>
      )}
    </group>
  )
}

function SceneLabel({ l }: { l: Label3D }) {
  return (
    <Html position={[l.x, l.y, l.z]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <span className="block rounded-[7px] bg-raised/90 px-2 text-[12.5px] leading-[18px] font-medium text-text shadow-[var(--e1)] whitespace-nowrap">{l.text.replace(/\$/g, '')}</span>
    </Html>
  )
}

// MARK: Modelos del curso

async function loadModel(url: string, ext: string, palette: ScenePalette): Promise<THREE.Object3D> {
  const neutral = (): THREE.Material => new THREE.MeshStandardMaterial({ color: palette.color('blue', 'var(--viz-blue)'), roughness: 0.55, metalness: 0 })
  switch (ext) {
    case 'glb': case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      return (await new GLTFLoader().loadAsync(url)).scene
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
      const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js')
      const g = await new OBJLoader().loadAsync(url)
      // sin .mtl: un material de papel; sin normales, sombreado suave (vértices compartidos)
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        o.material = neutral()
        const geo = o.geometry as THREE.BufferGeometry
        if (!geo.getAttribute('normal') || geo.getAttribute('normal').count === 0 || !geo.index) {
          geo.deleteAttribute('normal')
          geo.deleteAttribute('uv')
          const merged = mergeVertices(geo, 1e-4)
          merged.computeVertexNormals()
          o.geometry = merged
        }
      })
      return g
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
      const geo = await new STLLoader().loadAsync(url)
      geo.computeVertexNormals()
      return new THREE.Mesh(geo, neutral())
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
      const geo = await new PLYLoader().loadAsync(url)
      geo.computeVertexNormals()
      const mat = geo.getAttribute('color') ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) : neutral()
      return new THREE.Mesh(geo, mat)
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js')
      const c = await new ColladaLoader().loadAsync(url)
      if (!c) throw new Error('dae')
      return c.scene
    }
    case 'usdz': {
      const { USDZLoader } = await import('three/examples/jsm/loaders/USDZLoader.js')
      return await new USDZLoader().loadAsync(url)
    }
    default:
      throw new Error(`formato ${ext}`)
  }
}

/** Formatos que el visor sabe abrir (los demás de la app Swift —usd, scn, abc— dan el aviso de «no se pudo abrir»). */
export const LOADABLE = new Set(['glb', 'gltf', 'obj', 'stl', 'ply', 'dae', 'usdz'])

function ExternalModel({ url, asset, palette, onError }: { url: string; asset: string; palette: ScenePalette; onError: () => void }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let alive = true
    const ext = asset.split('.').pop()?.toLowerCase() ?? ''
    loadModel(url, ext, palette)
      .then((o) => {
        if (!alive) return
        // a una escala cómoda (radio ~3), centrado; un archivo vacío es un fallo
        const box = new THREE.Box3().setFromObject(o)
        if (box.isEmpty()) throw new Error('vacío')
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const k = sphere.radius > 0 && Number.isFinite(sphere.radius) ? 3 / sphere.radius : 1
        o.scale.multiplyScalar(k)
        o.position.sub(sphere.center.multiplyScalar(k))
        setObj(o)
        invalidate()
      })
      .catch(() => alive && onError())
    return () => {
      alive = false
    }
  }, [url, asset]) // eslint-disable-line react-hooks/exhaustive-deps
  // un <primitive> no lo libera R3F: geometrías, materiales y texturas del modelo, al quitarlo
  useEffect(() => (obj ? () => disposeObject3D(obj) : undefined), [obj])
  return obj ? <primitive object={obj} /> : null
}
