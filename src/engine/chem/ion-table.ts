// Tabla de iones comunes (91: 39 cationes y 52 aniones) con sus nombres en español. Es la base de la nomenclatura y del
// reparto de números de oxidación en sales (NH4NO3, Fe2(SO4)3, K4[Fe(CN)6]).

import { Formula, type Composition } from './formula'

export type IonKind = 'cation' | 'anion'

/** Ion de la tabla de nomenclatura. */
export interface ChemIon {
  /** Fórmula en texto plano analizable («SO4^2-»). */
  readonly formulaText: string
  readonly kind: IonKind
  /** Nombre principal en español (Stock para los cationes de metales con varias cargas: «hierro(III)»). */
  readonly name: string
  /** Nombre tradicional (-oso/-ico, «férrico») o habitual alternativo («bicarbonato»), si lo hay. */
  readonly traditionalName: string | null
  /** Otros nombres aceptados al leer («hidrogenocarbonato», «bicarbonato», «etanoato»). */
  readonly otherNames: readonly string[]
}

const cat = (f: string, name: string, trad: string | null = null, other: string[] = []): ChemIon => ({
  formulaText: f, kind: 'cation', name, traditionalName: trad, otherNames: other,
})
const an = (f: string, name: string, trad: string | null = null, other: string[] = []): ChemIon => ({
  formulaText: f, kind: 'anion', name, traditionalName: trad, otherNames: other,
})

const CATIONS: readonly ChemIon[] = [
  cat('H^+', 'hidrógeno', null, ['hidron', 'protón', 'proton']),
  cat('Li^+', 'litio'), cat('Na^+', 'sodio'), cat('K^+', 'potasio'), cat('Rb^+', 'rubidio'), cat('Cs^+', 'cesio'),
  cat('Ag^+', 'plata'), cat('NH4^+', 'amonio'), cat('H3O^+', 'hidronio', null, ['oxonio']),
  cat('Be^2+', 'berilio'), cat('Mg^2+', 'magnesio'), cat('Ca^2+', 'calcio'), cat('Sr^2+', 'estroncio'), cat('Ba^2+', 'bario'),
  cat('Zn^2+', 'zinc', null, ['cinc']), cat('Cd^2+', 'cadmio'), cat('Al^3+', 'aluminio'),
  cat('Cu^+', 'cobre(I)', 'cuproso'), cat('Cu^2+', 'cobre(II)', 'cúprico'),
  cat('Fe^2+', 'hierro(II)', 'ferroso'), cat('Fe^3+', 'hierro(III)', 'férrico'),
  cat('Co^2+', 'cobalto(II)', 'cobaltoso'), cat('Co^3+', 'cobalto(III)', 'cobáltico'),
  cat('Ni^2+', 'níquel(II)', 'niqueloso'), cat('Ni^3+', 'níquel(III)', 'niquélico'),
  cat('Sn^2+', 'estaño(II)', 'estannoso'), cat('Sn^4+', 'estaño(IV)', 'estánnico'),
  cat('Pb^2+', 'plomo(II)', 'plumboso'), cat('Pb^4+', 'plomo(IV)', 'plúmbico'),
  cat('Hg2^2+', 'mercurio(I)', 'mercurioso'), cat('Hg^2+', 'mercurio(II)', 'mercúrico'),
  cat('Mn^2+', 'manganeso(II)', 'manganoso'), cat('Mn^3+', 'manganeso(III)', 'mangánico'),
  cat('Cr^2+', 'cromo(II)', 'cromoso'), cat('Cr^3+', 'cromo(III)', 'crómico'),
  cat('Au^+', 'oro(I)', 'auroso'), cat('Au^3+', 'oro(III)', 'áurico'),
  cat('Pt^2+', 'platino(II)', 'platinoso'), cat('Pt^4+', 'platino(IV)', 'platínico'),
]

