// Catálogo de bloques visuales para el chat y el tutor (sección 5 de la guía de autoría de la app Swift, `AuthoringGuide.text`,
// sin la parte larga de los visuales interactivos, que va resumida en `VISUAL_BLOCKS_BRIEF`). Texto en inglés: lo lee el modelo.

export const BLOCK_CATALOG = `## 5. Block catalog (JSON; \`id\` optional)
- \`{"type":"text","md":"…"}\`
- \`{"type":"math","tex":"\\\\frac{a}{b}","label":"Name","note":"optional md"}\`
- \`{"type":"callout","kind":"note|tip|warning|definition|theorem|remember|example|examTip|mistake|question|source","title":"optional","md":"…"}\`
- \`{"type":"example","title":"…","problem":"md","steps":[{"md":"step","note":"why"},…],"answer":"md"}\`
- \`{"type":"plot","title":"…","xMin":-6,"xMax":6,"yMin":-4,"yMax":4,"xPi":false,"equalAspect":false,"curves":[{"expr":"x^2-4","label":"f","color":"accent","dashed":false,"domainMin":-3,"domainMax":3}],"points":[{"x":"0","y":"-4","label":"(0,-4)","style":"filled|open|cross"}],"lines":[{"kind":"vertical|horizontal|segment|ray|line","x":"2","y":"0","x1":"0","y1":"0","x2":"1","y2":"1","label":"x=2","dashed":true}],"regions":[{"upper":"x^2","lower":"0","from":"0","to":"2"}],"parametric":[{"x":"cos(t)","y":"sin(t)","tMin":0,"tMax":6.283}],"polar":[{"r":"1+cos(theta)"}],"labels":[{"x":"1","y":"1","tex":"A"}],"caption":"…"}\`; colors: accent, blue, red, green, orange, purple, pink, teal, gray, ink, or \`#RRGGBB\`. Set \`"xPi":true\` for trigonometric graphs (ticks at multiples of π). Points/lines accept expressions as strings (\`"pi/2"\`, \`"sqrt(3)/2"\`).
- \`{"type":"explore","title":"…","plot":{…plot fields…},"params":[{"name":"a","label":"Amplitude","min":-3,"max":3,"step":0.5,"value":1}],"prompts":["guiding question…"]}\` — an interactive plot: curves use the parameter letters (single letters, not \`x\`). Use it to let the student *discover* a rule.
- \`{"type":"table","headers":["A","B"],"rows":[["a1","b1"]],"align":["left","center"],"caption":"…"}\` (cells may contain \`$math$\`)
- \`{"type":"chart","kind":"bar|line|area|pie|scatter|histogram","title":"…","xLabel":"…","yLabel":"…","unit":"%","series":[{"name":"S","points":[{"label":"A","y":3},{"x":1,"y":2}]}]}\`
- \`{"type":"numberline","min":-5,"max":5,"step":1,"pi":false,"points":[{"value":"-2","label":"a","open":true}],"intervals":[{"from":"-2","to":"3","fromOpen":true,"toOpen":false,"label":"[…]"}]}\` (\`from\`/\`to\` null = infinity)
- \`{"type":"diagram","kind":"flow|concept|tree|cycle|layers","direction":"tb|lr","title":"…","nodes":[{"id":"a","label":"Short label","shape":"box|round|diamond|circle","color":"blue","detail":"optional small text"}],"edges":[{"from":"a","to":"b","label":"optional","dashed":false}],"steps":[{"title":"…","md":"what happens","nodes":["a"],"edges":[["a","b"]]}]}\` — ≤ 12 nodes, short labels. For \`cycle\`, edges may be omitted (nodes are linked in order). Add \`steps\` to make it an **animated process** (Krebs cycle, mitosis, cardiac cycle, a protocol): each step highlights its nodes and explains them.
- \`{"type":"drawing","width":400,"height":300,"title":"…","caption":"…","items":[…]}\` — free vector drawing (origin top-left, y grows down). Items: \`{"kind":"line|arrow","x1":..,"y1":..,"x2":..,"y2":..,"stroke":"accent","width":2,"dashed":false,"label":"…"}\`, \`{"kind":"polyline|polygon","points":[[x,y],…],"fill":"accent","opacity":0.2,"stroke":"ink"}\`, \`{"kind":"rect","x","y","w","h","r":corner,"fill","label"}\`, \`{"kind":"circle|dot","cx","cy","r","fill","label"}\`, \`{"kind":"ellipse","cx","cy","rx","ry"}\`, \`{"kind":"arc|angle","cx","cy","r","start":0,"end":90,"label":"$\\\\theta$"}\` (degrees, counter-clockwise), \`{"kind":"rightAngle","cx","cy","r"}\`, \`{"kind":"curve","points":[[x0,y0],[cx,cy],[x1,y1]]}\` (quadratic), \`{"kind":"text","x","y","text":"…$\\\\theta$…","size":14,"anchor":"center|left|right"}\`. Use for geometry, physics free-body diagrams, simple anatomy/cell sketches, circuits. Keep coordinates inside the canvas.
- \`{"type":"timeline","title":"…","periods":[{"from":"1789","to":"1799","title":"Revolución","color":"red"}],"events":[{"when":"1789-07-14","title":"…","md":"optional","category":"Política","end":"optional"}]}\` — drawn **to scale** when dates are years ("1789", "44 a. C.", "1914–1918", "siglo XV", "65 Ma"); categories get colours.
- \`{"type":"image","asset":"file-id","source":{"source":"<id>","page":3},"alt":"description","caption":"…","hotspots":[{"x":0.4,"y":0.3,"label":"núcleo"}]}\` — \`asset\` comes from \`add_image\` (freely licensed pictures found with \`find_image\`; credit author + license in \`caption\`) or use \`source\`+\`page\` to show a page of the student's material. Hotspot x,y are fractions 0–1 of the width/height.
- \`{"type":"steps","title":"Procedure","steps":[{"title":"…","md":"…"}]}\`
- \`{"type":"compare","title":"…","leftTitle":"A","rightTitle":"B","rows":[{"label":"…","left":"md","right":"md"}]}\`
- \`{"type":"formulas","title":"…","items":[{"name":"…","tex":"…","when":"md","vars":[{"symbol":"v_0","meaning":"initial velocity","unit":"m/s"}]}]}\`
- \`{"type":"predict","question":"md","options":[{"md":"…","correct":true,"why":"…"},…],"explanation":"md"}\` (exactly one correct)
- \`{"type":"spot","intro":"md","lines":["md line 1","md line 2","md line 3","md line 4"],"wrongIndex":2,"explanation":"md"}\` (\`wrongIndex\` starts at 0)
- \`{"type":"tryit","title":"Try it","exerciseIDs":["skill-e1","skill-e2"]}\`
- \`{"type":"recap","title":"optional","points":["md","md"]}\`
- \`{"type":"code","language":"python","code":"…","output":"…","caption":"…"}\`
- \`{"type":"quote","md":"…","source":{"source":"id","page":12},"author":"optional"}\`
- Credits: every picture or model from the web carries its author and license (\`credit\`); \`add_image\` fills it for Wikimedia Commons.
`

export const VISUAL_BLOCKS_BRIEF = `Interactive visuals you can include as ONE aula-block JSON (rendered natively, offline):
- \`labeled\`: an image of the course (asset id) or a vector \`drawing\` with parts [{id,name,x,y (fractions 0–1),r,detail}] and optional layers — anatomy, cells, maps, machines. The student explores and practises «point at the part».
- \`model3d\`: {"formula":"H2O","lonePairs":true} (VSEPR shapes, benzene, ethanol, NaCl…), {"atoms":[…],"bonds":[…]} or {"solids":[{"shape":"cylinder","r":1,"h":3,"dims":true}]}.
- \`simulation\`: {"preset":"projectile|pendulum|spring|wave|rc|supply-demand|population|decay|pharmacokinetics|enzyme"} (sliders + live values + animation).
- \`map\`: {"markers":[{"lat":…,"lon":…,"title":"…"}],"routes":[…],"regions":[…]}; \`timeline\` with dates as years and \`periods\`; \`diagram\` with \`steps\` (animated process: Krebs cycle, mitosis).
Only use images that already exist in the course (asset ids); never web URLs.
`
