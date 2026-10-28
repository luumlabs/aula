// Para qué estudias: la clase de meta de un curso (port de StudyEngine/Pipeline/StudyGoal.swift).
//
// «Estudia cualquier cosa»: una asignatura, una certificación profesional, un idioma, programación, una oposición o un tema
// nuevo sin examen. La clase de meta cambia la pedagogía que reciben los agentes (temario oficial y simulacros con el formato
// real para una certificación, niveles MCER para un idioma, ejercicios de código para programación…). Se deduce del nombre
// del curso (`inferGoalKind`) si la petición no la trae. Puro e isomorfo.

export const STUDY_GOAL_KINDS = ['subject', 'certification', 'language', 'programming', 'entranceExam', 'topic', 'practicalSkill'] as const
export type StudyGoalKind = (typeof STUDY_GOAL_KINDS)[number]

/** Lo que la meta necesita saber de una petición. */
export interface GoalInput {
  title: string
  subject: string
  topics: string
  examDate?: string
  examNotes: string
  goalKind?: StudyGoalKind
}

/** ¿Lo normal es que haya un examen al final? */
export function usuallyHasExam(kind: StudyGoalKind): boolean {
  return kind === 'certification' || kind === 'entranceExam' || kind === 'subject' || kind === 'language'
}

/** Nombre para los agentes (inglés). */
export function goalAIName(kind: StudyGoalKind): string {
  switch (kind) {
    case 'subject': return 'a school or university subject'
    case 'certification': return 'a professional certification exam'
    case 'language': return 'a foreign language'
    case 'programming': return 'programming / data skills'
    case 'entranceExam': return 'a competitive or entrance exam (civil-service exam, university entrance, licensing exam)'
    case 'topic': return 'a new topic learned on their own, with no exam'
    case 'practicalSkill': return 'a practical skill'
  }
}

// MARK: Exámenes públicos conocidos

export interface KnownExamDomain {
  name: string
  /** Peso en el examen (porcentaje; el punto medio si el emisor da un intervalo). */
  weight: number
  /** «24 %», «15–20 %». */
  weightText: string
}

/** Lo que se sabe de un examen público conocido: datos de partida que los agentes confirman en la página oficial. */
export interface KnownExam {
  id: string
  name: string
  kind: StudyGoalKind
  issuer: string
  officialURL: string
  questions?: number
  minutes?: number
  passMark?: string
  format: string
  questionStyle: string
  domains: KnownExamDomain[]
  /** Palabras que lo reconocen en el nombre del curso (minúsculas, sin acentos). */
  keywords: string[]
  /** Datos inciertos o que cambian pronto: los agentes deben confirmarlos antes de usarlos. */
  mustConfirm: boolean
}

const d = (name: string, weight: number, text?: string): KnownExamDomain => ({ name, weight, weightText: text ?? `${Math.round(weight)} %` })

function exam(e: Omit<KnownExam, 'domains' | 'mustConfirm'> & { domains?: KnownExamDomain[]; mustConfirm?: boolean }): KnownExam {
  return { ...e, domains: e.domains ?? [], mustConfirm: e.mustConfirm ?? false }
}

/** Texto para los agentes. */
export function knownExamBrief(e: KnownExam): string {
  let s = `Known public facts about **${e.name}** (issuer: ${e.issuer}; official page: ${e.officialURL}). They come from Aula's catalog; ${e.mustConfirm ? 'they may have changed — CONFIRM them on the official page before relying on them' : 'confirm them on the official page when you can (if it differs, the official page wins)'}.\n`
  s += `- Format: ${e.format}\n`
  if (e.passMark) s += `- Passing score: ${e.passMark}\n`
  s += `- Question style: ${e.questionStyle}\n`
  if (e.domains.length) s += '- Official content outline (domain — weight): ' + e.domains.map((x) => `${x.name} — ${x.weightText}`).join('; ') + '\n'
  return s
}

