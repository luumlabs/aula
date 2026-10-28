// Catálogo de los iconos de curso (pixel-art de 16×16), port de StudyModel/CourseIconCatalog.swift.
//
// `Pack.icon` guarda uno de estos identificadores ("chemistry", "spanish"…). Los cursos anteriores guardaban el nombre de un
// SF Symbol ("function", "flask", "book.closed"…): al leer un curso, `resolve` lo traduce al icono más cercano, con la ayuda
// de la asignatura y el título. La IA elige de la misma lista (`promptList`).
import { foldDiacritics } from '@engine/base/ids'

export const ICON_CATEGORIES = ['general', 'math', 'science', 'health', 'humanities', 'languages', 'society', 'technology', 'arts'] as const
export type IconCategory = (typeof ICON_CATEGORIES)[number]

export interface CourseIconEntry {
  /** Identificador estable (lo que se guarda en `Pack.icon` y lo que escribe la IA). */
  id: string
  category: IconCategory
  /** Tono sugerido (0…1) para un curso nuevo con este icono. */
  hue: number
  /** Palabras (sin tildes, en minúsculas): prefijo de palabra, frase con espacios o palabra exacta con `=`. */
  keywords: string[]
  /** Nombres de SF Symbols que usaban los cursos anteriores para esta asignatura. */
  legacy: string[]
  /** Asignatura genérica (examen, cuaderno…): solo gana si nada más concreto encaja. */
  generic: boolean
}

// Tonos curados (`COURSE_TONE_HUES`; ninguno violeta: navy es tinta azul noche y wine, vino).
const coral = 0.03, amber = 0.09, sand = 0.13, olive = 0.2, sage = 0.38, teal = 0.5, slate = 0.6, navy = 0.68, wine = 0.8, rose = 0.93

const E = (id: string, category: IconCategory, hue: number, keywords: string[], legacy: string[] = [], generic = false): CourseIconEntry =>
  ({ id, category, hue, keywords, legacy, generic })

