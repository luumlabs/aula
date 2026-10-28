import { chars, foldedLower, isWhitespace } from '../core/text'

function collapse(s: string): string {
  return s.split(/[\p{White_Space}]+/u).filter((p) => p !== '').join(' ')
}

function folded(words: readonly string[]): ReadonlySet<string> {
  return new Set(words.map((w) => foldedLower(collapse(w))))
}

const EDGE_CHARS = new Set([...' .!¡?¿,;:«»“”„"\'‘’「」『』()。！？、'])

/**
 * Palabras que el estudiante puede escribir en lugar de números, en los 12 idiomas de la app (es, en, pt-BR, fr, de, it,
 * zh-Hans, ja, ko, ru, ar, hi): «no existe / indefinido», «sin solución / ∅», «todos los reales» y los separadores de
 * listas. Se comparan sin mayúsculas ni acentos, sin comillas ni puntuación al principio o al final y con los espacios
 * repetidos reducidos a uno.
 */
export const AnswerWords = {
  /** «No existe / no está definido» (la respuesta a 1/0, tan(90°), un límite que no existe…). */
  undefined: folded([
    // universales
    'dne', 'd.n.e', 'd.n.e.', '∄', 'nan',
    // español
    'indefinido', 'indefinida', 'no definido', 'no definida', 'no esta definido', 'no esta definida', 'no está definido',
    'no está definida', 'sin definir', 'no existe', 'inexistente', 'no hay',
    // inglés
    'undefined', 'undef', 'und', 'not defined', 'does not exist', 'doesnt exist', "doesn't exist", 'doesn’t exist',
    'nonexistent', 'non-existent', 'it is undefined', 'is undefined',
    // portugués
    'não existe', 'nao existe', 'indefinido', 'indefinida', 'não definido', 'não definida', 'não está definido',
    'não está definida', 'inexistente',
    // francés
    'indéfini', 'indéfinie', 'non défini', 'non définie', 'pas défini', 'pas définie', "n'existe pas", 'n’existe pas',
    'nexiste pas', 'inexistant', 'inexistante',
    // alemán
    'undefiniert', 'nicht definiert', 'existiert nicht', 'nicht existent', 'nicht vorhanden',
    // italiano
    'indefinito', 'indefinita', 'non definito', 'non definita', 'non è definito', 'non è definita', 'non esiste', 'inesistente',
    // ruso
    'не определено', 'не определен', 'не определён', 'не определена', 'неопределено', 'не существует',
    // chino simplificado
    '无定义', '未定义', '没有定义', '不存在', '无意义',
    // japonés
    '未定義', '定義されない', '定義されていない', '定義できない', '存在しない',
    // coreano
    '정의되지 않음', '정의되지않음', '정의되지 않는다', '정의 안 됨', '정의 불가', '존재하지 않음', '존재하지 않는다',
    // árabe
    'غير معرّف', 'غير معرف', 'غير معرفة', 'غير معرّفة', 'غير محدد', 'غير محددة', 'غير موجود', 'لا يوجد',
    // hindi
    'अपरिभाषित', 'परिभाषित नहीं', 'परिभाषित नहीं है', 'मौजूद नहीं', 'अस्तित्व में नहीं',
  ]),

  /** «Sin solución / conjunto vacío» (conjuntos e intervalos). */
  empty: folded([
    '', '∅', '{}', '[]', 'dne', 'null',
    // español
    'vacio', 'vacia', 'conjunto vacio', 'ninguna', 'ninguno', 'ningun', 'nada', 'no hay solucion', 'no hay soluciones',
    'sin solucion', 'sin soluciones', 'no tiene solucion', 'no tiene soluciones',
    // inglés
    'empty', 'empty set', 'emptyset', 'the empty set', 'none', 'no solution', 'no solutions', 'no real solution',
    'no real solutions',
    // portugués
    'vazio', 'conjunto vazio', 'nenhuma', 'nenhum', 'sem solução', 'sem soluções', 'não há solução', 'não tem solução',
    // francés
    'vide', 'ensemble vide', 'aucune', 'aucun', 'aucune solution', 'pas de solution', 'pas de solutions',
    // alemán
    'leer', 'leere menge', 'keine', 'keine lösung', 'keine lösungen', 'keine loesung',
    // italiano
    'vuoto', 'insieme vuoto', 'nessuna', 'nessuno', 'nessuna soluzione', 'nessuna soluzioni',
    // ruso
    'пустое множество', 'нет решений', 'нет решения', 'решений нет', 'нет',
    // chino simplificado
    '无解', '空集', '没有解', '没有实数解', '无实数解',
    // japonés
    '解なし', '解はない', '解がない', '空集合', 'なし',
    // coreano
    '해 없음', '해가 없음', '해가 없다', '해없음', '공집합', '없음',
    // árabe
    'لا يوجد حل', 'لا حل', 'لا توجد حلول', 'مجموعة خالية', 'المجموعة الخالية',
    // hindi
    'कोई हल नहीं', 'हल नहीं', 'कोई समाधान नहीं', 'रिक्त समुच्चय',
  ]),

  /** «Todos los reales» (intervalos). */
  allReals: folded([
    'r', 'ℝ',
    // español
    'reales', 'todos los reales', 'los reales', 'todos los numeros reales', 'los numeros reales', 'numeros reales',
    // inglés
    'all reals', 'all real numbers', 'real numbers', 'reals', 'the reals',
    // portugués
    'todos os reais', 'todos os números reais', 'os reais', 'reais', 'números reais',
    // francés
    'tous les réels', 'tous les nombres réels', 'les réels', 'réels', 'nombres réels',
    // alemán
    'alle reellen zahlen', 'alle reellen', 'reelle zahlen',
    // italiano
    'tutti i reali', 'tutti i numeri reali', 'i reali', 'reali', 'numeri reali',
    // ruso
    'все действительные числа', 'все вещественные числа', 'действительные числа', 'вещественные числа',
    // chino simplificado
    '全体实数', '所有实数', '实数', '全体实数集',
    // japonés
    'すべての実数', '全ての実数', '実数全体', '実数',
    // coreano
    '모든 실수', '실수 전체', '실수',
    // árabe
    'جميع الأعداد الحقيقية', 'كل الأعداد الحقيقية', 'الأعداد الحقيقية',
    // hindi
    'सभी वास्तविक संख्याएँ', 'सभी वास्तविक संख्याएं', 'वास्तविक संख्याएँ', 'वास्तविक संख्याएं',
  ]),

  /**
   * Palabras que separan los valores de una lista («x = 1 o x = 2», «1 ou 2», «1 или 2»). Solo cuentan rodeadas de
   * espacios. No está «e» (italiano, portugués): es el número e.
   */
  listSeparators: folded([
    'o', 'or', 'y', 'and', 'ou', 'et', 'oder', 'und', 'oppure', 'или', 'и', '或', '或者', '和', 'または', 'か', 'と',
    '또는', '혹은', 'أو', 'و', 'या', 'अथवा', 'और',
  ]),

  /** Palabras que unen intervalos («(−∞, 2) ∪ (3, ∞)», «… o …», «… ou …»). */
  unionWords: folded(['u', 'v', 'o', 'or', 'union', 'unión', 'ou', 'oder', 'oppure', 'или', '或', 'または', '또는', 'أو', 'या']),

  /** Palabras que cortan intervalos («x > 2 y x < 5»). No está «e» (italiano, portugués): es el número e. */
  intersectionWords: ['and', 'y', '&&', '∧', 'et', 'und', 'и', '且', 'かつ', '그리고', 'और'] as readonly string[],

  /** Texto escrito → forma comparable: sin comillas ni puntuación en los extremos, espacios simples, sin mayúsculas ni acentos. */
  normalized(text: string): string {
    const cs = chars(text)
    let a = 0
    let b = cs.length
    const isEdge = (c: string): boolean => EDGE_CHARS.has(c) || isWhitespace(c)
    while (a < b && isEdge(cs[a])) a += 1
    while (b > a && isEdge(cs[b - 1])) b -= 1
    return foldedLower(collapse(cs.slice(a, b).join('')))
  },

  /** ¿El texto dice «no existe / indefinido»? */
  saysUndefined(text: string): boolean {
    return AnswerWords.undefined.has(AnswerWords.normalized(text))
  },
}

/**
 * Las mismas palabras para quien valida claves fuera de MathKit (el validador de contenido): una clave «não existe» o
 * «不存在» que el corrector acepta no debe rechazarse al escribir el ejercicio.
 */
export const AnswerVocabulary = {
  /** ¿Dice «no existe / indefinido» en alguno de los 12 idiomas? */
  saysUndefined(text: string): boolean {
    return AnswerWords.saysUndefined(text)
  },
  /** ¿Dice «sin solución / conjunto vacío» en alguno de los 12 idiomas? */
  saysEmpty(text: string): boolean {
    return AnswerWords.empty.has(AnswerWords.normalized(text))
  },
}