/** Solo datos estables y públicos (formato, duración, nota de corte, dominios con su peso); los dudosos van con `mustConfirm`. */
export const KNOWN_EXAMS: readonly KnownExam[] = [
  exam({ id: 'aws-clf-c02', name: 'AWS Certified Cloud Practitioner (CLF-C02)', kind: 'certification', issuer: 'Amazon Web Services',
    officialURL: 'https://aws.amazon.com/certification/certified-cloud-practitioner/', questions: 65, minutes: 90, passMark: '700/1000',
    format: '65 questions (50 scored + 15 unscored, not identified), 90 minutes, scaled score 100–1000, passing score 700; multiple choice (1 correct of 4) and multiple response (2 or more correct of 5 or more); no penalty for guessing.',
    questionStyle: 'Short business or technical scenarios ("A company wants to… with the LEAST operational overhead. Which AWS service should it use?"); distractors are real AWS services that fit only part of the requirement.',
    domains: [d('Domain 1: Cloud Concepts', 24), d('Domain 2: Security and Compliance', 30), d('Domain 3: Cloud Technology and Services', 34), d('Domain 4: Billing, Pricing, and Support', 12)],
    keywords: ['clf-c02', 'clf c02', 'cloud practitioner'] }),
  exam({ id: 'aws-saa-c03', name: 'AWS Certified Solutions Architect – Associate (SAA-C03)', kind: 'certification', issuer: 'Amazon Web Services',
    officialURL: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/', questions: 65, minutes: 130, passMark: '720/1000',
    format: '65 questions (50 scored + 15 unscored), 130 minutes, scaled score 100–1000, passing score 720; multiple choice and multiple response.',
    questionStyle: 'Architecture scenarios with requirements and constraints (cost, availability, performance, security); pick the best design.',
    domains: [d('Design Secure Architectures', 30), d('Design Resilient Architectures', 26), d('Design High-Performing Architectures', 24), d('Design Cost-Optimized Architectures', 20)],
    keywords: ['saa-c03', 'saa c03', 'solutions architect associate', 'solutions architect - associate', 'solutions architect – associate'] }),
  exam({ id: 'az-900', name: 'Microsoft Azure Fundamentals (AZ-900)', kind: 'certification', issuer: 'Microsoft',
    officialURL: 'https://learn.microsoft.com/credentials/certifications/azure-fundamentals/', minutes: 45, passMark: '700/1000',
    format: 'About 40–60 questions in 45 minutes; passing score 700 on a 1–1000 scale; multiple choice, multiple response, drag-and-drop, yes/no statement sets and hot area.',
    questionStyle: 'Short statements and scenarios about cloud concepts and Azure services; yes/no statement series are common.',
    domains: [d('Describe cloud concepts', 27.5, '25–30 %'), d('Describe Azure architecture and services', 37.5, '35–40 %'), d('Describe Azure management and governance', 32.5, '30–35 %')],
    keywords: ['az-900', 'az 900', 'azure fundamentals'] }),
  exam({ id: 'comptia-security-plus', name: 'CompTIA Security+ (SY0-701)', kind: 'certification', issuer: 'CompTIA',
    officialURL: 'https://www.comptia.org/certifications/security', questions: 90, minutes: 90, passMark: '750/900',
    format: 'Maximum of 90 questions, 90 minutes, multiple choice and performance-based questions (simulations), passing score 750 on a 100–900 scale. Exam codes are retired every few years: confirm the current code.',
    questionStyle: 'Scenario questions ("A security analyst notices… Which of the following should the analyst do FIRST?") and performance-based tasks (match controls, read logs, configure a firewall rule).',
    domains: [d('1.0 General Security Concepts', 12), d('2.0 Threats, Vulnerabilities, and Mitigations', 22), d('3.0 Security Architecture', 18), d('4.0 Security Operations', 28), d('5.0 Security Program Management and Oversight', 20)],
    keywords: ['sy0-701', 'sy0 701', 'security+', 'security plus', 'comptia security'], mustConfirm: true }),
  exam({ id: 'ccna', name: 'Cisco CCNA (200-301)', kind: 'certification', issuer: 'Cisco',
    officialURL: 'https://www.cisco.com/site/us/en/learn/training-certifications/exams/ccna.html', minutes: 120,
    format: 'About 100–120 questions in 120 minutes; multiple choice, drag-and-drop, simlets and simulations; Cisco does not publish the passing score.',
    questionStyle: 'Configuration and troubleshooting scenarios with CLI output, topologies and subnetting.',
    domains: [d('Network Fundamentals', 20), d('Network Access', 20), d('IP Connectivity', 25), d('IP Services', 10), d('Security Fundamentals', 15), d('Automation and Programmability', 10)],
    keywords: ['ccna', '200-301'], mustConfirm: true }),
  exam({ id: 'pmp', name: 'PMI Project Management Professional (PMP)', kind: 'certification', issuer: 'Project Management Institute',
    officialURL: 'https://www.pmi.org/certifications/project-management-pmp',
    format: 'Scenario-based questions (multiple choice, multiple response, matching, hotspot and limited fill-in-the-blank), about 180 questions in about four hours with breaks; roughly half predictive and half agile/hybrid approaches. PMI updated the Exam Content Outline in 2026: CONFIRM the current number of questions, time and domain weights.',
    questionStyle: 'Situational questions ("A team member… What should the project manager do NEXT?") that reward servant leadership, early stakeholder engagement and following the right process.',
    domains: [d('People', 33), d('Process', 41), d('Business Environment', 26)],
    keywords: ['pmp', 'project management professional'], mustConfirm: true }),
  exam({ id: 'cfa-level-1', name: 'CFA Program Level I', kind: 'certification', issuer: 'CFA Institute',
    officialURL: 'https://www.cfainstitute.org/programs/cfa-program', questions: 180, minutes: 270,
    format: '180 multiple-choice questions with three options (A, B, C), in two sessions of 2 h 15 min; no penalty for wrong answers; the minimum passing score is not published.',
    questionStyle: 'Stand-alone multiple-choice items: calculations (time value of money, ratios, bond pricing) and conceptual/ethics vignettes.',
    domains: [d('Ethical and Professional Standards', 17.5, '15–20 %'), d('Quantitative Methods', 7.5, '6–9 %'), d('Economics', 7.5, '6–9 %'),
      d('Financial Statement Analysis', 12.5, '11–14 %'), d('Corporate Issuers', 7.5, '6–9 %'), d('Equity Investments', 12.5, '11–14 %'),
      d('Fixed Income', 12.5, '11–14 %'), d('Derivatives', 6.5, '5–8 %'), d('Alternative Investments', 8.5, '7–10 %'), d('Portfolio Management', 10, '8–12 %')],
    keywords: ['cfa level i', 'cfa level 1', 'cfa nivel 1', 'cfa nivel i', 'cfa l1', 'cfa'], mustConfirm: true }),
  exam({ id: 'google-data-analytics', name: 'Google Data Analytics Professional Certificate', kind: 'certification', issuer: 'Google (on Coursera)',
    officialURL: 'https://grow.google/certificates/data-analytics/',
    format: 'Online certificate with no single proctored exam: each course has graded quizzes and activities, and it ends with a case-study capstone. Tools: spreadsheets, SQL (BigQuery), Tableau and R.',
    questionStyle: 'Practical questions about the data analysis process (ask, prepare, process, analyze, share, act), SQL queries, spreadsheet functions and chart choice.',
    domains: [d('Foundations: Data, Data, Everywhere', 12.5), d('Ask Questions to Make Data-Driven Decisions', 12.5), d('Prepare Data for Exploration', 12.5),
      d('Process Data from Dirty to Clean', 12.5), d('Analyze Data to Answer Questions', 12.5), d('Share Data Through the Art of Visualization', 12.5),
      d('Data Analysis with R Programming', 12.5), d('Capstone: Complete a Case Study', 12.5)],
    keywords: ['google data analytics', 'data analytics professional certificate', 'certificado de analisis de datos de google'], mustConfirm: true }),
  exam({ id: 'psm-1', name: 'Professional Scrum Master I (PSM I)', kind: 'certification', issuer: 'Scrum.org',
    officialURL: 'https://www.scrum.org/assessments/professional-scrum-master-i-certification', questions: 80, minutes: 60, passMark: '85 %',
    format: '80 questions in 60 minutes, multiple choice, multiple answer and true/false, passing score 85 %; based on the Scrum Guide 2020.',
    questionStyle: 'Precise questions about the Scrum Guide\'s accountabilities, events and artifacts, with tricky wording ("must", "should").',
    domains: [d('Scrum theory and values', 20), d('Accountabilities (Scrum Master, Product Owner, Developers)', 30), d('Events', 30), d('Artifacts and commitments', 20)],
    keywords: ['psm i', 'psm 1', 'psm1', 'professional scrum master'] }),
  exam({ id: 'itil4-foundation', name: 'ITIL 4 Foundation', kind: 'certification', issuer: 'PeopleCert / Axelos',
    officialURL: 'https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/ITIL-1/itil-4-foundation-2565', questions: 40, minutes: 60, passMark: '26/40 (65 %)',
    format: '40 multiple-choice questions in 60 minutes, passing score 26/40 (65 %), closed book.',
    questionStyle: 'Definitions and application of ITIL concepts: the service value system, guiding principles, practices.',
    domains: [d('Key concepts of service management', 15), d('Guiding principles', 15), d('Four dimensions', 10), d('Service value system and value chain', 15), d('ITIL practices', 45)],
    keywords: ['itil'], mustConfirm: true }),
  exam({ id: 'istqb-ctfl', name: 'ISTQB Certified Tester Foundation Level (CTFL v4.0)', kind: 'certification', issuer: 'ISTQB',
    officialURL: 'https://www.istqb.org/certifications/certified-tester-foundation-level-ctfl-v4-0/', questions: 40, minutes: 60, passMark: '26/40 (65 %)',
    format: '40 multiple-choice questions in 60 minutes (+25 % for non-native speakers), passing score 26/40 (65 %).',
    questionStyle: 'Questions tied to the syllabus learning objectives (K1 remember, K2 understand, K3 apply: e.g. derive test cases with equivalence partitioning or boundary values).',
    domains: [d('Fundamentals of Testing', 20), d('Testing Throughout the SDLC', 15), d('Static Testing', 10), d('Test Analysis and Design', 27.5), d('Managing the Test Activities', 20), d('Test Tools', 7.5)],
    keywords: ['istqb', 'ctfl'], mustConfirm: true }),
  exam({ id: 'dele-b2', name: 'DELE B2 (Instituto Cervantes)', kind: 'language', issuer: 'Instituto Cervantes',
    officialURL: 'https://examenes.cervantes.es/es/dele/examenes/b2', passMark: '60/100',
    format: 'Four tests: Reading comprehension (70 min), Listening comprehension (40 min), Written expression and interaction (80 min), Oral expression and interaction (20 min + 20 min preparation). Pass: at least 60 of 100 points overall and at least 30 of 50 in each group (reading + writing; listening + speaking).',
    questionStyle: 'Task-based: matching texts and statements, multiple choice on long texts, gap-filling, a letter/opinion text of 150–180 words, an oral presentation and conversation.',
    domains: [d('Comprensión de lectura', 25), d('Comprensión auditiva', 25), d('Expresión e interacción escritas', 25), d('Expresión e interacción orales', 25)],
    keywords: ['dele b2'] }),
  exam({ id: 'ielts', name: 'IELTS (Academic / General Training)', kind: 'language', issuer: 'British Council, IDP, Cambridge',
    officialURL: 'https://ielts.org/take-a-test/test-types', minutes: 165,
    format: 'Listening (about 30 min, 40 questions), Reading (60 min, 40 questions), Writing (60 min: Task 1 of 150+ words, Task 2 essay of 250+ words) and Speaking (11–14 min interview in three parts). Each part is scored on a 0–9 band scale; the overall band is their average.',
    questionStyle: 'Form/note/table completion, multiple choice, matching headings, True/False/Not Given, sentence completion; band descriptors for writing and speaking (task response, coherence and cohesion, lexical resource, grammatical range and accuracy).',
    domains: [d('Listening', 25), d('Reading', 25), d('Writing', 25), d('Speaking', 25)],
    keywords: ['ielts'] }),
  exam({ id: 'toefl-ibt', name: 'TOEFL iBT', kind: 'language', issuer: 'ETS',
    officialURL: 'https://www.ets.org/toefl/test-takers/ibt/about.html',
    format: 'Four sections: Reading, Listening, Writing and Speaking. ETS revised the test in January 2026 (shorter, partly adaptive, scores on a 1–6 band scale alongside the 0–120 scale): CONFIRM the current tasks and timing on ets.org.',
    questionStyle: 'Academic texts and lectures; integrated tasks that combine reading/listening with speaking or writing.',
    domains: [d('Reading', 25), d('Listening', 25), d('Writing', 25), d('Speaking', 25)],
    keywords: ['toefl'], mustConfirm: true }),
  exam({ id: 'cambridge-b2-first', name: 'Cambridge B2 First (FCE)', kind: 'language', issuer: 'Cambridge English',
    officialURL: 'https://www.cambridgeenglish.org/exams-and-tests/qualifications/first/', minutes: 209, passMark: '160 (B2: 160–179)',
    format: 'Reading and Use of English (1 h 15 min, 7 parts), Writing (1 h 20 min, 2 tasks), Listening (about 40 min, 4 parts), Speaking (14 min, in pairs). Results on the Cambridge English Scale: 160–179 = B2, 180–190 = C1.',
    questionStyle: 'Multiple-choice cloze, open cloze, word formation, key word transformations, gapped texts; an essay plus a letter/article/review.',
    domains: [d('Reading and Use of English', 40), d('Writing', 20), d('Listening', 20), d('Speaking', 20)],
    keywords: ['b2 first', 'first certificate', 'fce', 'cambridge first'] }),
  exam({ id: 'sat', name: 'SAT (digital)', kind: 'entranceExam', issuer: 'College Board',
    officialURL: 'https://satsuite.collegeboard.org/sat/whats-on-the-test', questions: 98, minutes: 134,
    format: 'Digital and adaptive by module: Reading and Writing (2 modules, 54 questions, 64 min) and Math (2 modules, 44 questions, 70 min; calculator allowed); total score 400–1600.',
    questionStyle: 'Short passages with one question each (Reading and Writing); algebra, advanced math, problem solving/data analysis and geometry/trigonometry with multiple-choice and student-produced responses.',
    domains: [d('Reading and Writing', 50), d('Math', 50)],
    keywords: ['digital sat', 'sat exam', 'examen sat', 'sat'] })
]