/** Todos los iconos, en el orden en que se buscan las palabras clave (lo concreto antes que lo general). */
const ALL: CourseIconEntry[] = [
  // exámenes con nombre propio (antes que las asignaturas)
  E('language-exam', 'general', rose, ['toefl', 'ielts', 'toeic', 'cambridge', 'first certificate', '=dele', '=delf', '=dalf', 'goethe', 'linguaskill', 'aptis', '=eoi',
    'examen de idiomas', 'language exam', 'language test', 'certificado de idiomas', 'certificacion de idiomas', 'examen de ingles', 'examen de frances', 'examen de aleman',
    'examen de italiano', 'examen de portugues', 'examen de chino', 'english exam', 'english test', 'prueba de ingles', 'speaking test', 'oral exam'], ['checkmark.bubble']),
  E('driving', 'general', amber, ['conducir', 'autoescuela', 'dgt', 'driving', 'driver', 'carnet de', 'permiso de conducir', 'licencia de conducir', 'seguridad vial', 'manejo', 'trafico'],
    ['car', 'car.fill', 'steeringwheel', 'car.side']),
  E('civil-service', 'general', slate, ['oposicion', 'civil service', 'funcionari', 'concurso publico', 'auxiliar administrativo', 'guardia civil', 'policia nacional', 'bombero',
    'examen oficial', 'official exam'], ['building.2', 'seal', 'checkmark.seal']),
  // deporte y arte con palabras que chocan con otras asignaturas
  E('sports', 'arts', sage, ['educacion fisica', 'physical education', '=pe', 'deporte', 'sport', 'entrenamiento', 'fitness', 'gimnasia', 'futbol', 'football', 'soccer', 'baloncesto', 'basket', 'atletismo'],
    ['sportscourt', 'figure.run', 'soccerball', 'basketball', 'dumbbell', 'figure.walk', 'tennisball']),
  // matemáticas (lo concreto antes que «matemáticas»)
  E('trigonometry', 'math', slate, ['trigonometr', 'trigonometry', 'circulo unidad', 'unit circle', '=trig'], ['triangle', 'angle']),
  E('calculus', 'math', amber, ['calculo', 'calculus', 'precalc', 'derivad', 'derivative', 'integral', 'limites', 'analisis matematico', 'ecuaciones diferenciales', 'differential'], ['sum', 'integral']),
  E('statistics', 'math', teal, ['estadistic', 'statistic', 'probabilid', 'probabilit', 'ciencia de datos', 'data science', 'bioestadist', 'econometr'],
    ['chart.bar', 'chart.bar.fill', 'chart.pie', 'chart.bar.xaxis', 'chart.xyaxis.line']),
  E('geometry', 'math', navy, ['geometr', 'dibujo tecnico', 'technical drawing'], ['pencil.and.ruler', 'ruler', 'compass.drawing', 'square.on.circle', 'cube']),
  E('algebra', 'math', sage, ['algebra', 'ecuacion', 'equation', 'polinom', 'polynomial', 'matrices', 'matriz', 'funciones', 'functions'], ['x.squareroot', 'function']),
  E('math', 'math', slate, ['matemat', 'math', '=mates', '=maths', 'aritmet', 'arithmetic', 'numeros', 'numbers', 'fracciones', 'fractions', 'logica matematica'],
    ['plus.forwardslash.minus', 'divide', 'percent', 'number', 'numbersign', 'plus.minus']),
  E('art', 'arts', wine, ['historia del arte', 'art history', '=arte', '=artes', '=art', '=arts', 'bellas artes', '=dibujo', 'dibujo artistico', 'drawing', 'pintura', 'painting', 'plastica', 'escultur', 'diseno grafico', 'graphic design', 'diseno de moda', 'fashion', 'ilustracion'],
    ['paintpalette', 'paintbrush', 'paintbrush.pointed', 'pencil.and.outline', 'scribble']),
  // ciencias
  E('physics', 'science', navy, ['fisica', 'physics', 'physik', 'physique', 'mecanica', 'mechanics', 'electromagnet', 'termodinam', 'thermodynam', 'optica', 'cuantica', 'quantum', '=phys'],
    ['atom', 'magnet', 'waveform']),
  E('chemistry', 'science', sage, ['quimic', 'chemis', 'chimie', 'chimica', 'chemie', 'bioquimic', 'biochem', 'laboratorio', '=chem', '=ciencias', '=science', '=sciences'],
    ['flask', 'flask.fill', 'testtube.2', 'drop', 'drop.fill']),
  E('anatomy', 'health', rose, ['anatom', 'fisiolog', 'physiolog', 'cardiolog', 'corazon', 'cuerpo humano', 'human body'], ['heart', 'heart.fill', 'waveform.path.ecg', 'lungs', 'figure.stand']),
  E('pharmacy', 'health', coral, ['farmac', 'pharma', 'medicament', 'drug'], ['pills', 'pills.fill', 'pill', 'capsule']),
  E('nutrition', 'health', olive, ['nutric', 'nutrition', 'dietet', 'dieta', 'aliment', 'cocina', 'cooking', 'culinar', 'gastronom'], ['fork.knife', 'carrot', 'apple.logo']),
  E('veterinary', 'health', sand, ['veterinar', 'veterinary', 'zootecn', 'animales'], ['pawprint', 'pawprint.fill', 'hare', 'tortoise', 'bird', 'fish']),
  E('medicine', 'health', coral, ['medicin', 'medical', 'enfermer', 'nursing', 'salud', 'health', 'clinic', 'patolog', 'cirug', 'surgery', 'primeros auxilios', 'first aid', '=mir', '=eir', 'odontolog', 'fisioterap'],
    ['cross.case', 'cross.case.fill', 'cross', 'stethoscope', 'bandage', 'syringe', 'medical.thermometer', 'staroflife']),
  E('biology', 'science', rose, ['biolog', 'genetic', 'genetica', 'celul', 'cell biology', 'microbio', 'zoolog', 'evoluc', 'evolution', 'biotecn', 'biotech', 'ciencias naturales', 'natural science', '=bio'],
    ['leaf', 'leaf.fill', 'allergens', 'microbe', 'ladybug', 'camera.macro', 'dna']),
  E('astronomy', 'science', navy, ['astronom', 'astrofis', 'astrophys', 'cosmolog', 'espacio exterior', 'outer space', 'planeta', 'planet'],
    ['moon.stars', 'moon', 'sparkle', 'telescope', 'globe.americas.fill']),
  E('earth', 'science', amber, ['geolog', 'ciencias de la tierra', 'earth science', 'volcan', 'sismolog', 'meteorolog', 'climatolog', 'oceanograf', 'mineral'],
    ['mountain.2', 'mountain.2.fill', 'cloud.sun', 'tornado', 'flame']),
  E('ecology', 'science', olive, ['ecolog', 'medio ambiente', 'environment', 'medioambient', 'sostenib', 'sustainab', 'agricult', 'agronom', 'botanic', 'botany', 'forestal', 'jardin', 'plantas'],
    ['tree', 'tree.fill', 'camera.macro.circle', 'laurel.leading', 'sprout']),
  E('geography', 'science', teal, ['geograf', 'geograph', 'cartograf', 'turismo', 'tourism', 'paises', 'countries'],
    ['globe', 'globe.europe.africa', 'globe.americas', 'globe.asia.australia', 'map', 'map.fill', 'mappin.and.ellipse', 'location']),
  // humanidades
  E('psychology', 'humanities', rose, ['psicolog', 'psycholog', 'psychologie', 'neurocien', 'neurosci', 'neuropsic', 'pedagog', 'educacion infantil', 'mente', 'mind'],
    ['brain', 'brain.head.profile', 'brain.filled.head.profile']),
  E('philosophy', 'humanities', sand, ['filosof', 'philosoph', '=etica', '=ethics', 'logica', '=logic', 'pensamiento', 'metafisic', 'epistemolog'], ['questionmark.bubble', 'lightbulb.max']),
  E('sociology', 'humanities', amber, ['sociolog', 'antropolog', 'anthropolog', 'trabajo social', 'social work', 'ciencias sociales', 'social science', 'demograf'],
    ['person.2', 'person.3', 'person.3.fill', 'person.2.fill', 'figure.2']),
  E('religion', 'humanities', amber, ['religi', 'teolog', 'theolog', 'biblia', 'bible', 'catequesis', 'espiritual', 'spiritual'], ['candle', 'flame.fill', 'hands.sparkles']),
  E('history', 'humanities', sand, ['histori', 'history', 'geschichte', 'storia', 'histoire', 'civilizac', 'civilization', 'prehistori', 'antiguedad', 'edad media'],
    ['building.columns', 'building.columns.fill', 'scroll', 'hourglass', 'crown']),
  // idiomas (cada uno antes que «lengua» y «literatura»)
  E('english', 'languages', slate, ['ingles', 'english', 'anglais', 'englisch', 'inglese']),
  E('spanish', 'languages', coral, ['espanol', 'castellan', 'spanish', 'espagnol', 'spanisch', 'spagnolo', '=ele']),
  E('french', 'languages', navy, ['frances', 'french', 'francais', 'franzosisch', 'francese']),
  E('german', 'languages', amber, ['aleman', 'german', 'deutsch', 'allemand', 'tedesco']),
  E('italian', 'languages', sage, ['italian', 'italien', 'italienisch']),
  E('portuguese', 'languages', olive, ['portugu', 'portugies']),
  E('chinese', 'languages', coral, ['chino', 'chinese', 'mandarin', 'chinois', 'chinesisch', 'cinese']),
  E('languages', 'languages', teal, ['idioma', 'lengua extranjera', 'lenguas extranjeras', 'foreign language', 'language', '=lang', 'traduccion', 'translation', 'japones', 'japanese',
    'coreano', 'korean', 'ruso', 'russian', 'arabe', 'arabic', 'hindi', 'latin', 'griego', 'greek', 'catalan', 'euskera', 'gallego', 'valenciano'],
    ['character.book.closed', 'character.bubble', 'bubble.left.and.bubble.right', 'text.bubble', 'translate', 'character', 'textformat.abc']),
  E('grammar', 'languages', coral, ['lengua', 'gramatic', 'grammar', 'ortografi', 'spelling', 'redaccion', 'escritura', 'writing', 'linguistic', 'lenguaje', 'comentario de texto'],
    ['textformat', 'character.cursor.ibeam', 'a.magnify', 'text.cursor']),
  E('literature', 'humanities', wine, ['literat', 'poesia', 'poetry', 'novela', 'novel', 'lectura', 'reading', '=letras', 'teatro', 'theatre', 'theater', 'clasicos'],
    ['book', 'book.fill', 'books.vertical', 'text.book.closed', 'book.pages', 'theatermasks', 'quote.bubble']),
  // sociedad y empresa
  E('accounting', 'society', teal, ['contab', 'accounting', 'auditor', 'fiscal', 'impuest', '=tax', 'taxes', 'nomina'], ['plusminus.circle', 'list.number', 'tablecells']),
  E('economics', 'society', amber, ['econom', 'financ', 'finanzas', 'bolsa', 'macroecon', 'microecon', 'inversion', 'invest', 'banca', 'banking'],
    ['chart.line.uptrend.xyaxis', 'dollarsign.circle', 'eurosign.circle', 'banknote', 'creditcard', 'bitcoinsign.circle', 'chart.line.uptrend.xyaxis.circle']),
  E('marketing', 'society', coral, ['marketing', 'mercadotec', 'publicidad', 'advertising', '=ventas', 'sales', 'relaciones publicas'], ['megaphone', 'megaphone.fill', 'speaker.wave.3']),
  E('journalism', 'society', sand, ['periodis', 'journalis', 'comunicacion', 'communication', 'medios de', 'media studies', 'prensa'], ['newspaper', 'newspaper.fill', 'mic']),
  E('business', 'society', sand, ['empresa', 'business', 'administracion', 'gestion', 'management', 'emprend', 'entrepreneur', 'negocio', 'recursos humanos', 'logistic', 'comercio', 'commerce', '=mba', '=ade'],
    ['briefcase', 'briefcase.fill', 'building.2.fill', 'cart']),
  E('law', 'society', wine, ['derecho', '=law', 'legal', 'juridic', 'jurisprud', 'constitucion', 'constitution', 'penal', 'abogac', 'lawyer', '=ley', '=leyes'],
    ['scale.3d', 'hammer.fill', 'building.columns.circle']),
  E('politics', 'society', slate, ['politic', 'gobierno', 'government', 'relaciones internacionales', 'international relations', 'ciudadania', 'citizenship', 'civics', 'civica', 'elecciones'],
    ['flag', 'flag.fill', 'envelope.badge', 'person.crop.square.filled.and.at.rectangle']),
  // tecnología
  E('robotics', 'technology', teal, ['robot', 'mecatron', 'mechatron', 'automatiz', 'automation', 'inteligencia artificial', 'artificial intelligence', 'machine learning', '=ia', '=ai'],
    ['cpu.fill', 'brain.filled.head.profile.circle']),
  E('programming', 'technology', navy, ['program', 'informat', 'computer', 'computac', 'computing', 'software', 'codigo', 'coding', '=code', 'algoritm', 'algorithm', 'python', 'java', 'swift', '=web',
    'bases de datos', 'database', '=sql', 'ciberseg', 'cybersec', 'redes de', 'networks', '=tic', '=cs', 'estructuras de datos', 'data structures', 'tecnologias de la informacion', 'information technology', 'desarrollo de aplicaciones', '=daw', '=dam', '=asir', '=smr'],
    ['chevron.left.forwardslash.chevron.right', 'terminal', 'laptopcomputer', 'desktopcomputer', 'cpu', 'keyboard', 'server.rack', 'curlybraces']),
  E('electricity', 'technology', amber, ['electric', 'electron', 'circuit', 'electrotecn', 'energia', 'energy'], ['bolt', 'bolt.fill', 'powerplug', 'battery.100']),
  E('architecture', 'technology', coral, ['arquitect', 'architect', 'urbanis', 'urban planning', 'interiorismo', 'construccion', 'construction'], ['house', 'house.fill', 'building', 'building.fill']),
  E('engineering', 'technology', amber, ['ingenier', 'engineer', 'industrial', 'estructur', 'tecnolog', 'technology', 'mecanizado', 'obra civil'],
    ['gearshape', 'gearshape.fill', 'gear', 'gearshape.2', 'wrench', 'wrench.and.screwdriver', 'hammer', 'screwdriver']),
  // artes
  E('music', 'arts', wine, ['music', 'musica', 'musik', 'musique', 'solfeo', 'armonia', 'harmony', 'piano', 'guitarra', 'guitar', 'canto', 'conservatorio', 'orquesta'],
    ['music.note', 'music.note.list', 'music.quarternote.3', 'pianokeys', 'guitars', 'music.mic']),
  E('photography', 'arts', slate, ['fotograf', 'photograph', '=cine', 'cinema', '=film', 'video', 'audiovisual', 'camara'], ['camera', 'camera.fill', 'film', 'video', 'photo']),
  // genéricos: solo si nada más concreto encaja
  E('timer', 'general', coral, ['simulacro', 'mock exam', 'practice test', 'cronometr', 'contrarreloj'], ['timer', 'stopwatch', 'clock', 'alarm', 'hourglass.bottomhalf.filled'], true),
  E('graduation', 'general', navy, ['graduac', 'graduation', '=tfg', '=tfm', 'tesis', 'thesis', 'doctorado', 'selectividad', '=ebau', '=evau', '=pau', 'acceso a la universidad', '=sat', '=act', '=gre', '=gmat'],
    ['graduationcap', 'graduationcap.fill', 'studentdesk'], true),
  E('exam', 'general', sage, ['examen', 'exam', '=test', '=quiz', 'parcial', 'midterm', '=final', 'prueba', 'evaluacion', 'control', 'recuperacion'],
    ['doc.text', 'list.clipboard', 'checklist', 'pencil', 'pencil.and.list.clipboard', 'list.bullet.clipboard', 'doc.on.clipboard', 'square.and.pencil'], true),
  E('idea', 'general', amber, ['aprender a aprender', 'tecnicas de estudio', 'study skills', 'creativ', 'innovac', 'innovation', 'bienvenida', 'welcome', 'ideas'],
    ['lightbulb', 'lightbulb.fill', 'sparkles', 'star', 'star.fill', 'wand.and.stars'], true),
  E('notebook', 'general', teal, ['apuntes', '=notes', 'cuaderno', 'notebook', 'resumen', 'resumenes', 'repaso'], ['note.text', 'paperclip', 'folder', 'doc', 'tray'], true),
  E('study', 'general', coral, ['estudio', 'study', 'estudiar', 'general', 'repasar'], ['book.closed', 'book.closed.fill', 'books.vertical.fill', 'text.book.closed.fill'], true)
]

