// Tonos curados de los cursos («Papel y luz»: tintas de papel, NUNCA violeta, morado ni lila). Los de la app Swift tenían
// índigo y ciruela: sus `hue` (0,68 y 0,8) se quedan, pero ahora pintan «navy» (tinta azul noche) y «wine» (vino), así los
// cursos ya guardados con esos tonos conservan su familia sin violeta. `colorGuard.test.ts` lo vigila.
export type CourseToneName = 'coral' | 'amber' | 'sand' | 'olive' | 'sage' | 'teal' | 'slate' | 'navy' | 'wine' | 'rose'

export interface CourseTone {
  name: CourseToneName
  hue: number
  fillLight: string
  inkLight: string
  fillDark: string
  inkDark: string
  top: string
  bottom: string
}

export const TONES: CourseTone[] = [
  { name: 'coral', hue: 0.03, fillLight: '#B9553A', inkLight: '#A54A31', fillDark: '#C8664A', inkDark: '#EE9476', top: '#E38B69', bottom: '#B24F35' },
  { name: 'amber', hue: 0.09, fillLight: '#A35F12', inkLight: '#94560F', fillDark: '#B87422', inkDark: '#E8AE5C', top: '#E3A54E', bottom: '#A95F12' },
  { name: 'sand', hue: 0.13, fillLight: '#8C6D45', inkLight: '#7D613C', fillDark: '#9E7E54', inkDark: '#D4B88E', top: '#CFB184', bottom: '#8E6E44' },
  { name: 'olive', hue: 0.2, fillLight: '#68742A', inkLight: '#5D6825', fillDark: '#7A8736', inkDark: '#B7C46E', top: '#A9B65A', bottom: '#67742A' },
  { name: 'sage', hue: 0.38, fillLight: '#3F7A5A', inkLight: '#386E51', fillDark: '#4E8C69', inkDark: '#8CC7A3', top: '#7DB693', bottom: '#3B7555' },
  { name: 'teal', hue: 0.5, fillLight: '#22767A', inkLight: '#1F6A6E', fillDark: '#2E8A8E', inkDark: '#74C6C6', top: '#5DB4B2', bottom: '#1F7074' },
  { name: 'slate', hue: 0.6, fillLight: '#3F6797', inkLight: '#395D88', fillDark: '#5079AA', inkDark: '#93B5E0', top: '#7FA3D2', bottom: '#3B6192' },
  { name: 'navy', hue: 0.68, fillLight: '#2E4D7B', inkLight: '#26426C', fillDark: '#426496', inkDark: '#88A0C4', top: '#6888B6', bottom: '#213D66' },
  { name: 'wine', hue: 0.8, fillLight: '#8D3140', inkLight: '#7C2937', fillDark: '#A64452', inkDark: '#DA818A', top: '#CA6B76', bottom: '#772935' },
  { name: 'rose', hue: 0.93, fillLight: '#B04664', inkLight: '#9F3F5A', fillDark: '#BE5674', inkDark: '#EE97AE', top: '#E68AA1', bottom: '#A9425F' },
]

/** El tono curado más cercano a un `hue` cualquiera (0…1; NaN → terracota). */
export function toneForHue(hue: number | undefined | null): CourseTone {
  if (hue == null || !Number.isFinite(hue)) return TONES[0]
  const h = hue - Math.floor(hue)
  let best = TONES[0]
  let bestD = Infinity
  for (const t of TONES) {
    const d0 = Math.abs(h - t.hue)
    const d = Math.min(d0, 1 - d0)
    if (d < bestD - 1e-9) {
      best = t
      bestD = d
    }
  }
  return best
}

function hex6(n: number): string {
  return '#' + n.toString(16).padStart(6, '0')
}
/** Mezcla lineal de dos colores #rrggbb (t = 0 → a, t = 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (v: number, s: number) => (v >> s) & 0xff
  const m = (s: number) => Math.max(0, Math.min(255, Math.round(ch(pa, s) * (1 - t) + ch(pb, s) * t))) << s
  return hex6(m(16) | m(8) | m(0))
}

/** Rampa a1…a4 del color del curso (de claro a oscuro) para los iconos pixel-art. */
export function accentRamp(tone: CourseTone): string[] {
  return [mixHex(tone.top, '#ffffff', 0.45), tone.top, mixHex(tone.top, tone.bottom, 0.6), mixHex(tone.bottom, '#140a14', 0.35)]
}