const ANIONS: readonly ChemIon[] = [
  an('H^-', 'hidruro'), an('F^-', 'fluoruro'), an('Cl^-', 'cloruro'), an('Br^-', 'bromuro'), an('I^-', 'yoduro'),
  an('O^2-', 'óxido'), an('S^2-', 'sulfuro'), an('Se^2-', 'seleniuro'), an('Te^2-', 'telururo'),
  an('N^3-', 'nitruro'), an('P^3-', 'fosfuro'), an('As^3-', 'arseniuro'), an('C^4-', 'carburo'),
  an('OH^-', 'hidróxido'), an('CN^-', 'cianuro'), an('SCN^-', 'tiocianato'), an('N3^-', 'azida', null, ['azoturo']),
  an('O2^2-', 'peróxido'), an('O2^-', 'superóxido'), an('S2^2-', 'disulfuro'), an('C2^2-', 'acetiluro', null, ['carburo']),
  an('NO3^-', 'nitrato'), an('NO2^-', 'nitrito'),
  an('SO4^2-', 'sulfato'), an('SO3^2-', 'sulfito'), an('HSO4^-', 'hidrogenosulfato', 'bisulfato', ['sulfato acido']),
  an('HSO3^-', 'hidrogenosulfito', 'bisulfito'), an('S2O3^2-', 'tiosulfato'), an('HS^-', 'hidrogenosulfuro', 'bisulfuro'),
  an('PO4^3-', 'fosfato'), an('HPO4^2-', 'hidrogenofosfato'), an('H2PO4^-', 'dihidrogenofosfato'),
  an('CO3^2-', 'carbonato'), an('HCO3^-', 'hidrogenocarbonato', 'bicarbonato', ['carbonato acido']),
  an('C2O4^2-', 'oxalato'), an('CH3COO^-', 'acetato', null, ['etanoato']),
  an('ClO^-', 'hipoclorito'), an('ClO2^-', 'clorito'), an('ClO3^-', 'clorato'), an('ClO4^-', 'perclorato'),
  an('BrO^-', 'hipobromito'), an('BrO3^-', 'bromato'), an('IO3^-', 'yodato'), an('IO4^-', 'peryodato'),
  an('MnO4^-', 'permanganato'), an('MnO4^2-', 'manganato'), an('CrO4^2-', 'cromato'), an('Cr2O7^2-', 'dicromato'),
  an('BO3^3-', 'borato'), an('AsO4^3-', 'arseniato', null, ['arsenato']),
  an('[Fe(CN)6]^4-', 'hexacianoferrato(II)', 'ferrocianuro'), an('[Fe(CN)6]^3-', 'hexacianoferrato(III)', 'ferricianuro'),
]

/** Composición por número atómico (los isótopos cuentan como su elemento). */
export function elementComposition(c: Composition): Map<number, number> {
  const d = new Map<number, number>()
  for (const [k, n] of c) d.set(k.atomicNumber, (d.get(k.atomicNumber) ?? 0) + n)
  return d
}

/** `true` si dos composiciones por Z son iguales. */
export function zCompositionsEqual(a: ReadonlyMap<number, number>, b: ReadonlyMap<number, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, n] of a) if (b.get(k) !== n) return false
  return true
}

let parsedCache: { ion: ChemIon; formula: Formula }[] | null = null

export const IonTable = {
  cations: CATIONS,
  anions: ANIONS,
  /** Todos los iones de la tabla. */
  all: [...CATIONS, ...ANIONS] as readonly ChemIon[],

  /** Iones analizados (se calculan una vez, al primer uso). */
  get parsed(): readonly { ion: ChemIon; formula: Formula }[] {
    if (!parsedCache) {
      parsedCache = []
      for (const ion of IonTable.all) {
        try {
          parsedCache.push({ ion, formula: Formula.parse(ion.formulaText) })
        } catch {
          // todas las fórmulas de la tabla se leen (lo comprueba una prueba)
        }
      }
    }
    return parsedCache
  },

  /** Fórmula analizada de un ion de la tabla. */
  formulaOf(ion: ChemIon): Formula {
    return IonTable.parsed.find((p) => p.ion === ion)?.formula ?? Formula.electron
  },

  /** Ion con la misma especie (mismos átomos y carga). */
  matching(formula: Formula): ChemIon | null {
    for (const p of IonTable.parsed) {
      if (p.formula.charge !== formula.charge || p.formula.composition.size !== formula.composition.size) continue
      let same = true
      for (const [k, n] of p.formula.composition) if (formula.composition.get(k) !== n) same = false
      if (same) return p.ion
    }
    return null
  },

  /** Aniones cuya composición coincide (puede haber varios con distinta carga: MnO4⁻ y MnO4²⁻). */
  anionsWithComposition(comp: ReadonlyMap<number, number>): { ion: ChemIon; formula: Formula }[] {
    return IonTable.parsed.filter((p) => p.ion.kind === 'anion' && zCompositionsEqual(elementComposition(p.formula.composition), comp))
  },
}
