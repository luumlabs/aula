// Tema (claro/oscuro), movimiento reducido y tamaño de texto. Sigue a los ajustes y al sistema.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type MotionMode = 'system' | 'full' | 'reduced'

interface ThemeState {
  dark: boolean
  reducedMotion: boolean
  mode: ThemeMode
}

const ThemeContext = createContext<ThemeState>({ dark: false, reducedMotion: false, mode: 'system' })

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const fn = () => setMatch(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [query])
  return match
}

export function ThemeProvider({ mode, motion, textScale = 1, children }: { mode: ThemeMode; motion: MotionMode; textScale?: number; children: ReactNode }) {
  const systemDark = useMedia('(prefers-color-scheme: dark)')
  const systemReduced = useMedia('(prefers-reduced-motion: reduce)')
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  const reducedMotion = motion === 'reduced' || (motion === 'system' && systemReduced)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    root.classList.toggle('reduce-motion', reducedMotion)
    root.style.fontSize = `${Math.round(15 * Math.min(1.4, Math.max(0.85, textScale)))}px`
    document.body.style.fontSize = 'inherit'
  }, [dark, reducedMotion, textScale])

  const value = useMemo(() => ({ dark, reducedMotion, mode }), [dark, reducedMotion, mode])
  return (
    <ThemeContext.Provider value={value}>
      {/* con movimiento reducido no basta con quitar los desplazamientos: también las entradas (opacidad y retrasos escalonados,
          el mapa de calor celda a celda) van al instante; si no, la pantalla nueva salía vacía y aparecía a trompicones (A4-P2-15) */}
      <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'} skipAnimations={reducedMotion}>{children}</MotionConfig>
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext)
}