const BY_ID = new Map<string, CourseIconEntry>()
for (const e of ALL) if (!BY_ID.has(e.id)) BY_ID.set(e.id, e)
const BY_LEGACY = new Map<string, string>()
for (const e of ALL) for (const s of e.legacy) if (!BY_LEGACY.has(s)) BY_LEGACY.set(s, e.id)

/** « palabra palabra » en minúsculas, sin tildes ni signos (para buscar al principio de palabra con " " + clave). */
function normalize(s: string): string {
  const folded = foldDiacritics(s.normalize('NFKC')).toLowerCase()
  let out = ' '
  let lastSpace = true
  for (const ch of folded) {
    if (/[\p{L}\p{N}]/u.test(ch)) { out += ch; lastSpace = false }
    else if (!lastSpace) { out += ' '; lastSpace = true }
  }
  if (!lastSpace) out += ' '
  return out
}

function matches(keyword: string, text: string): boolean {
  if (keyword.startsWith('=')) return text.includes(' ' + keyword.slice(1) + ' ')
  return text.includes(' ' + keyword)
}

/** Primera entrada cuyo vocabulario aparece en el texto; las genéricas solo si no aparece ninguna concreta. */
function match(text: string): CourseIconEntry | undefined {
  const t = normalize(text)
  if (Array.from(t).length <= 2) return undefined
  let generic: CourseIconEntry | undefined
  for (const e of ALL) {
    if (!e.keywords.some((k) => matches(k, t))) continue
    if (!e.generic) return e
    generic ??= e
  }
  return generic
}

