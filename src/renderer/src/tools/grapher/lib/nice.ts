// Valores «bonitos» para las coordenadas de los puntos notables: enteros, fracciones, múltiplos de π y raíces, o el
// decimal con 4 cifras (como GraphMath.Nice de la app Swift).
import { exactForm } from '../../calculator/lib/engine'

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b))

function decimal(v: number, comma: boolean): string {
  const r = Math.abs(v) < 5e-5 ? 0 : v
  let s = Math.abs(r) >= 1e6 || (Math.abs(r) < 1e-4 && r !== 0) ? r.toExponential(3) : r.toFixed(4)
  if (!s.includes('e')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return comma ? s.replace('.', ',') : s
}

/** LaTeX y texto plano de un valor (`precise`: intenta formas exactas). */
export function niceValue(v: number, comma: boolean, precise = true): { tex: string; plain: string } {
  if (!Number.isFinite(v)) return { tex: '\\text{—}', plain: '—' }
  const dec = decimal(v, comma)
  const decTex = (s: string) => s.replace(',', '{,}').replace(/e([+-]?\d+)$/, (_m, e: string) => `\\times10^{${Number(e)}}`)
  if (!precise) return { tex: decTex(dec), plain: dec }
  const tol = 1e-9 * Math.max(1, Math.abs(v))
  if (Math.abs(v) < 1e-10) return { tex: '0', plain: '0' }
  if (Math.abs(v - Math.round(v)) < tol && Math.abs(v) < 1e12) {
    const n = Math.round(v)
    return { tex: String(n), plain: String(n).replace('-', '−') }
  }
  for (let q = 2; q <= 12; q++) {
    const p = Math.round(v * q)
    if (Math.abs(p) <= 1000 && Math.abs(v - p / q) < tol) {
      const g = gcd(Math.abs(p), q)
      const n = Math.abs(p) / g
      const d = q / g
      if (d === 1) continue
      return { tex: `${p < 0 ? '-' : ''}\\frac{${n}}{${d}}`, plain: `${p < 0 ? '−' : ''}${n}/${d}` }
    }
  }
  const ex = exactForm(v, 1e-9)
  if (ex) return { tex: ex.tex, plain: ex.plain.replace('-', '−') }
  return { tex: decTex(dec), plain: dec.replace('-', '−') }
}
