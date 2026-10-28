// Funciones especiales que `Math` no trae: `erfc` (fdlibm, como la libm de Swift) y `lgamma` (Stirling con desplazamiento).

const buffer = new DataView(new ArrayBuffer(8))

function highWord(x: number): number {
  buffer.setFloat64(0, x)
  return buffer.getInt32(0)
}

/** El mismo número con los 32 bits bajos a cero. */
function clearLowWord(x: number): number {
  buffer.setFloat64(0, x)
  buffer.setUint32(4, 0)
  return buffer.getFloat64(0)
}

const tiny = 1e-300
const erx = 8.45062911510467529297e-1
const pp0 = 1.28379167095512558561e-1
const pp1 = -3.25042107247001499370e-1
const pp2 = -2.84817495755985104766e-2
const pp3 = -5.77027029648944159157e-3
const pp4 = -2.37630166566501626084e-5
const qq1 = 3.97917223959155352819e-1
const qq2 = 6.50222499887672944485e-2
const qq3 = 5.08130628187576562776e-3
const qq4 = 1.32494738004321644526e-4
const qq5 = -3.96022827877536812320e-6
const pa0 = -2.36211856075265944077e-3
const pa1 = 4.14856118683748331666e-1
const pa2 = -3.72207876035701323847e-1
const pa3 = 3.18346619901161753674e-1
const pa4 = -1.10894694282396677476e-1
const pa5 = 3.54783043256182359371e-2
const pa6 = -2.16637559486879084300e-3
const qa1 = 1.06420880400844228286e-1
const qa2 = 5.40397917702171048937e-1
const qa3 = 7.18286544141962662868e-2
const qa4 = 1.26171219808761642112e-1
const qa5 = 1.36370839120290507362e-2
const qa6 = 1.19844998467991074170e-2
const ra0 = -9.86494403484714822705e-3
const ra1 = -6.93858572707181764372e-1
const ra2 = -1.05586262253232909814e1
const ra3 = -6.23753324503260060396e1
const ra4 = -1.62396669462573470355e2
const ra5 = -1.84605092906711035994e2
const ra6 = -8.12874355063065934246e1
const ra7 = -9.81432934416914548592
const sa1 = 1.96512716674392571292e1
const sa2 = 1.37657754143519042600e2
const sa3 = 4.34565877475229228821e2
const sa4 = 6.45387271733267880336e2
const sa5 = 4.29008140027567833386e2
const sa6 = 1.08635005541779435134e2
const sa7 = 6.57024977031928170135
const sa8 = -6.04244152148580987438e-2
const rb0 = -9.86494292470009928597e-3
const rb1 = -7.99283237680523006574e-1
const rb2 = -1.77579549177547519889e1
const rb3 = -1.60636384855821916062e2
const rb4 = -6.37566443368389627722e2
const rb5 = -1.02509513161107724954e3
const rb6 = -4.83519191608651397019e2
const sb1 = 3.03380607434824582924e1
const sb2 = 3.25792512996573918826e2
const sb3 = 1.53672958608443695994e3
const sb4 = 3.19985821950859553908e3
const sb5 = 2.55305040643316442583e3
const sb6 = 4.74528541206955367215e2
const sb7 = -2.24409524465858183362e1

/** Función de error complementaria erfc(x) = 1 − erf(x) (algoritmo de fdlibm). */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (x === Infinity) return 0
  if (x === -Infinity) return 2
  const hx = highWord(x)
  const ix = hx & 0x7fffffff
  if (ix < 0x3feb0000) {
    // |x| < 0.84375
    if (ix < 0x3c700000) return 1 - x // |x| < 2**-56
    const z = x * x
    const r = pp0 + z * (pp1 + z * (pp2 + z * (pp3 + z * pp4)))
    const s = 1 + z * (qq1 + z * (qq2 + z * (qq3 + z * (qq4 + z * qq5))))
    const y = r / s
    if (hx < 0x3fd00000) return 1 - (x + x * y) // x < 1/4
    let rr = x * y
    rr += x - 0.5
    return 0.5 - rr
  }
  if (ix < 0x3ff40000) {
    // 0.84375 <= |x| < 1.25
    const s = Math.abs(x) - 1
    const P = pa0 + s * (pa1 + s * (pa2 + s * (pa3 + s * (pa4 + s * (pa5 + s * pa6)))))
    const Q = 1 + s * (qa1 + s * (qa2 + s * (qa3 + s * (qa4 + s * (qa5 + s * qa6)))))
    if (hx >= 0) return 1 - erx - P / Q
    return 1 + (erx + P / Q)
  }
  if (ix < 0x403c0000) {
    // |x| < 28
    const ax = Math.abs(x)
    const s = 1 / (ax * ax)
    let R: number
    let S: number
    if (ix < 0x4006db6d) {
      // |x| < 1/.35 ~ 2.857143
      R = ra0 + s * (ra1 + s * (ra2 + s * (ra3 + s * (ra4 + s * (ra5 + s * (ra6 + s * ra7))))))
      S = 1 + s * (sa1 + s * (sa2 + s * (sa3 + s * (sa4 + s * (sa5 + s * (sa6 + s * (sa7 + s * sa8)))))))
    } else {
      if (hx < 0 && ix >= 0x40180000) return 2 - tiny // x < -6
      R = rb0 + s * (rb1 + s * (rb2 + s * (rb3 + s * (rb4 + s * (rb5 + s * rb6)))))
      S = 1 + s * (sb1 + s * (sb2 + s * (sb3 + s * (sb4 + s * (sb5 + s * (sb6 + s * sb7))))))
    }
    const z = clearLowWord(ax)
    const r = Math.exp(-z * z - 0.5625) * Math.exp((z - ax) * (z + ax) + R / S)
    return hx > 0 ? r / ax : 2 - r / ax
  }
  return hx > 0 ? tiny * tiny : 2 - tiny
}

// Coeficientes de la serie de Stirling: B₂ₖ / (2k(2k−1)).
const STIRLING = [
  1 / 12, -1 / 360, 1 / 1260, -1 / 1680, 1 / 1188, -691 / 360360, 1 / 156, -3617 / 122400,
]
const HALF_LOG_2PI = 0.9189385332046727 // ln(2π)/2

/** Logaritmo del valor absoluto de la función gamma, ln|Γ(x)|. */
export function lgamma(x: number): number {
  if (Number.isNaN(x)) return NaN
  if (!Number.isFinite(x)) return Infinity
  if (x <= 0 && x === Math.floor(x)) return Infinity
  if (x < 0.5) {
    // reflexión: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x)
  }
  if (x === 1 || x === 2) return 0
  // Enteros pequeños: logaritmo del factorial exacto (en coma flotante)
  if (x === Math.floor(x) && x <= 23) {
    let f = 1
    for (let i = 2; i < x; i++) f *= i
    return Math.log(f)
  }
  // Desplazamiento hasta un argumento grande y serie asintótica
  let shift = 0
  let prod = 1
  let y = x
  while (y < 15) {
    prod *= y
    y += 1
    shift += 1
  }
  const inv = 1 / y
  const inv2 = inv * inv
  let series = 0
  let p = inv
  for (const c of STIRLING) {
    series += c * p
    p *= inv2
  }
  const value = (y - 0.5) * Math.log(y) - y + HALF_LOG_2PI + series
  return shift > 0 ? value - Math.log(prod) : value
}
