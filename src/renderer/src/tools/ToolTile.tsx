// La loseta de una herramienta: dibujada a mano y con su pigmento. Es la misma en «Herramientas» y en «Hoy», para que
// cada herramienta se reconozca por su color allí donde salga.
import { DrawnTile, TONES, useTheme, type CourseTone } from '@renderer/design'
import { TOOLS, type ToolDef } from './registry'

/** El tono de cada herramienta: los de los cursos, salteados para que dos vecinas no se parezcan. */
export function toolTone(id: string): CourseTone {
  const at = Math.max(0, TOOLS.findIndex((t) => t.id === id))
  return TONES[(at * 3) % TONES.length]
}

export function ToolTile({ tool, size = 48 }: { tool: ToolDef; size?: number }) {
  const { dark } = useTheme()
  const tone = toolTone(tool.id)
  const ink = dark ? tone.inkDark : tone.inkLight
  const Icon = tool.icon
  return (
    <DrawnTile
      seed={`herramienta:${tool.id}`}
      size={size}
      radius={Math.round(size * 0.29)}
      fill={`color-mix(in oklab, ${dark ? tone.fillDark : tone.fillLight} ${dark ? 26 : 17}%, var(--paper))`}
      ink={ink}
      inkAlpha={dark ? 0.6 : 0.7}
    >
      <span className="relative grid h-full w-full place-items-center" style={{ color: ink }}>
        <Icon size={Math.round(size * 0.46)} strokeWidth={1.7} />
      </span>
    </DrawnTile>
  )
}