export const CourseIconCatalog = {
  /** Icono por defecto (una pila de libros con el color del curso). */
  fallback: 'study',
  all: ALL as readonly CourseIconEntry[],
  /** Identificadores, en el orden del catálogo. */
  ids: ALL.map((e) => e.id) as readonly string[],
  categories: ICON_CATEGORIES,
  entry: (id: string): CourseIconEntry | undefined => BY_ID.get(id),
  isKnown: (id: string): boolean => BY_ID.has(id),
  /** Tono sugerido de un icono (para un curso nuevo). */
  hue: (id: string): number | undefined => BY_ID.get(id)?.hue,
  /** Los iconos de un grupo, en orden. */
  entries: (category: IconCategory): CourseIconEntry[] => ALL.filter((e) => e.category === category),
  /** Lista para la IA: «study, math, algebra…» (el orden del selector). */
  get promptList(): string {
    return ICON_CATEGORIES.flatMap((c) => CourseIconCatalog.entries(c)).map((e) => e.id).join(', ')
  },
  /**
   * El icono pixel-art de un curso a partir de lo que tenga guardado (identificador, SF Symbol antiguo, nombre inventado por
   * la IA o vacío), su asignatura y su título. Siempre devuelve un identificador del catálogo.
   */
  resolve(raw: string, subject = '', title = ''): string {
    const n = raw.trim().toLowerCase()
    if (BY_ID.has(n)) return n
    const alias = n.replace(/_/g, '-').replace(/ /g, '-')
    if (BY_ID.has(alias)) return alias
    const fromCourse = match(subject + ' ' + title)
    const legacy = BY_LEGACY.get(n) ?? BY_LEGACY.get(n.replace(/\.fill/g, ''))
    if (legacy) {
      // el SF Symbol lo eligió la IA mirando la asignatura: la asignatura concreta manda, si la hay
      if (fromCourse && !fromCourse.generic) return fromCourse.id
      return legacy
    }
    // un nombre libre («química», «physics-icon»): se busca como texto
    if (n) {
      const m = match(n.replace(/-/g, ' ').replace(/\./g, ' '))
      if (m) {
        if (m.generic && fromCourse && !fromCourse.generic) return fromCourse.id
        return m.id
      }
    }
    return fromCourse?.id ?? CourseIconCatalog.fallback
  },
  /** El icono que mejor encaja con una asignatura y un título, o undefined si no se reconoce ninguno. */
  guess(subject: string, title: string): string | undefined {
    return match(subject + ' ' + title)?.id
  },
  /** Iconos cuyo vocabulario empieza por lo que escribe el estudiante en el buscador («quim» → química). */
  search(query: string): Set<string> {
    const words = normalize(query).split(' ').filter((w) => w.length >= 2)
    if (!words.length) return new Set(ALL.map((e) => e.id))
    return new Set(
      ALL.filter((e) =>
        words.every((w) =>
          e.id.startsWith(w) ||
          e.keywords.some((k) => {
            const key = k.startsWith('=') ? k.slice(1) : k
            return key.split(' ').some((part) => part.startsWith(w) || (w.length >= 4 && w.startsWith(part)))
          })
        )
      ).map((e) => e.id)
    )
  }
}