// MARK: Deducir la meta

/** Texto sin acentos ni mayúsculas, con espacios en los bordes (para buscar palabras enteras). */
export function foldGoalText(s: string): string {
  const folded = s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
  return ' ' + folded.replace(/[^a-z0-9+#.\-]+/g, ' ') + ' '
}

/** ¿Aparece alguna de las palabras como palabra entera? (las que acaban en «*» valen como prefijo: «program*»). */
function has(text: string, words: readonly string[]): boolean {
  return words.some((w) => (w.endsWith('*') ? text.includes(' ' + w.slice(0, -1)) : text.includes(' ' + w + ' ')))
}

/** Palabras sueltas de un texto ya plegado: «2º» → «2o», «Spanish.» → «spanish», «b1-b2» → «b1», «b2» (sin tocar «node.js», «c++»). */
function goalWords(folded: string): string[] {
  return folded.split(/[\s\-]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w !== '')
}

/** El examen conocido que nombra el curso (por su código o su nombre), si lo hay. */
export function knownExamFor(title: string, subject = '', topics = ''): KnownExam | undefined {
  const t = foldGoalText([title, subject, Array.from(topics).slice(0, 300).join('')].join(' '))
  return KNOWN_EXAMS.find((e) => e.keywords.some((k) => t.includes(' ' + k + ' ') || (k.includes(' ') && t.includes(k))))
}

const CERTIFICATION = ['certified', 'certification', 'certificacion', 'certificado profesional', 'certificate', 'cert', 'aws', 'azure', 'az-900', 'gcp', 'comptia',
  'ccna', 'ccnp', 'cissp', 'cism', 'cisa', 'ceh', 'oscp', 'pmp', 'capm', 'prince2', 'itil', 'scrum', 'psm', 'csm', 'safe agilist', 'cfa', 'cpa', 'acca', 'frm',
  'cma', 'istqb', 'togaf', 'salesforce', 'kubernetes', 'cka', 'ckad', 'terraform', 'rhcsa', 'lpic', 'oracle certified', 'microsoft certified', 'google cloud',
  'six sigma', 'hubspot', 'google ads', 'tableau certified', 'databricks', 'snowflake']
const ENTRANCE = ['oposicion*', 'opos', 'selectividad', 'pau', 'ebau', 'evau', 'pevau', 'mir', 'eir', 'sat', 'act exam', 'examen act', 'gre', 'gmat', 'lsat', 'mcat', 'enem',
  'icfes', 'saber 11', 'exani', 'unam', 'examen de acceso', 'prueba de acceso', 'admision', 'admission', 'entrance exam', 'bar exam', 'abogacia',
  'carnet de conducir', 'permiso de conducir', 'teorico de conducir', 'driving test', 'driving theory', 'auxiliar administrativo', 'guardia civil',
  'policia nacional', 'magisterio', 'notarias', 'judicatura']
const PRACTICAL = ['excel', 'microsoft word', 'powerpoint', 'fotografia', 'photography', 'cocina', 'cooking', 'cuisine', 'guitarra', 'guitar', 'piano', 'dibujo', 'drawing',
  'oratoria', 'hablar en publico', 'public speaking', 'primeros auxilios', 'first aid', 'negociacion', 'negotiation', 'liderazgo', 'leadership', 'productividad',
  'productivity', 'mecanografia', 'typing', 'jardineria', 'gardening', 'edicion de video', 'video editing', 'photoshop', 'figma', 'canva', 'ajedrez', 'chess',
  'costura', 'carpinteria', 'bricolaje', 'marketing digital', 'ventas', 'sales', 'atencion al cliente', 'redaccion', 'copywriting']
const SCHOOL = ['asignatura', 'parcial', 'midterm', 'final exam', 'examen final', 'quiz', 'tema', 'unidad', 'capitulo*', 'chapter*', 'curso escolar', 'bachillerato',
  'secundaria', 'eso', 'primaria', 'grado', 'universidad', 'university', 'college', 'high school', 'ap', 'ib', 'calculo', 'calculus', 'algebra',
  'trigonometr*', 'fisica', 'physics', 'quimica', 'chemistry', 'biolog*', 'anatom*', 'historia', 'history', 'geografia', 'geography', 'economia', 'economics',
  'contabilidad', 'estadistica', 'statistics', 'filosofia', 'philosophy', 'literatura', 'literature', 'derecho', 'law', 'medicina', 'medicine', 'enfermeria', 'nursing']
const TOPIC = ['desde cero', 'from scratch', 'aprender', 'aprende', 'learn', 'introduccion a', 'introduction to', 'fundamentos de', 'basics', 'para principiantes',
  'for beginners', 'curso de', 'que es', 'what is', 'intro']

// Idiomas. Un gentilicio no basta: «The French Revolution», «Historia del arte chino» o «Spanish Civil War» no son cursos de
// francés, chino o español. Cuenta si el nombre ES el idioma («Spanish», «Alemán para viajar», «Inglés 2º ESO») o si lleva al
// lado una señal clara de aprendizaje o de nivel («Learn French», «Curso de inglés», «Inglés B2», «gramática inglesa»).

/** Nombres de idiomas (sin acentos). Los femeninos solo cuentan con una señal al lado («lengua inglesa», «gramática francesa»). */
const LANGUAGE_NAMES = new Set(['ingles', 'inglesa', 'english', 'frances', 'francesa', 'french', 'francais', 'aleman', 'alemana', 'german', 'deutsch', 'italiano',
  'italiana', 'italian', 'portugues', 'portuguesa', 'portuguese', 'chino', 'china', 'chinese', 'mandarin', 'japones', 'japonesa', 'japanese', 'coreano', 'coreana',
  'korean', 'arabe', 'arabic', 'ruso', 'rusa', 'russian', 'catalan', 'catala', 'euskera', 'basque', 'gallego', 'galician', 'neerlandes', 'holandes', 'dutch',
  'sueco', 'swedish', 'noruego', 'norwegian', 'danes', 'danish', 'finlandes', 'finnish', 'polaco', 'polish', 'turco', 'turkish', 'griego', 'greek', 'hebreo',
  'hebrew', 'hindi', 'persa', 'farsi', 'persian', 'vietnamita', 'vietnamese', 'tailandes', 'thai', 'indonesio', 'indonesian', 'swahili', 'ucraniano',
  'ukrainian', 'checo', 'czech', 'rumano', 'romanian', 'hungaro', 'hungarian', 'esperanto', 'spanish', 'espanol', 'espanola', 'castellano', 'castellana'])
/** Palabras que solo son el idioma «de verdad» en masculino o en inglés (las otras formas piden una señal al lado). */
const LANGUAGE_FEMININE = new Set(['inglesa', 'francesa', 'alemana', 'italiana', 'portuguesa', 'china', 'japonesa', 'coreana', 'rusa', 'espanola', 'castellana'])
/** Para quien escribe en español, «Español» o «Lengua castellana» suele ser la asignatura de lengua materna: piden señal de extranjero. */
const NATIVE_LANGUAGE_NAMES = new Set(['espanol', 'espanola', 'castellano', 'castellana'])
/** Exámenes y marcos de idiomas: bastan solos («Preparar el DELF», «Chinese HSK 3», «Español ELE»). */
const LANGUAGE_EXAMS = new Set(['dele', 'siele', 'delf', 'dalf', 'dilf', 'tcf', 'tef', 'toefl', 'ielts', 'toeic', 'hsk', 'hskk', 'jlpt', 'topik', 'celpe', 'celpe-bras',
  'cils', 'celi', 'plida', 'testdaf', 'telc', 'linguaskill', 'aptis', 'ele', 'mcer', 'cefr', 'eoi', 'ciple', 'caple'])
/** Exámenes que también son otra cosa («Cambridge history of philosophy», «Goethe's Faust»): cuentan con un nivel MCER o un idioma. */
const LANGUAGE_EXAMS_QUALIFIED = new Set(['cambridge', 'goethe', 'trinity', 'cervantes', 'zertifikat'])
/** Niveles del MCER («B2», «C1+», «a2.1»): solo cuentan junto a un idioma («Química C1» no es un curso de idiomas). */
const CEFR_LEVEL = /^[abc][12](\.\d)?\+?$/
/** Señales de aprendizaje que, al lado del idioma, lo hacen curso de idiomas («Learn French», «Curso de inglés», «vocabulario alemán»). */
const LANGUAGE_SIGNALS = new Set(['learn', 'learning', 'aprender', 'aprende', 'aprendo', 'aprendiendo', 'curso', 'cursos', 'course', 'clases', 'clase', 'classes', 'class',
  'lessons', 'lecciones', 'beginner', 'beginners', 'principiantes', 'principiante', 'basico', 'basic', 'elementary', 'elemental', 'intermediate', 'intermedio',
  'avanzado', 'advanced', 'upper', 'conversation', 'conversacion', 'conversational', 'grammar', 'gramatica', 'vocabulary', 'vocabulario', 'vocab',
  'pronunciation', 'pronunciacion', 'fonetica', 'phonetics', 'verbs', 'verbos', 'verb', 'tenses', 'tiempos', 'phrases', 'frases', 'expresiones', 'idioms',
  'speaking', 'listening', 'reading', 'writing', 'comprension', 'redaccion', 'nivel', 'level', 'exam', 'examen', 'test', 'certificado', 'certificate',
  'extranjeros', 'foreigners', 'travel', 'viajar', 'viajes', 'travelers', 'travellers', 'fluent', 'fluency', 'fluidez', 'practice', 'practica', 'practicar',
  'autodidacta', 'intensivo', 'intensive', 'crash', 'esl', 'efl', 'tefl', 'kanji', 'hiragana', 'katakana', 'pinyin', 'hanzi', 'subjuntivo',
  'subjunctive', 'preterito', 'phrasal'])
/** Señales de quien aprende un idioma extranjero (valen también para «español»: «Español para extranjeros», «aprender español»). */
const FOREIGN_LEARNER_SIGNALS = new Set(['learn', 'learning', 'aprender', 'aprende', 'aprendo', 'aprendiendo', 'extranjeros', 'foreigners', 'beginners', 'principiantes',
  'esl', 'efl', 'ele', 'travel', 'travelers', 'travellers'])
/** Detrás del idioma, «para»/«for» casi siempre es un curso de idiomas («Inglés para el trabajo», «Spanish for nurses»). */
const LANGUAGE_PURPOSE = new Set(['para', 'for', 'pour', 'per', 'fur', 'fuer'])
/** Frases que bastan solas. */
const LANGUAGE_PHRASES = ['lengua extranjera', 'lenguas extranjeras', 'foreign language', 'second language', 'segunda lengua', 'como lengua extranjera',
  'para extranjeros', 'as a foreign language', 'as a second language']
/** Palabras de relleno: un nombre hecho solo de idiomas y de estas es el idioma («Inglés básico para el trabajo», «Japanese 101»). */
const LANGUAGE_FILLER = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'a', 'al', 'y', 'e', 'o', 'the', 'an', 'of', 'in', 'and', 'to', 'with', 'con', 'para', 'for',
  'pour', 'mi', 'my', 'tu', 'your', 'idioma', 'idiomas', 'lengua', 'lenguas', 'language', 'languages', 'curso', 'course', 'courses', 'cursos', 'clase', 'clases',
  'class', 'basics', 'fundamentos', 'introduccion', 'introduction', 'intro', 'desde', 'cero', 'from', 'scratch', 'trabajo', 'work', 'negocios', 'business',
  'academic', 'academico', 'everyday', 'cotidiano', 'diario', 'daily', 'essentials', 'esencial', 'kids', 'ninos', 'adultos', 'adults', 'online', 'total',
  'complete', 'completo', 'eso', 'bachillerato', 'primaria', 'secundaria', 'grade', 'year', 'ano', 'semestre', 'semester', 'trimestre', 'term',
  'universidad', 'university', 'general', 'moderno', 'modern', 'mandarin', 'standard', 'estandar', 'american', 'americano', 'british', 'britanico', 'brasileno',
  'brazilian', 'europeo', 'european', 'latinoamericano', 'latin', 'dialect', 'dialecto', 'brasil', 'brazil', 'portugal', 'mexico', 'argentina',
  'espana', 'spain', 'francia', 'france', 'canada', 'quebec', 'estados', 'unidos', 'usa', 'uk', 'reino', 'unido', 'australia', 'tecnico', 'technical',
  'medico', 'medical', 'juridico', 'legal', 'comercial', 'commercial', 'profesional', 'professional', 'financiero', 'financial', 'turistico',
  'cientifico', 'scientific', 'oral', 'escrito', 'written', 'spoken', 'hablado', ...LANGUAGE_SIGNALS, ...LANGUAGE_EXAMS, ...LANGUAGE_EXAMS_QUALIFIED])

