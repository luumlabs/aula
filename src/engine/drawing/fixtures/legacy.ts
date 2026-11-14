// Elementos de los tipos de siempre (el ejemplo de Pitágoras de la galería y uno por tipo): su dibujo no debe cambiar.
import type { DrawItem } from '@shared/schema/common'
import type { DrawShape } from '../shapes'

export const LEGACY_ITEMS: DrawItem[] = [
  { kind: 'polygon', points: [[70, 240], [330, 240], [70, 70]], stroke: 'ink', fill: 'blue', opacity: 0.1, width: 2 },
  { kind: 'rightAngle', cx: 70, cy: 240, r: 16, stroke: 'ink', width: 1.5 },
  { kind: 'angle', cx: 330, cy: 240, r: 42, start: 147, end: 180, stroke: 'accent', width: 1.5, label: '$\\alpha$' },
  { kind: 'text', x: 200, y: 262, text: '$b$', size: 17 },
  { kind: 'text', x: 50, y: 155, text: '$a$', size: 17 },
  { kind: 'text', x: 214, y: 140, text: '$c$', size: 17 },
  { kind: 'arrow', x1: 340, y1: 80, x2: 220, y2: 150, stroke: 'gray', dashed: true, width: 1.5 },
  { kind: 'text', x: 345, y: 70, text: 'hipotenusa', anchor: 'left', size: 13, stroke: 'gray' },
  { kind: 'dot', cx: 70, cy: 70, r: 4, fill: 'accent' },
  { kind: 'curve', points: [[90, 40], [200, 10], [300, 60]], stroke: 'teal', width: 1.5, dashed: false },
  { kind: 'text', x: 210, y: 290, text: '$a^2 + b^2 = c^2$', size: 15 },
  { kind: 'line', x1: 10, y1: 20, x2: 110, y2: 60, label: 'L' },
  { kind: 'tick', x1: 5, y1: 5, x2: 5, y2: 15 },
  { kind: 'polyline', points: [[0, 0], [30, 10], [60, 0], [5]], label: 'p' },
  { kind: 'rect', x: 20, y: 30, w: -40, h: 25, r: 6, fill: 'amber', label: 'R' },
  { kind: 'rect', x: 1, y: 2, w: 3, h: 4 },
  { kind: 'circle', cx: 100, cy: 100, r: 30, fill: 'green', opacity: 0.3, label: 'C', dashed: true },
  { kind: 'ellipse', x: 50, y: 60, rx: 20, ry: 10, label: 'E' },
  { kind: 'arc', cx: 0, cy: 0, r: 10, start: -30, end: 400, label: 'a' },
  { kind: 'angle', cx: 5, cy: 5 },
  { kind: 'rightAngle', x: 3, y: 4 },
  { kind: 'dot', x: 1, y: 1, stroke: 'red', label: 'D' },
  { kind: 'text', x: 1, y: 1, label: 'only label', anchor: 'right' }
]

