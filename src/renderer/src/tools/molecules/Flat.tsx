// Vista de respaldo sin WebGL: la misma molécula proyectada en SVG (bolas ordenadas por profundidad, varillas y pares
// solitarios), que gira despacio y se puede arrastrar. Así la herramienta sirve también en equipos sin aceleración 3D.
import { useEffect, useMemo, useRef, useState } from 'react'
import { covalentA, vdwA, type Molecule, type Vec } from './lib/vsepr'

const COLOR: Record<string, [string, string]> = { H: ['#f3efe7', '#e9e4da'], C: ['#4a4743', '#8d8781'], N: ['#3f6797', '#93b5e0'], O: ['#c8664a', '#ee9476'], F: ['#7db693', '#8cc7a3'], Cl: ['#3f7a5a', '#7db693'], Br: ['#a54a31', '#d48a6c'], I: ['#7c2937', '#da818a'], S: ['#e3a54e', '#e8ae5c'], P: ['#cf8a4e', '#e3a54e'], B: ['#cfb184', '#d4b88e'], Be: ['#a9b65a', '#b7c46e'], Xe: ['#2e4d7b', '#88a0c4'] }
const colorOf = (el: string, dark: boolean) => (COLOR[el] ?? ['#22767a', '#74c6c6'])[dark ? 1 : 0]

function rotate(p: Vec, ay: number, ax: number): Vec {
  const [x, y, z] = p
  const x1 = x * Math.cos(ay) + z * Math.sin(ay)
  const z1 = -x * Math.sin(ay) + z * Math.cos(ay)
  const y2 = y * Math.cos(ax) - z1 * Math.sin(ax)
  const z2 = y * Math.sin(ax) + z1 * Math.cos(ax)
  return [x1, y2, z2]
}

export default function Flat({ molecule, mode, showLone, rotate: spin, dark, reducedMotion }: { molecule: Molecule; mode: 'ball' | 'fill'; showLone: boolean; rotate: boolean; dark: boolean; reducedMotion: boolean }) {
  const [angles, setAngles] = useState({ y: 0.5, x: -0.35 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!spin || reducedMotion) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (!drag.current) setAngles((a) => ({ ...a, y: a.y + dt * 0.45 }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [spin, reducedMotion])
  const center = useMemo(() => {
    const c: Vec = [0, 0, 0]
    molecule.atoms.forEach((a) => {
      c[0] += a.p[0] / molecule.atoms.length
      c[1] += a.p[1] / molecule.atoms.length
      c[2] += a.p[2] / molecule.atoms.length
    })
    return c
  }, [molecule])
  const extent = Math.max(1.6, ...molecule.atoms.map((a) => Math.hypot(a.p[0] - center[0], a.p[1] - center[1], a.p[2] - center[2]) + vdwA(a.el) * 0.6))
  const S = 150 / extent
  const proj = molecule.atoms.map((a) => rotate([a.p[0] - center[0], a.p[1] - center[1], a.p[2] - center[2]], angles.y, angles.x))
  const order = proj.map((p, i) => ({ i, z: p[2] })).sort((a, b) => a.z - b.z)
  const single = molecule.shape !== 'multi' && molecule.shape !== 'diatomic'
  return (
    <svg
      viewBox="-200 -200 400 400"
      className="absolute inset-0 w-full h-full touch-none"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        const dx = e.clientX - drag.current.x
        const dy = e.clientY - drag.current.y
        drag.current = { x: e.clientX, y: e.clientY }
        setAngles((a) => ({ y: a.y + dx * 0.01, x: Math.max(-1.4, Math.min(1.4, a.x + dy * 0.01)) }))
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <defs>
        <radialGradient id="flat-shine" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.55} />
          <stop offset="60%" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>
      {mode === 'ball' &&
        molecule.bonds.map((b, k) => {
          const p = proj[b.a]
          const q = proj[b.b]
          return <line key={k} x1={p[0] * S} y1={-p[1] * S} x2={q[0] * S} y2={-q[1] * S} stroke={dark ? '#b8b1a8' : '#9a948c'} strokeWidth={b.order === 1 ? 7 : b.order === 2 ? 12 : 16} strokeLinecap="round" opacity={0.9} />
        })}
      {mode === 'ball' && showLone && single &&
        molecule.lone.map((d, k) => {
          const r = rotate(d, angles.y, angles.x)
          return <ellipse key={k} cx={r[0] * S * 0.8} cy={-r[1] * S * 0.8} rx={14} ry={22} transform={`rotate(${(Math.atan2(-r[1], r[0]) * 180) / Math.PI + 90} ${r[0] * S * 0.8} ${-r[1] * S * 0.8})`} fill="rgba(227,165,78,.3)" />
        })}
      {order.map(({ i }) => {
        const a = molecule.atoms[i]
        const p = proj[i]
        const r = (mode === 'fill' ? vdwA(a.el) * 0.78 : 0.18 + covalentA(a.el) * 0.36) * S * (1 + p[2] * 0.04)
        return (
          <g key={i}>
            <circle cx={p[0] * S} cy={-p[1] * S} r={r} fill={colorOf(a.el, dark)} stroke="rgba(0,0,0,.12)" strokeWidth={0.8} />
            <circle cx={p[0] * S} cy={-p[1] * S} r={r} fill="url(#flat-shine)" />
          </g>
        )
      })}
    </svg>
  )
}