const isNumberWord = (w: string): boolean => /^\d+(o|a|er|ero|nd|rd|st|th)?$/.test(w)
/** Un número de asignatura («Japanese 101», «French 2»), no un año («Russian Revolution 1917»). */
const isCourseNumber = (w: string): boolean => /^\d{1,3}(o|a|er|ero|nd|rd|st|th)?$/.test(w)

/** ¿Hay una palabra de señal junto a la palabra `i`, saltando artículos y preposiciones? */
function signalNear(ws: readonly string[], i: number, signals: ReadonlySet<string>): boolean {
  const skip = new Set(['de', 'del', 'la', 'el', 'en', 'a', 'al', 'the', 'of', 'in', 'my', 'mi'])
  for (const step of [-1, 1]) {
    let j = i + step
    while (j >= 0 && j < ws.length && skip.has(ws[j])) j += step
    if (j >= 0 && j < ws.length && (signals.has(ws[j]) || CEFR_LEVEL.test(ws[j]) || LANGUAGE_EXAMS.has(ws[j]))) return true
  }
  return false
}

/** Señal FUERTE de curso de idiomas en un texto (examen, nivel MCER con idioma, aprendizaje al lado del idioma, «lengua extranjera»…). */
function strongLanguageSignal(folded: string): boolean {
  const ws = goalWords(folded)
  if (ws.some((w) => LANGUAGE_EXAMS.has(w))) return true
  if (has(folded, LANGUAGE_PHRASES)) return true
  const langAt = ws.flatMap((w, i) => (LANGUAGE_NAMES.has(w) ? [i] : []))
  const hasLevel = ws.some((w) => CEFR_LEVEL.test(w))
  if (hasLevel && (langAt.length > 0 || ws.some((w) => LANGUAGE_EXAMS_QUALIFIED.has(w)))) return true
  return langAt.some((i) => {
    const native = NATIVE_LANGUAGE_NAMES.has(ws[i])
    if (native) return signalNear(ws, i, FOREIGN_LEARNER_SIGNALS)
    if (i + 1 < ws.length && isCourseNumber(ws[i + 1])) return true
    // «Inglés para el trabajo», «Inglés técnico para programadores»: detrás del idioma (y sus adjetivos), «para»/«for»
    let j = i + 1
    while (j < ws.length && LANGUAGE_FILLER.has(ws[j]) && !LANGUAGE_PURPOSE.has(ws[j])) j++
    if (j < ws.length && LANGUAGE_PURPOSE.has(ws[j])) return true
    return signalNear(ws, i, LANGUAGE_SIGNALS)
  })
}

