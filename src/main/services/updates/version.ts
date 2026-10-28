// Números de versión (MAJOR.MINOR.PATCH[-pre]) sin dependencias: comparar y reconocer una prerelease.

/** Las tres cifras de una versión («0.1.10-beta.1» → [0, 1, 10]); null si no es una versión. */
export function versionCore(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

/** <0, 0 o >0 según a sea menor, igual o mayor que b (solo las cifras; las ilegibles cuentan como iguales). */
export function compareVersions(a: string, b: string): number {
  const x = versionCore(a)
  const y = versionCore(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** ¿Es una prerelease («0.2.0-beta», «1.0.0-rc.1»)? Nunca se ofrece sola, aunque GitHub no la marque como tal. */
export function isPrerelease(v: string): boolean {
  return /^v?\d+\.\d+(?:\.\d+)?-/.test(v.trim())
}
