// Escena estática aislada: conserva el orden global SVG → texto HTML → rodeados Ink.
import type { DrawingRenderSceneV1, PreparedDrawingRing } from '@shared/figuresDrawing'
import { StaticDrawingText } from '@renderer/lib/figureExport/StaticDrawingText'
import { FIGURE_FONTS } from '@renderer/lib/figureExport/figureTypography'

function StaticRing({ ring, id }: { ring: PreparedDrawingRing; id: string }) {
  return <svg viewBox={`0 0 ${ring.viewWidth} ${ring.viewHeight}`} preserveAspectRatio="none" aria-hidden
    style={{ position: 'absolute', left: ring.x, top: ring.y, width: ring.width, height: ring.height, overflow: 'visible' }}>
    <defs>{ring.strokes.map((stroke, index) => <mask key={index} id={`${id}-${index}`} maskUnits="userSpaceOnUse" x={-20} y={-20} width={ring.viewWidth + 40} height={ring.viewHeight + 40}>
      <path d={stroke.spine} fill="none" stroke="#fff" strokeWidth={stroke.reach} strokeLinecap="round" strokeLinejoin="round" />
      {stroke.dry && <path d={stroke.dry} fill="none" stroke="#000" strokeWidth={stroke.dryWidth} strokeLinecap="round" />}
    </mask>)}</defs>
    {ring.strokes.map((stroke, index) => <path data-drawing-geometry key={index} d={stroke.d} fill={ring.color} mask={`url(#${id}-${index})`} />)}
  </svg>
}

export function DrawingExportScene({ scene }: { scene: DrawingRenderSceneV1 }) {
  const k = scene.metrics.layoutWidth / scene.canvas.width
  return <div data-drawing-scene style={{ position: 'relative', width: scene.metrics.layoutWidth, height: scene.canvas.height * k, color: scene.appearance.palette.text, fontFamily: FIGURE_FONTS[scene.metrics.bodyFont], fontStyle: scene.metrics.bodyItalic ? 'italic' : 'normal' }}>
    <svg viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`} width="100%" height="100%" preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      {scene.items.map((item) => <g key={item.sourceIndex} opacity={item.opacity} transform={`translate(${item.transform.dx} ${item.transform.dy}) rotate(${-item.transform.deg} ${item.transform.px} ${item.transform.py})`}>
        {item.paths.map((path, index) => {
          const id = `h-${item.sourceIndex}-${index}`
          return <g key={index} transform={`translate(${path.offset.x} ${path.offset.y})`}>
            {path.fill.kind === 'hatch' && <defs><pattern id={id} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
              <path d="M0 0V6" stroke={path.fill.color} strokeWidth={1.1} />
            </pattern></defs>}
            <path data-drawing-geometry d={path.d} fill={path.fill.kind === 'hatch' ? `url(#${id})` : path.fill.kind === 'solid' ? path.fill.color : 'none'} fillOpacity={path.fillOpacity}
              stroke={path.stroke} strokeWidth={path.width} strokeOpacity={path.strokeOpacity} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={path.dashed ? '6 5' : undefined} />
          </g>
        })}
      </g>)}
    </svg>
    {scene.items.flatMap((item) => item.labels.map((label, index) => <div data-drawing-label key={`${item.sourceIndex}-${index}`}
      className="viz-label absolute whitespace-nowrap font-medium pointer-events-none" style={{ left: label.x * k, top: label.y * k, fontSize: label.size, lineHeight: 1.2, color: label.color, opacity: item.opacity, transform: `translate(${label.anchor === 'left' ? 0 : label.anchor === 'right' ? -100 : -50}%, -50%)` }}>
      <StaticDrawingText text={label.text} language={scene.appearance.language} direction={scene.appearance.direction} />
    </div>))}
    {[...scene.items].sort((a, b) => a.sourceIndex - b.sourceIndex).flatMap((item) => item.rings.map((ring, index) => <StaticRing key={`${item.sourceIndex}-${index}`} ring={ring} id={`r-${item.sourceIndex}-${index}`} />))}
  </div>
}