/** ¿El texto ES un idioma («Spanish», «Alemán para viajar», «Inglés 2º ESO», «Lengua inglesa»)? Los de lengua materna no cuentan. */
function isEssentiallyLanguage(folded: string): boolean {
  const ws = goalWords(folded)
  const names = ws.filter((w) => LANGUAGE_NAMES.has(w))
  if (!names.length || names.every((w) => NATIVE_LANGUAGE_NAMES.has(w))) return false
  // un femenino suelto («Inglesa») no es el idioma; con «lengua» delante sí
  if (names.every((w) => LANGUAGE_FEMININE.has(w)) && !ws.some((w) => w === 'lengua' || w === 'lenguas')) return false
  return ws.every((w) => LANGUAGE_NAMES.has(w) || LANGUAGE_FILLER.has(w) || isNumberWord(w) || CEFR_LEVEL.test(w))
}

// Programación. Un nombre de lenguaje que también es otra palabra («angular momentum», «rust», «pandas», «node» en «lymph node»,
// «code» en «Code of Hammurabi», «código penal») solo cuenta si el nombre del curso es todo tecnología («Learn Rust», «React y
// TypeScript») o hay otra señal de programación.

/** Señales inequívocas (palabras enteras o frases). */
const PROGRAMMING = ['python', 'sql', 'mysql', 'postgresql', 'sqlite', 'javascript', 'typescript', 'kotlin', 'swiftui', 'c++', 'c#', 'golang', 'go lang', 'php', 'html',
  'css', 'nodejs', 'node.js', 'node js', 'django', 'numpy', 'scikit-learn', 'pytorch', 'tensorflow', 'jquery', 'laravel', 'next.js', 'nextjs', '.net', 'dotnet',
  'git', 'github', 'bash', 'linux', 'programacion', 'programming', 'programar', 'coding', 'learn to code', 'aprender a programar', 'algoritm*', 'algorithm*',
  'data structures', 'estructuras de datos', 'web development', 'desarrollo web', 'desarrollo de software', 'software development', 'backend', 'frontend',
  'front-end', 'back-end', 'full stack', 'fullstack', 'excel vba', 'vba', 'power bi', 'r programming', 'matlab', 'haskell', 'webassembly']
