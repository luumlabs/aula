// Idioma de la interfaz (BaseKit/AppLanguage.swift) e idiomas en los que Aula escribe cursos (StudyEngine/AI/CourseLanguage.swift).

/** Idioma en el que la app muestra sus textos y su `locale` para formatear listas y fechas dentro de esas frases. */
let appCode = 'es'
let appRegion: string | null = null

export const AppLanguage = {
  /** Idioma base del catálogo (las claves son el texto en español). */
  base: 'es',
  /** Código del idioma de la interfaz («es», «en», «pt-BR»…). */
  get code(): string {
    return appCode
  },
  /** Locale BCP-47 del idioma de la interfaz con la región del sistema si el código no la trae («es» + US → «es-US»). */
  get locale(): string {
    if (appCode.includes('-') || !appRegion) return appCode
    return `${appCode}-${appRegion}`
  },
  /** Lo fija la app al leer los ajustes (o al cambiar de idioma). */
  set(code: string, region?: string | null): void {
    appCode = code || 'es'
    if (region !== undefined) appRegion = region
  },
  /** Une elementos con la conjunción del idioma: [«A», «B»] → «A y B» (es) / «A and B» (en). */
  list(items: string[]): string {
    try {
      return new Intl.ListFormat(AppLanguage.locale, { style: 'long', type: 'conjunction' }).format(items)
    } catch {
      return items.join(', ')
    }
  }
}

export interface CourseLanguage {
  /** Código BCP-47 («es», «pt-BR», «zh-Hans»…). */
  id: string
  /** Nombre en su propio idioma («Español», «日本語»…). */
  nativeName: string
  /** Nombre en inglés (para las instrucciones de la IA). */
  englishName: string
  /** Se escribe de derecha a izquierda. */
  isRTL: boolean
  /** Título del primer «Pruébalo» de una lección y del segundo («Ponte a prueba»), en el idioma del curso. */
  tryIt: string
  checkYourself: string
}

const ALL: CourseLanguage[] = [
  { id: 'es', nativeName: 'Español', englishName: 'Spanish', isRTL: false, tryIt: 'Pruébalo', checkYourself: 'Ponte a prueba' },
  { id: 'en', nativeName: 'English', englishName: 'English', isRTL: false, tryIt: 'Try it', checkYourself: 'Check yourself' },
  { id: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Brazilian Portuguese', isRTL: false, tryIt: 'Experimente', checkYourself: 'Teste-se' },
  { id: 'fr', nativeName: 'Français', englishName: 'French', isRTL: false, tryIt: 'À toi de jouer', checkYourself: 'Vérifie tes acquis' },
  { id: 'de', nativeName: 'Deutsch', englishName: 'German', isRTL: false, tryIt: 'Probier es aus', checkYourself: 'Teste dich selbst' },
  { id: 'it', nativeName: 'Italiano', englishName: 'Italian', isRTL: false, tryIt: 'Prova tu', checkYourself: 'Mettiti alla prova' },
  { id: 'zh-Hans', nativeName: '简体中文', englishName: 'Simplified Chinese', isRTL: false, tryIt: '试一试', checkYourself: '检验一下' },
  { id: 'ja', nativeName: '日本語', englishName: 'Japanese', isRTL: false, tryIt: 'やってみよう', checkYourself: '腕試し' },
  { id: 'ko', nativeName: '한국어', englishName: 'Korean', isRTL: false, tryIt: '직접 해 보기', checkYourself: '실력 점검' },
  { id: 'ru', nativeName: 'Русский', englishName: 'Russian', isRTL: false, tryIt: 'Попробуй сам', checkYourself: 'Проверь себя' },
  { id: 'ar', nativeName: 'العربية', englishName: 'Arabic', isRTL: true, tryIt: 'جرّب بنفسك', checkYourself: 'اختبر نفسك' },
  { id: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', isRTL: false, tryIt: 'ख़ुद करके देखें', checkYourself: 'ख़ुद को परखें' }
]

/** Palabras que Aula escribe EN EL CURSO cuando la IA no las da: van en el idioma del curso, no en el de la interfaz. */
const COURSE_WORDS: Record<string, { exam: string; problems: string; section: string }> = {
  es: { exam: 'Examen', problems: 'Problemas', section: 'Sección' },
  en: { exam: 'Exam', problems: 'Problems', section: 'Section' },
  'pt-BR': { exam: 'Prova', problems: 'Problemas', section: 'Seção' },
  fr: { exam: 'Examen', problems: 'Problèmes', section: 'Section' },
  de: { exam: 'Prüfung', problems: 'Aufgaben', section: 'Abschnitt' },
  it: { exam: 'Esame', problems: 'Problemi', section: 'Sezione' },
  'zh-Hans': { exam: '考试', problems: '习题', section: '部分' },
  ja: { exam: '試験', problems: '問題', section: 'セクション' },
  ko: { exam: '시험', problems: '문제', section: '섹션' },
  ru: { exam: 'Экзамен', problems: 'Задачи', section: 'Раздел' },
  ar: { exam: 'الامتحان', problems: 'مسائل', section: 'القسم' },
  hi: { exam: 'परीक्षा', problems: 'प्रश्न', section: 'खंड' }
}

export const CourseLanguages = {
  all: ALL as readonly CourseLanguage[],
  /** El idioma de un código («es-MX» → Español, «pt» → Português, «zh» → 简体中文). undefined si no es uno de los 12. */
  find(code: string): CourseLanguage | undefined {
    const c = code.replace(/_/g, '-').toLowerCase()
    const exact = ALL.find((l) => l.id.toLowerCase() === c)
    if (exact) return exact
    if (c.startsWith('zh')) return ALL.find((l) => l.id === 'zh-Hans')
    const base = c.split('-')[0]
    return ALL.find((l) => l.id.toLowerCase().split('-')[0] === base)
  },
  /** Idioma de un curso por su código; si no es uno de los 12, español. */
  of(code: string | null | undefined): CourseLanguage {
    return (code ? CourseLanguages.find(code) : undefined) ?? ALL[0]
  },
  /** El primero de los idiomas preferidos que sea uno de los 12; si no, español. */
  preferred(preferredLanguages: readonly string[]): CourseLanguage {
    for (const l of preferredLanguages) {
      const found = CourseLanguages.find(l)
      if (found) return found
    }
    return ALL[0]
  },
  /** Voz para leer en voz alta. */
  speechLanguage(l: CourseLanguage): string {
    return l.id === 'zh-Hans' ? 'zh-CN' : l.id
  },
  /** «Examen» en el idioma del curso. */
  examTitle(l: CourseLanguage): string {
    return COURSE_WORDS[l.id]?.exam ?? 'Exam'
  },
  /** «Problemas» (sección única de un simulacro sin plano). */
  problemsTitle(l: CourseLanguage): string {
    return COURSE_WORDS[l.id]?.problems ?? 'Problems'
  },
  /** «Sección 2» (sección de un simulacro sin título). */
  sectionTitle(l: CourseLanguage, n: number): string {
    return `${COURSE_WORDS[l.id]?.section ?? 'Section'} ${n}`
  }
}
