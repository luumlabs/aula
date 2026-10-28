// Visor 3D de moléculas (react-three-fiber). Se carga aparte para que three.js solo llegue al abrir la herramienta.
// Bolas y varillas o modelo compacto, pares solitarios como lóbulos translúcidos, el ángulo de enlace marcado con un
// arco y un giro suave que se para al arrastrar.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { angleBetween, covalentA, vdwA, type Molecule, type Vec } from './lib/vsepr'
import { ReleaseGL } from '@renderer/lib/glRelease'
import { useAmbient } from '@renderer/design/ambient'

export interface ViewerProps {
  molecule: Molecule
  mode: 'ball' | 'fill'
  showLone: boolean
  rotate: boolean
  dark: boolean
  reducedMotion: boolean
  angleLabel: string | null
}

/** Colores de los átomos: inspirados en CPK pero con los tonos tranquilos de la app. */
const ATOM_COLOR: Record<string, [string, string]> = {
  H: ['#f3efe7', '#e9e4da'], C: ['#4a4743', '#8d8781'], N: ['#3f6797', '#93b5e0'], O: ['#c8664a', '#ee9476'], F: ['#7db693', '#8cc7a3'],
  Cl: ['#3f7a5a', '#7db693'], Br: ['#a54a31', '#d48a6c'], I: ['#7c2937', '#da818a'], S: ['#e3a54e', '#e8ae5c'], P: ['#cf8a4e', '#e3a54e'],
  B: ['#cfb184', '#d4b88e'], Be: ['#a9b65a', '#b7c46e'], Xe: ['#2e4d7b', '#88a0c4'], Kr: ['#2e4d7b', '#88a0c4'], Si: ['#8c6d45', '#cfb184'], Se: ['#a35f12', '#e3a54e']
}
const colorOf = (el: string, dark: boolean) => (ATOM_COLOR[el] ?? ['#22767a', '#74c6c6'])[dark ? 1 : 0]

const v3 = (p: Vec) => new THREE.Vector3(p[0], p[1], p[2])

function useGrow(delay: number, reducedMotion: boolean) {
  const ref = useRef<THREE.Object3D>(null)
  const t0 = useRef<number | null>(null)
  useFrame((state) => {
    const o = ref.current
    if (!o) return
    if (reducedMotion) {
      o.scale.setScalar(1)
      return
    }
    if (t0.current === null) t0.current = state.clock.elapsedTime
    const t = Math.max(0, Math.min(1, (state.clock.elapsedTime - t0.current - delay) / 0.45))
    // muelle suave con un pequeño rebote
    const k = t === 1 ? 1 : 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.08
    o.scale.setScalar(Math.max(0.0001, k))
  })
  return ref
}

function AtomMesh({ el, p, r, i, dark, reducedMotion }: { el: string; p: Vec; r: number; i: number; dark: boolean; reducedMotion: boolean }) {
  const ref = useGrow(i * 0.06, reducedMotion)
  return (
    <mesh ref={ref as React.RefObject<THREE.Mesh>} position={p}>
      <sphereGeometry args={[r, 40, 28]} />
      <meshStandardMaterial color={colorOf(el, dark)} roughness={0.45} metalness={0.04} />
    </mesh>
  )
}

function BondMesh({ a, b, order, delay, dark, reducedMotion }: { a: Vec; b: Vec; order: number; delay: number; dark: boolean; reducedMotion: boolean }) {
  const ref = useGrow(delay, reducedMotion)
  const { mid, quat, len, offsets } = useMemo(() => {
    const A = v3(a)
    const B = v3(b)
    const dir = B.clone().sub(A)
    const len = dir.length()
    const n = dir.clone().normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
    let ref = new THREE.Vector3(0, 0, 1)
    if (Math.abs(n.dot(ref)) > 0.9) ref = new THREE.Vector3(0, 1, 0)
    const perp = new THREE.Vector3().crossVectors(n, ref).normalize()
    const off = order === 2 ? [-0.085, 0.085] : order === 3 ? [-0.12, 0, 0.12] : [0]
    return { mid: A.clone().add(B).multiplyScalar(0.5), quat: q, len, offsets: off.map((o) => perp.clone().multiplyScalar(o)) }
  }, [a, b, order])
  const radius = order === 1 ? 0.085 : 0.055
  return (
    <group ref={ref as React.RefObject<THREE.Group>} position={mid}>
      {offsets.map((o, k) => (
        <mesh key={k} position={o} quaternion={quat}>
          <cylinderGeometry args={[radius, radius, len, 18]} />
          <meshStandardMaterial color={dark ? '#b8b1a8' : '#9a948c'} roughness={0.55} />
        </mesh>
      ))}
    </group>
  )
}