/** Lenguajes y bibliotecas cuyo nombre es también una palabra corriente. */
const PROGRAMMING_AMBIGUOUS = new Set(['java', 'swift', 'rust', 'ruby', 'react', 'vue', 'angular', 'node', 'pandas', 'flask', 'perl', 'scala', 'elixir', 'julia', 'dart',
  'lua', 'api', 'apis', 'dax', 'spring', 'rails', 'express', 'go', 'c', 'r', 'flutter', 'svelte', 'redux', 'fastapi', 'docker', 'unity', 'godot'])
/** Nombres de una letra o juegos («Go», «C», «R»): piden además otra palabra técnica. */
const PROGRAMMING_NEEDS_CONTEXT = new Set(['go', 'c', 'r', 'unity', 'spring', 'express'])
/** Palabras técnicas o de curso que acompañan a un lenguaje («React hooks para principiantes», «Pandas DataFrames»). */
const TECH_FILLER = new Set(['js', 'ts', 'web', 'app', 'apps', 'ios', 'android', 'framework', 'frameworks', 'library', 'libraries', 'biblioteca', 'hooks', 'components',
  'componentes', 'dataframe', 'dataframes', 'rest', 'server', 'servidor', 'script', 'scripts', 'scripting', 'development', 'desarrollo', 'developer', 'developers',
  'programadores', 'lenguaje', 'language', 'code', 'codigo', 'on', 'boot', 'microservicios', 'microservices', 'games', 'juegos', 'videojuegos', 'game', 'apis',
  'api', 'lang', 'cli', 'native', 'ui', 'backend', 'frontend', 'es6', 'jdk', 'jvm', 'spring', 'mvc', 'oop', 'poo', 'objetos', 'objects', 'tutorial', 'bootcamp'])
/** Asignatura que es informática: hace programación también a los nombres ambiguos («Rust» de Informática). */
const COMPUTING_SUBJECTS = ['informatica', 'computer science', 'computacion', 'computing', 'programacion', 'programming', 'software', 'ingenieria de software',
  'software engineering', 'desarrollo web', 'web development', 'data science', 'ciencia de datos', 'tecnologia de la informacion', 'information technology']

/** ¿El nombre del curso es todo tecnología («Learn Rust», «React y TypeScript», «Lenguaje C», «Pandas DataFrames»)? */
function isEssentiallyTech(folded: string): boolean {
  const ws = goalWords(folded)
  const tech = ws.filter((w) => PROGRAMMING_AMBIGUOUS.has(w) || has(` ${w} `, PROGRAMMING))
  if (!tech.length) return false
  const context = ws.some((w) => TECH_FILLER.has(w) || has(` ${w} `, PROGRAMMING) || (PROGRAMMING_AMBIGUOUS.has(w) && !PROGRAMMING_NEEDS_CONTEXT.has(w)))
  if (!context) return false
  return ws.every((w) => PROGRAMMING_AMBIGUOUS.has(w) || TECH_FILLER.has(w) || LANGUAGE_FILLER.has(w) || isNumberWord(w) || /^v?\d+(\.\d+)*$/.test(w) || has(` ${w} `, PROGRAMMING))
}

// Asignaturas que no son idiomas: si la asignatura las nombra, manda («The Spanish Transition to Democracy» de Historia).
const DISCIPLINES = ['historia', 'history', 'arte', 'art', 'art history', 'historia del arte', 'geografia', 'geography', 'biolog*', 'quimica', 'chemistry', 'fisica',
  'physics', 'matematica*', 'mathematics', 'math', 'maths', 'calculo', 'calculus', 'algebra', 'estadistica', 'statistics', 'economia', 'economics', 'filosofia',
  'philosophy', 'literatura', 'literature', 'derecho', 'law', 'medicina', 'medicine', 'enfermeria', 'nursing', 'anatom*', 'fisiolog*', 'physiolog*', 'psicolog*',
  'psycholog*', 'sociolog*', 'politica', 'politics', 'political science', 'ciencia politica', 'ciencias politicas', 'antropolog*', 'anthropolog*', 'arqueolog*',
  'archaeolog*', 'archeolog*', 'geolog*', 'astronom*', 'musica', 'music', 'religion', 'teologia', 'theology', 'ingenieria', 'engineering', 'arquitectura',
  'architecture', 'contabilidad', 'accounting', 'bioquimica', 'biochemistry', 'genetica', 'genetics', 'ecolog*', 'farmacolog*', 'pharmacolog*', 'farmacia',
  'pharmacy', 'veterinaria', 'veterinary', 'humanidades', 'humanities', 'ciencias sociales', 'social studies', 'social sciences', 'ciencias naturales',
  'natural sciences', 'science', 'ciencias', 'classics', 'civics', 'educacion civica']

/** La clase de meta deducida y si la deducción es segura (si no, el planificador debe fiarse del título y la asignatura). */
export interface GoalGuess {
  kind: StudyGoalKind
  /** true = un examen conocido, una señal inequívoca o la asignatura lo dicen; false = una suposición por palabras sueltas. */
  sure: boolean
}

