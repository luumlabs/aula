// Un papel con la esquina doblada y un marcapáginas de ladrillo, dibujado a mano. Encendido (al soltar o importar), sus
// renglones se encienden uno tras otro de arriba abajo, en bucle; quieto con «Reducir movimiento».
import { useEffect, useState } from 'react'
import { Sprite, useTheme } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'

const ROWS = [
  '.PPPPPPPPPF....',
  '.PwwwwwwwwPF...',
  '.PwwwwwwwwPFF..',
  '.PwwwwwwwwPPPF.',
  '.PwLLLLLLwwwwP.',
  '.PwwwwwwwwwwwP.',
  '.PwLLLLLLLLLwP.',
  '.PwwwwwwwwwwwP.',
  '.PwLLLLLLLwwwP.',
  '.PwwwwwwwwwwwP.',
  '.PwLLLLLLLLLwP.',
  '.PwwwwwwwwwwwP.',
  '.PwLLLLLwwwwwP.',
  '.PwwwwwwwwBBwP.',
  '.PwwwwwwwwBBwP.',
  '.PPPPPPPPPBBPP.',
  '..........B.B..'
]
/** Las filas de los renglones (de arriba abajo). */
const LINE_ROWS = [4, 6, 8, 10, 12]

export function PaperSprite({ lit, size = 44 }: { lit: boolean; size?: number }) {
  const { reducedMotion: still, dark } = useTheme()
  // encendido = algo pasa (importar): se anima también en reposo, pero no con la ventana sin ver
  const moving = useAmbient('activity')
  const [n, setN] = useState(LINE_ROWS.length)
  useEffect(() => {
    if (!lit || still || !moving) {
      setN(LINE_ROWS.length)
      return
    }
    setN(0)
    const id = setInterval(() => setN((v) => (v + 1) % (LINE_ROWS.length + 3)), 280)
    return () => clearInterval(id)
  }, [lit, still, moving])
  // los renglones aún sin encender van en el gris del papel
  const rows = ROWS.map((r, y) => {
    const i = LINE_ROWS.indexOf(y)
    return i >= 0 && lit && i >= n ? r.replace(/L/g, 'l') : r
  })
  const legend: Record<string, string> = {
    P: dark ? '#8f8a84' : '#9a948c',
    F: dark ? '#6c6762' : '#c9c2b8',
    w: dark ? '#2b2826' : '#fffdf9',
    L: lit ? 'var(--accent)' : dark ? '#55514c' : '#d8d2c9',
    l: dark ? '#55514c' : '#d8d2c9',
    B: 'var(--accent)'
  }
  return <Sprite rows={rows} legend={legend} size={size} />
}