function LoneLobe({ dir, i, reducedMotion, dark }: { dir: Vec; i: number; reducedMotion: boolean; dark: boolean }) {
  const ref = useGrow(0.4 + i * 0.08, reducedMotion)
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(dir).normalize()), [dir])
  const pos = useMemo(() => v3(dir).normalize().multiplyScalar(0.78), [dir])
  return (
    <group ref={ref as React.RefObject<THREE.Group>} position={pos} quaternion={q}>
      <mesh scale={[0.3, 0.52, 0.3]}>
        <sphereGeometry args={[1, 32, 20]} />
        <meshStandardMaterial color={dark ? '#f2c275' : '#e3a54e'} transparent opacity={dark ? 0.34 : 0.28} roughness={0.3} depthWrite={false} />
      </mesh>
      <mesh position={[0.09, 0.08, 0]}>
        <sphereGeometry args={[0.05, 12, 10]} />
        <meshStandardMaterial color="#a35f12" />
      </mesh>
      <mesh position={[-0.09, 0.08, 0]}>
        <sphereGeometry args={[0.05, 12, 10]} />
        <meshStandardMaterial color="#a35f12" />
      </mesh>
    </group>
  )
}

/** Arco del ángulo entre los dos primeros ligandos, con su valor. */
function AngleArc({ a, b, label, dark }: { a: Vec; b: Vec; label: string; dark: boolean }) {
  const pts = useMemo(() => {
    const A = v3(a).normalize()
    const B = v3(b).normalize()
    const ang = (angleBetween(a, b) * Math.PI) / 180
    const out: THREE.Vector3[] = []
    for (let k = 0; k <= 32; k++) {
      const t = k / 32
      // interpolación esférica entre las dos direcciones
      const s = Math.sin(ang) || 1
      const p = A.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).add(B.clone().multiplyScalar(Math.sin(t * ang) / s))
      out.push(p.multiplyScalar(0.62))
    }
    return out
  }, [a, b])
  const mid = pts[16].clone().multiplyScalar(1.35)
  return (
    <group>
      <Line points={pts} color={dark ? '#ef9c7b' : '#9c4527'} lineWidth={2} transparent opacity={0.9} />
      <AngleLabel position={mid} label={label} dark={dark} />
    </group>
  )
}

/**
 * La etiqueta del ángulo, dibujada en una textura (no es un elemento de la página: así no hay nada que desmontar fuera
 * de la escena al cambiar de molécula). Siempre mira a la cámara y queda por delante.
 */
function AngleLabel({ position, label, dark }: { position: THREE.Vector3; label: string; dark: boolean }) {
  const { texture, aspect } = useMemo(() => {
    const scale = 4
    const font = `600 ${12 * scale}px "Inter Variable", system-ui, sans-serif`
    const probe = document.createElement('canvas').getContext('2d')
    if (probe) probe.font = font
    const w = Math.ceil((probe?.measureText(label).width ?? label.length * 7 * scale) + 18 * scale)
    const h = 22 * scale
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = dark ? 'rgba(46,42,38,0.95)' : 'rgba(255,253,249,0.95)'
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'
      ctx.lineWidth = scale
      ctx.beginPath()
      ctx.roundRect(scale, scale, w - 2 * scale, h - 2 * scale, h / 2)
      ctx.fill()
      ctx.stroke()
      ctx.font = font
      ctx.fillStyle = dark ? '#ef9c7b' : '#9c4527'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, w / 2, h / 2 + scale * 0.5)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return { texture: tex, aspect: w / h }
  }, [label, dark])
  useEffect(() => () => texture.dispose(), [texture])
  const height = 0.3
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={10}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  )
}