/** Lo que dibujaba cada uno antes de pasar la geometría al motor (caminos, puntas y etiquetas, byte a byte). */
export const LEGACY_EXPECTED: Array<Pick<DrawShape, 'paths' | 'heads' | 'labels'>> = [
  {"paths": [{"stroke": "ink", "width": 2, "dashed": false, "d": "M70 240L330 240L70 70Z", "fill": {"color": "blue", "opacity": 0.1}}], "heads": [], "labels": []},
  {"paths": [{"stroke": "ink", "width": 1.5, "dashed": false, "d": "M86 240L86 224L70 224"}], "heads": [], "labels": []},
  {"paths": [{"stroke": "accent", "width": 1.5, "dashed": false, "d": "M330 240L294.78 217.13A42 42 0 0 0 288 240Z", "fill": {"color": "accent", "opacity": 0.18}}], "heads": [], "labels": [{"x": 276.3060948473812, "y": 224.09514069658033, "text": "$\\alpha$", "size": 13, "anchor": "center"}]},
  {"paths": [], "heads": [], "labels": [{"x": 200, "y": 262, "text": "$b$", "size": 17, "anchor": "center"}]},
  {"paths": [], "heads": [], "labels": [{"x": 50, "y": 155, "text": "$a$", "size": 17, "anchor": "center"}]},
  {"paths": [], "heads": [], "labels": [{"x": 214, "y": 140, "text": "$c$", "size": 17, "anchor": "center"}]},
  {"paths": [{"stroke": "gray", "width": 1.5, "dashed": true, "d": "M340 80L220 150"}], "heads": [{"d": "M220 150L226.89 140.79L231.41 148.53Z", "color": "gray"}], "labels": []},
  {"paths": [], "heads": [], "labels": [{"x": 345, "y": 70, "text": "hipotenusa", "size": 13, "anchor": "left", "color": "gray"}]},
  {"paths": [{"d": "M66 70A4 4 0 1 0 74 70A4 4 0 1 0 66 70Z", "width": 0, "dashed": false, "fill": {"color": "accent", "opacity": 1}, "fillOnly": true}], "heads": [], "labels": []},
  {"paths": [{"stroke": "teal", "width": 1.5, "dashed": false, "d": "M90 40Q200 10 300 60"}], "heads": [], "labels": []},
  {"paths": [], "heads": [], "labels": [{"x": 210, "y": 290, "text": "$a^2 + b^2 = c^2$", "size": 15, "anchor": "center"}]},
  {"paths": [{"width": 2, "dashed": false, "d": "M10 20L110 60"}], "heads": [], "labels": [{"x": 60, "y": 28, "text": "L", "size": 13, "anchor": "center"}]},
  {"paths": [{"width": 2, "dashed": false, "d": "M5 5L5 15"}], "heads": [], "labels": []},
  {"paths": [{"width": 2, "dashed": false, "d": "M0 0L30 10L60 0"}], "heads": [], "labels": [{"x": 30, "y": 3.3333333333333335, "text": "p", "size": 13, "anchor": "center"}]},
  {"paths": [{"width": 2, "dashed": false, "d": "M-14 30H14A6 6 0 0 1 20 36V49A6 6 0 0 1 14 55H-14A6 6 0 0 1 -20 49V36A6 6 0 0 1 -14 30Z", "fill": {"color": "amber", "opacity": 0.22}}], "heads": [], "labels": [{"x": 0, "y": 42.5, "text": "R", "size": 13, "anchor": "center"}]},
  {"paths": [{"width": 2, "dashed": false, "d": "M1 2H4V6H1Z"}], "heads": [], "labels": []},
  {"paths": [{"width": 2, "dashed": true, "d": "M70 100A30 30 0 1 0 130 100A30 30 0 1 0 70 100Z", "fill": {"color": "green", "opacity": 0.3}}], "heads": [], "labels": [{"x": 100, "y": 100, "text": "C", "size": 13, "anchor": "center"}]},
  {"paths": [{"width": 2, "dashed": false, "d": "M30 60A20 10 0 1 0 70 60A20 10 0 1 0 30 60Z"}], "heads": [], "labels": [{"x": 50, "y": 60, "text": "E", "size": 13, "anchor": "center"}]},
  {"paths": [{"width": 2, "dashed": false, "d": "M8.66 5A10 10 0 1 0 8.66 5"}], "heads": [], "labels": [{"x": -23.908672754201895, "y": 2.091737825943791, "text": "a", "size": 13, "anchor": "center"}]},
  {"paths": [{"width": 2, "dashed": false, "d": "M5 5L29 5A24 24 0 0 0 5 -19Z", "fill": {"color": "accent", "opacity": 0.18}}], "heads": [], "labels": []},
  {"paths": [{"width": 2, "dashed": false, "d": "M15 4L15 -8L3 -8"}], "heads": [], "labels": []},
  {"paths": [{"d": "M-3 1A4 4 0 1 0 5 1A4 4 0 1 0 -3 1Z", "stroke": "red", "width": 0, "dashed": false, "fill": {"color": "red", "opacity": 1}, "fillOnly": true}], "heads": [], "labels": [{"x": 1, "y": -13, "text": "D", "size": 13, "anchor": "center"}]},
  {"paths": [], "heads": [], "labels": [{"x": 1, "y": 1, "text": "only label", "size": 14, "anchor": "right"}]}
]
