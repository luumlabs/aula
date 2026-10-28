// El sobre de «Novedades» en pixel-art: con algo sin leer, el sello (el sol de Aula) se enciende y suelta dos destellos; todo
// al día, queda quieto y en gris. Quieto también con «Reducir movimiento».
import { useEffect, useState } from 'react'
import { Sprite, useTheme } from '@renderer/design'
import { useAmbient } from '@renderer/design/ambient'

const BODY = [
  '.ooooooooooooooo.',
  'oVpppppppppppppVo',
  'opVpppppppppppVpo',
  'oppVpppppppppVppo',
  'opppVpppppppVpppo',
  'oppppVpppppVppppo',
  'opppppVpppVpppppo',
  'oppppppSgSppppppo',
  'opppppSSSSSpppppo',
  'oppppppSSSppppppo',
  'opppppppppppppppo',
  '.ooooooooooooooo.'
]
/** Destellos arriba a la derecha (dos fotogramas): 3 columnas × 4 filas. */
const SPARKS = [['.r.', '...', 'r..', '...'], ['...', '..r', '...', '.r.']]

function rows(frame: number, lit: boolean): string[] {
  const sp = lit ? SPARKS[frame] : ['...', '...', '...', '...']
  const seal = (r: string) => (lit ? (frame === 1 ? r.replace('g', 's') : r) : r.replace(/[gS]/g, 'G'))
  const body = BODY.map((r, i) => seal(r) + (i < 2 ? sp[i + 2] : '...'))
  return ['.................' + sp[0], '.................' + sp[1], ...body]
}

export function PixelEnvelope({ size = 40, lit }: { size?: number; lit: boolean }) {
  const { reducedMotion } = useTheme()
  const [frame, setFrame] = useState(0)
  const moving = useAmbient()
  useEffect(() => {
    if (!lit || reducedMotion || !moving) return
    const id = setInterval(() => setFrame((f) => (f + 1) % 2), 700)
    return () => clearInterval(id)
  }, [lit, reducedMotion, moving])
  const legend: Record<string, string> = {
    o: 'var(--text2)',
    V: 'color-mix(in oklab, var(--text2) 55%, transparent)',
    p: 'var(--raised)',
    S: 'var(--sun)',
    g: 'color-mix(in oklab, var(--sun) 70%, #fff6dc)',
    s: '#fff6dc',
    G: 'var(--text3)',
    r: 'var(--sun)'
  }
  return <Sprite rows={rows(lit && !reducedMotion ? frame : 0, lit)} legend={legend} size={size} />
}