/** Deduce la clase de meta del nombre, la asignatura y los temas, y si es una suposición. undefined = no se reconoce. */
export function inferGoal(title: string, subject = '', topics = ''): GoalGuess | undefined {
  const known = knownExamFor(title, subject, topics)
  if (known) return { kind: known.kind, sure: true }
  const ft = foldGoalText(title), fs = foldGoalText(subject)
  const t = foldGoalText([title, subject].join(' '))
  if (strongLanguageSignal(ft) || strongLanguageSignal(fs)) return { kind: 'language', sure: true }
  if (has(t, CERTIFICATION)) return { kind: 'certification', sure: false }
  if (has(t, ENTRANCE)) return { kind: 'entranceExam', sure: false }
  if (has(t, PROGRAMMING)) return { kind: 'programming', sure: true }
  if (subject.trim() && isEssentiallyLanguage(fs)) return { kind: 'language', sure: false }
  const computing = has(fs, COMPUTING_SUBJECTS)
  // una asignatura que nombra otra disciplina manda sobre las palabras sueltas del título (gentilicios, «node», «code»…)
  if (has(fs, DISCIPLINES) && !computing) {
    if (has(t, PRACTICAL)) return { kind: 'practicalSkill', sure: false }
    return { kind: 'subject', sure: true }
  }
  if (isEssentiallyTech(ft) || (computing && goalWords(ft).some((w) => PROGRAMMING_AMBIGUOUS.has(w)))) return { kind: 'programming', sure: false }
  if (isEssentiallyLanguage(ft)) return { kind: 'language', sure: false }
  if (has(t, PRACTICAL)) return { kind: 'practicalSkill', sure: false }
  if (has(t, SCHOOL)) return { kind: 'subject', sure: false }
  if (has(t, TOPIC)) return { kind: 'topic', sure: false }
  return undefined
}

/** Deduce la clase de meta del nombre, la asignatura y los temas. undefined = no se reconoce. */
export function inferGoalKind(title: string, subject = '', topics = ''): StudyGoalKind | undefined {
  return inferGoal(title, subject, topics)?.kind
}

/** La meta de una petición: la elegida o la deducida (y si nada encaja, una asignatura con examen o un tema libre sin él). */
export function goalKindOf(r: GoalInput): StudyGoalKind {
  if (r.goalKind) return r.goalKind
  const k = inferGoalKind(r.title, r.subject, r.topics)
  if (k) return k
  return r.examDate !== undefined || r.examNotes.trim() !== '' ? 'subject' : 'topic'
}

/** ¿La clase de meta la eligió la persona o se dedujo con seguridad? (si no, los agentes se fían del título y la asignatura) */
export function goalKindIsSure(r: GoalInput): boolean {
  return r.goalKind !== undefined || inferGoal(r.title, r.subject, r.topics)?.sure === true
}

export const knownExamOf = (r: GoalInput): KnownExam | undefined => knownExamFor(r.title, r.subject, r.topics)

// MARK: Texto para los agentes

/** La línea y el bloque de contexto que describen la meta (van en el contexto de cada tarea). */
export function goalContextBrief(r: GoalInput): string {
  const kind = goalKindOf(r)
  const pace = r.examDate === undefined && !usuallyHasExam(kind) ? ' (self-paced, no exam date)' : r.examDate === undefined ? ' (no exam date set: self-paced)' : ''
  let s = `- Kind of goal: **${goalAIName(kind)}**${pace}\n`
  if (!goalKindIsSure(r)) s += `  ${GUESSED_GOAL_NOTE}\n`
  const e = knownExamOf(r)
  if (e) s += '\n' + knownExamBrief(e)
  return s
}

/**
 * Aviso cuando la clase de meta es una suposición por palabras sueltas del nombre: el planificador debe poder corregirla (un
 * gentilicio en un curso de historia, «node» en anatomía). Lo que escribió la persona manda.
 */
export const GUESSED_GOAL_NOTE = '(This kind of goal was GUESSED from words in the course name; the student did not choose it. The title, subject, topics and goal the student wrote are authoritative: if they describe a different kind of course — e.g. a history course whose title contains a nationality ("The French Revolution"), or an anatomy topic that mentions a "node" — design the course they describe, ignore the goal-specific instructions that do not fit, and say so in `finish`.)'

