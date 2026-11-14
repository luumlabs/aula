// Adaptado de Sketchy (https://github.com/ddkbs/sketchy), MIT © 2026 ddkbs: skill/SKILL.md (las reglas de los pasos y del
// movimiento, parafraseadas y pasadas al JSON de Aula).
// Referencia detallada del bloque `drawing` para la herramienta `block_reference` (la guía básica solo lleva la línea corta).
import { OBJECT_NAMES } from '@engine/drawing/objects'

export const DRAWING_REFERENCE = String.raw`# drawing — free vector drawing that can move and build up step by step
{"type":"drawing","width":400,"height":300,"title":"…","caption":"…","style":"clean|hand",
 "items":[…],
 "params":[{"name":"v","label":"Velocidad","min":0,"max":10,"step":0.5,"value":0,"unit":"m/s"}],   (≤ 6 sliders, like simulation params)
 "time":{"name":"t","min":"0","max":"4","speed":1,"loop":true,"autoplay":false},   (optional clock)
 "steps":[{"title":"…","md":"one or two sentences","show":1,"params":{"v":5},"highlight":["car"]}]}
Canvas: origin top-left, y grows DOWN. Angles in degrees, counter-clockwise, 0° = right. "style":"hand" draws every shape hand-drawn (geometry marks stay exact; objects are always hand-drawn).

Items (every item also takes "id", "name" (how the student calls it: "normal force"), "label", "stroke", "fill", "opacity", "width", "dashed", "stage", "motion"):
- line/arrow {x1,y1,x2,y2} · polyline/polygon {"points":[[x,y],…], "smooth":true = curve/blob through the points} · rect {x,y,w,h,r} · circle/dot {cx,cy,r} · ellipse {cx,cy,rx,ry} · arc {cx,cy,r,start,end} · text {x,y,text,size,anchor}
- angle {"points":[[ax,ay],[vx,vy],[bx,by]],"r":22,"label":"$\\alpha$"}: vertex in the middle, always the smaller angle, exactly 90° draws the little square (rightAngle with the same points always does). Prefer it to cx/cy/start/end.
- measure {x1,y1,x2,y2,"offset":14,"label":"4 cm"}: dimension line with arrows at both ends, moved "offset" to the right of the way 1→2 (below a segment drawn left to right), with thin extension lines.
- brace {x1,y1,x2,y2,"depth":10,"label":"h"}: curly brace bulging to the right of the way 1→2.
- axes {"x","y" (the origin),"w","h","step":20,"xLabel":"t (s)","yLabel":"v","full":false}: arrows right and up, ticks every step; full = also the negative halves.
- grid {"x","y" (top-left),"w","h","step":20}: always painted behind everything.
- object {"object":"car","x","y" (its centre),"w":60 (its size),"rotate":0 (degrees, counter-clockwise),"flip":false,"fill":"blue" (recolours its main colour),"label":"Coche"}.
  Objects: ${OBJECT_NAMES.join(', ')}. ground/wall are short hatched pieces; for a long floor use a hatched rect.
- "fillStyle":"hatch" with a "fill" colour = hatched (ground, walls, cut sections); "fill":"paper" hides what is behind.
- Labels: put "label" on the item. Labels of measure, brace and object, and any label with "anchor":"auto", are placed clear of the lines (with a leader line when far away); a separate text is only for free notes.
Colours: ink, gray, accent (the course colour, 1–2 items), blue, teal, green, olive, amber, terracotta, brown, rose, paper.
A saved course also writes what older Aula versions can draw: an object as {"kind":"text","object":"car",…}, a paper fill as "fillStyle":"paper", a three-point angle with cx/cy/start/end as well (the points rule). Either form means the same; keep "object" and the points.

Motion — write every item at REST: that is what print, flashcards and labeled figures show; motion only moves it.
"motion":{"dx":"40*v","dy":"0"}                         rigid shift (canvas units)
"motion":{"turn":"theta","pivot":[180,40]}               degrees, counter-clockwise, around pivot (default: the item's centre)
"motion":{"along":"orbit","at":"t/4","orient":true}      the item's centre rides on the outline of the item with id "orbit" (line, arrow, polyline, polygon, rect, circle, ellipse, arc or curve; a circle starts at its right and goes counter-clockwise; closed outlines wrap around: 1.25 = 0.25); orient = turn with the path
Expressions: calculator syntax with the slider names, the clock name, pi and e (names: letters/digits, not x, e or pi). Trigonometry is in RADIANS: write sin(rad(theta)) for degrees. At rest dx, dy and turn should be 0 and "at" the item's own place on the path.
Rules: one moving idea per drawing; "autoplay" only for continuous motion (orbits, waves, gears); a slider for what the student should explore. Motion is rigid: a side that grows or an angle that opens is a simulation, or several steps.

Steps — a picture that builds up (a construction, forces added one by one, a cycle, a proof):
- items carry "stage" (0 = from the start); a step shows the items with stage ≤ "show" (what earlier steps set carries over). Start with "show":1 (or 0).
- "params" in a step glide the sliders there in half a second: move things all the way, never stop a motion halfway.
- "highlight":["id"] circles those items in brick ink and dims the rest (at most 2 per step).
- 3–7 steps of one or two sentences, one idea each; every step ends in a clear picture. The whole picture (no step) is shown first and in print.

Examples
- Atom whose electrons orbit (clock, looping): {"type":"drawing","width":360,"height":300,"title":"Átomo de helio","time":{"name":"t","min":"0","max":"4","loop":true,"autoplay":true},"items":[{"kind":"circle","id":"orbit","cx":180,"cy":150,"r":110,"dashed":true,"stroke":"gray"},{"kind":"circle","id":"core","name":"Núcleo","cx":180,"cy":150,"r":20,"fill":"accent","opacity":0.35,"label":"Núcleo","anchor":"auto"},{"kind":"dot","id":"e1","name":"Electrón","cx":290,"cy":150,"r":7,"fill":"blue","motion":{"along":"orbit","at":"t/4"}},{"kind":"dot","id":"e2","name":"Electrón","cx":70,"cy":150,"r":7,"fill":"blue","motion":{"along":"orbit","at":"t/4+0.5"}}]}
- A car driven by a slider on a hatched road: {"type":"drawing","width":440,"height":220,"params":[{"name":"s","label":"Posición","min":0,"max":280,"step":1,"value":0,"unit":"m"}],"items":[{"kind":"rect","x":0,"y":176,"w":440,"h":16,"fill":"gray","fillStyle":"hatch","width":0},{"kind":"line","x1":0,"y1":176,"x2":440,"y2":176,"width":2},{"kind":"object","id":"car","name":"Coche","object":"car","x":70,"y":150,"w":90,"label":"Coche","motion":{"dx":"s"}},{"kind":"arrow","id":"v","name":"Velocidad","x1":120,"y1":110,"x2":175,"y2":110,"stroke":"accent","label":"$\\vec v$","motion":{"dx":"s"}}]}
- A pendulum (slider turns rope and bob around the pivot): {"type":"drawing","width":360,"height":300,"params":[{"name":"theta","label":"Ángulo","min":-40,"max":40,"step":1,"value":0,"unit":"°"}],"items":[{"kind":"rect","x":120,"y":28,"w":120,"h":12,"fill":"gray","fillStyle":"hatch","width":0},{"kind":"line","x1":120,"y1":40,"x2":240,"y2":40,"width":2.5},{"kind":"line","x1":180,"y1":40,"x2":180,"y2":250,"dashed":true,"stroke":"gray"},{"kind":"line","id":"rope","name":"Hilo","x1":180,"y1":40,"x2":180,"y2":220,"motion":{"turn":"theta","pivot":[180,40]}},{"kind":"circle","id":"bob","name":"Masa","cx":180,"cy":232,"r":12,"fill":"accent","opacity":0.4,"label":"m","anchor":"auto","motion":{"turn":"theta","pivot":[180,40]}}]}
- Inscribed angle, built in 4 steps: {"type":"drawing","width":400,"height":320,"title":"Ángulo inscrito","items":[{"kind":"circle","cx":200,"cy":160,"r":110,"stroke":"gray"},{"kind":"dot","id":"A","cx":104.7,"cy":215,"label":"A","anchor":"auto"},{"kind":"dot","id":"B","cx":295.3,"cy":215,"label":"B","anchor":"auto"},{"kind":"dot","id":"P","cx":180.9,"cy":51.7,"label":"P","anchor":"auto","stage":1},{"kind":"polyline","points":[[104.7,215],[180.9,51.7],[295.3,215]],"stage":1},{"kind":"angle","id":"inscrito","name":"ángulo inscrito","points":[[104.7,215],[180.9,51.7],[295.3,215]],"r":30,"label":"$\\alpha$","stage":1},{"kind":"dot","id":"O","cx":200,"cy":160,"label":"O","anchor":"auto","stage":2},{"kind":"polyline","points":[[104.7,215],[200,160],[295.3,215]],"stroke":"accent","stage":2},{"kind":"angle","id":"central","name":"ángulo central","points":[[104.7,215],[200,160],[295.3,215]],"r":26,"label":"$2\\alpha$","stroke":"accent","stage":2}],"steps":[{"title":"El arco","md":"Fijamos el arco $AB$.","show":0},{"title":"Ángulo inscrito","md":"Desde $P$, sobre la circunferencia, se ve $AB$ con un ángulo $\\alpha$.","show":1,"highlight":["inscrito"]},{"title":"Ángulo central","md":"Desde el centro $O$ se ve con el ángulo central.","show":2,"highlight":["central"]},{"title":"La relación","md":"El central es el doble del inscrito: $2\\alpha$.","highlight":["inscrito","central"]}]}`