/** Encuadra la cámara para cada molécula (a lo ancho y a lo alto del visor), manteniendo desde dónde se mira. */
function CameraFit({ extent }: { extent: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const distance = (extent / Math.tan(Math.min(vFov, hFov) / 2)) * 1.12
    const target = controls?.target ?? new THREE.Vector3()
    const dir = camera.position.clone().sub(target)
    if (dir.lengthSq() < 1e-6) dir.set(0.12, 0.18, 1)
    camera.position.copy(target.clone().add(dir.normalize().multiplyScalar(distance)))
    camera.updateProjectionMatrix()
    controls?.update()
  }, [extent, size.width, size.height, camera, controls])
  return null
}

function Scene({ molecule, mode, showLone, dark, reducedMotion, angleLabel }: Omit<ViewerProps, 'rotate'>) {
  const center = useMemo(() => {
    if (molecule.shape !== 'multi' && molecule.shape !== 'diatomic') return new THREE.Vector3(0, 0, 0)
    const c = new THREE.Vector3()
    molecule.atoms.forEach((a) => c.add(v3(a.p)))
    return c.multiplyScalar(1 / molecule.atoms.length)
  }, [molecule])
  const single = molecule.shape !== 'multi' && molecule.shape !== 'diatomic'
  return (
    <group position={center.clone().multiplyScalar(-1)}>
      {molecule.atoms.map((a, i) => (
        <AtomMesh key={i} el={a.el} p={a.p} i={i} r={mode === 'fill' ? vdwA(a.el) * 0.78 : 0.18 + covalentA(a.el) * 0.36} dark={dark} reducedMotion={reducedMotion} />
      ))}
      {mode === 'ball' && molecule.bonds.map((b, i) => <BondMesh key={i} a={molecule.atoms[b.a].p} b={molecule.atoms[b.b].p} order={b.order} delay={0.15 + i * 0.05} dark={dark} reducedMotion={reducedMotion} />)}
      {mode === 'ball' && showLone && single && molecule.lone.map((d, i) => <LoneLobe key={i} dir={d} i={i} reducedMotion={reducedMotion} dark={dark} />)}
      {mode === 'ball' && single && angleLabel && molecule.atoms.length >= 3 && <AngleArc a={molecule.atoms[1].p} b={molecule.atoms[2].p} label={angleLabel} dark={dark} />}
    </group>
  )
}

/** Unos instantes tras cambiar de molécula o de modelo (lo que tarda en crecer): mientras, se dibuja cada fotograma. */
function useSettling(key: string, ms = 1800): boolean {
  const [settling, setSettling] = useState(true)
  useEffect(() => {
    setSettling(true)
    const t = setTimeout(() => setSettling(false), ms)
    return () => clearTimeout(t)
  }, [key, ms])
  return settling
}

export default function Viewer(props: ViewerProps) {
  const { molecule, rotate, reducedMotion } = props
  const extent = useMemo(() => Math.max(1.6, ...molecule.atoms.map((a) => Math.hypot(...a.p) + vdwA(a.el) * 0.6)), [molecule])
  const settling = useSettling(`${molecule.id}-${props.mode}-${props.showLone}`)
  // solo se dibuja sin parar mientras gira o crece; quieta, solo cuando algo cambia (arrastrar, el zoom): menos GPU y batería
  // y el giro, solo mientras alguien usa la app y la ventana se ve (design/ambient.ts)
  const live = useAmbient()
  const spinning = rotate && !reducedMotion && live
  const frameloop = spinning || (settling && !reducedMotion) ? 'always' : 'demand'
  return (
    <Canvas frameloop={frameloop} dpr={[1, 2]} camera={{ position: [0.4, 0.6, extent * 3.1], fov: 38 }} gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 8]} intensity={1.6} />
      <directionalLight position={[-6, -3, -4]} intensity={0.45} />
      <group key={`${molecule.id}-${props.mode}`}>
        <Scene {...props} />
      </group>
      <OrbitControls makeDefault autoRotate={spinning} autoRotateSpeed={0.9} enablePan={false} minDistance={extent * 1.4} maxDistance={extent * 6} enableDamping />
      <CameraFit extent={extent} />
      <ReleaseGL />
    </Canvas>
  )
}