/** Cómo enseñar este tipo de meta: va al final del sistema (el prefijo común no cambia y se aprovecha la caché). */
export function goalPedagogy(r: GoalInput): string {
  const kind = goalKindOf(r)
  let body: string
  switch (kind) {
    case 'subject':
      return ''
    case 'certification':
      body = `The student is preparing a **professional certification**. Make the course match the official exam, not a textbook:
- Structure: units = the official exam domains (use their official names and numbering, e.g. "Domain 2: Security and Compliance"); skills = the task statements / objectives inside each domain. Skill \`weight\` = the official domain percentage split among its skills. Put the official exam code in \`course_code\`, and the format in \`exam\` (duration_minutes, notes with the number of questions, question types and the passing score).
- Sources: the issuer's official exam guide / content outline is the syllabus (\`trust: official\`). Use official documentation (vendor docs, whitepapers, FAQs) for facts. NEVER use or imitate leaked real exam questions ("brain dumps", "actual exam questions"): they break the candidate agreement — write original questions in the same style.
- Lessons: explain each service/concept with the decision it supports ("when would you choose X over Y?"), with a \`compare\` or \`table\` for look-alike options (the exam's favourite distractors), a realistic scenario as worked example, and an \`examTip\` callout with the keywords that point to the right answer.
- Exercises: mostly **scenario-based multiple choice exactly like the real exam** — a 2–4 sentence situation (a company, a requirement, a constraint) and a question; 4 options with ONE correct (\`choice\`), plus some **multiple response** ("Choose TWO.", \`choice\` with \`"multi": true\`, 5 options) when the real exam has them. Distractors are real services/concepts that fit only part of the requirement, and each \`why\` says which requirement it misses. Add a few \`matching\` (service ↔ use case) and \`truefalse\` for level 1 warm-ups. No numeric/expression answers unless the exam really has calculations (e.g. finance).
- Flashcards: service/term ↔ what it does and when to use it; limits and numbers that the exam asks for.
- Mock exam blueprint: mirror the official format (number of questions, minutes, sections = domains with counts proportional to their weights, single-answer and multiple-response mix). If the course's bank is smaller than the real exam, keep the real minutes-per-question ratio and scale the count down (e.g. 30 questions in 42 minutes instead of 65 in 90) and say so. Put the passing score and how scaled scoring works in the \`instructions\`, and the passing score as \`pass_percent\` (e.g. 70 for 700/1000).`
      break
    case 'language':
      body = `The student is learning a **foreign language**. Teach it as a language course, not as a content subject:
- Levels: use the CEFR (A1–C2). Infer the starting and target levels from the title/goal (e.g. "A2 → B2"); state your assumption with \`note_progress\`. Skills = can-do statements of the target level grouped by communicative function (introduce yourself, narrate past events, give opinions…) and by system (key grammar, vocabulary fields, pronunciation notes) — never "Chapter 3".
- Language use: explanations, hints and solutions in the course language; examples, dialogues, texts and the exercises themselves in the TARGET language (with a short gloss/translation in the course language at A1–B1). Mark the target-language examples clearly.
- Lessons: a short authentic-style text or dialogue first, then the rule in plain words with a \`table\` (conjugations, word order), 2–3 contrasted examples, the typical learner errors for speakers of the course language (\`mistake\` callout + \`spot\` block), and a recap with useful phrases.
- Exercises: \`cloze\` (conjugate/choose the word in context), \`choice\` (meaning, register, the right connector), \`ordering\` (word order, sentence order in a dialogue), \`matching\` (word ↔ meaning, question ↔ answer), \`short\` with EVERY acceptable variant listed (contractions, synonyms, word orders), reading comprehension (a text block in the prompt + questions), and \`open\` writing tasks with a rubric (task achievement, coherence, vocabulary, grammar) and a model answer. There is no audio: for listening, give a transcript in a \`quote\` block and say it is a transcript; for speaking, give a speaking prompt with a model answer and self-assessment rubric (\`open\`).
- Grading is EXACT in this course: blanks and short answers count accents, spelling, agreement and articles (case does not); a near miss ("murio" for "murió") scores 0 with a hint to check it. Write \`"exact": true\` on every blank and short answer in the target language; never list an accent-less or misspelt form in \`accepted\` unless it is really correct; use \`"exact": false\` only for answers in the course language (e.g. "which tense is this?"). Hints point to the rule (person, tense, agreement) and never contain the expected form.
- Flashcards: vocabulary both directions (target ↔ course language) with an example sentence, and key structures.
- If an official exam is named (DELE, DELF, IELTS, TOEFL, Cambridge, Goethe, HSK…), mirror its parts, task types, timing and scoring in the blueprint, and add a lesson on its task types and strategy.`
      break
    case 'programming':
      body = `The student is learning **programming / data skills**. They must read, trace and write real code:
- Skills = concrete abilities ("Write a loop that accumulates a total", "Filter rows with WHERE and AND/OR", "Use a dict to count occurrences"). State the language and version (e.g. Python 3.12, SQLite/standard SQL) in \`guidance\`.
- Lessons: every concept with a short runnable \`code\` block (\`language\`, \`code\`, and the exact \`output\`), explained line by line; a "predict the output" \`predict\` block; common errors with the real error message (\`mistake\` callout); a \`spot\` block where one line has the bug.
- Exercises (all auto-gradable; put code inside the prompt as a fenced code block with the language name): **predict the output** (\`short\` with the exact output; list accepted variants such as with/without quotes), **fill in the missing code** (\`cloze\` with every equivalent accepted spelling), **Parsons problems** — put the lines in order (\`ordering\`, 4–7 lines, the items are the code lines), **find the bug** (\`choice\` naming the faulty line and why), **which snippet does X** (\`choice\` with code options), **what does this evaluate to** (\`numeric\`/\`short\`), plus a few **write the code** tasks as \`open\` with a model solution and a rubric (correctness, edge cases, readability).
- Verify every output and every answer key: if you have \`run_code\`, RUN the exact code (Python, JavaScript or SQL) and copy its real output; otherwise trace it twice step by step. Never invent outputs. Keep snippets deterministic (no randomness, time, network or files).
- Flashcards: syntax ↔ meaning, "what does this return?", common error ↔ fix.`
      break
    case 'entranceExam':
      body = `The student is preparing a **competitive or entrance exam** (civil-service exam, university entrance, licensing exam). Follow the official call:
- The syllabus is the official one of the current call/convocatoria ("temario oficial", topics numbered as in the official bulletin or the exam board's page). Skills mirror those topics; weights follow how often each one appears in past papers.
- Use past papers ("exámenes de otros años", "modelos de examen") as the model of style, difficulty and format when you can find them (official exam board pages first). Write original questions in that style — never claim a question is from a real past paper unless it is quoted from the official source with its year.
- Laws, regulations and official data must be the version in force: cite the article and the official source, and say "check the current version" when it may have changed.
- Exercises in the real format (e.g. 4-option multiple choice with penalty for wrong answers, or development problems): say in the blueprint instructions how wrong answers are penalised if the real exam does it.`
      break
    case 'topic':
      body = `The student wants to **learn something new on their own** — there is no exam and no instructor. Design a great self-paced course:
- Start from zero unless the goal says otherwise: define every term, build intuition before formalism, and use everyday analogies and real examples. Order skills as a learning path (foundations → core ideas → applications → current debates/limits).
- Do not write as if there were an exam: skill weights = importance for understanding the topic; replace "exam tips" with practical takeaways ("In practice…", "Why it matters"); objectives are things the learner can explain, recognise or do.
- Research: with no materials, you are the researcher. Use reliable open sources (encyclopedias, university course pages, official documentation, reputable organisations) and say where facts come from; for fast-moving fields (AI, technology, finance, health) prefer recent sources and flag what may change.
- Practice still matters: concept checks, worked examples, scenario questions ("which approach fits this situation?"), \`ordering\` for processes, \`matching\` for terms, \`open\` questions with a rubric for explanations.
- Mock exam blueprint: a short **final self-check** (15–25 mixed questions, generous time); say in its \`instructions\` that it is a self-check of the whole course, not an official exam.`
      break
    case 'practicalSkill':
      body = `The student wants a **practical skill**. Teach doing, not reciting:
- Skills = tasks the learner can perform ("Build a pivot table to summarise sales by month", "Expose correctly in backlight"). Lessons use \`steps\` blocks (procedures), checklists, before/after \`compare\` blocks and realistic scenarios.
- Exercises: scenario \`choice\` questions ("what do you do next?"), \`ordering\` of the steps of a procedure, \`matching\` (tool ↔ purpose), \`short\`/\`numeric\` for concrete results (a formula's result, a setting), and \`open\` "describe how you would…" tasks with a rubric. Suggest a hands-on practice task at the end of each lesson.
- Safety-critical skills (first aid, electricity, driving…): follow the current official guidelines of a recognised body and say which ones; never improvise procedures.`
      break
  }
  const hedge = goalKindIsSure(r) ? '' : GUESSED_GOAL_NOTE + '\n'
  return `\n# This course's goal: ${goalAIName(kind)}\n` + hedge + body + '\n'
}

/** Qué es una «habilidad» según la meta (para el plan). */
export function skillDefinition(kind: StudyGoalKind): string {
  switch (kind) {
    case 'certification': return 'a skill = one task statement / objective of an official exam domain ("Identify the AWS services for monitoring and logging"), not a chapter'
    case 'language': return 'a skill = one can-do ability of the target CEFR level or one key grammar/vocabulary point used in context ("Narrate past events with the preterite and imperfect"), not "Unit 3"'
    case 'programming': return 'a skill = one concrete thing the student can write or read in code ("Loop over a list and accumulate a total"), not "Chapter 3"'
    case 'topic': case 'practicalSkill': return 'a skill = one learnable, checkable ability ("Explain how a neural network learns from examples"), not a chapter title'
    case 'subject': case 'entranceExam': return 'a skill = one exam-sized, testable ability — "Solve quadratic equations with the formula", not "Chapter 3"'
  }
}
