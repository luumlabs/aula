import { describe, expect, it } from 'vitest'
import { parseSmiles, parseStructure, withExplicitHydrogens } from './smiles'
import { layoutQuality, layoutStructure, type Pt } from './structure-layout'

const MOLECULES: Record<string, string> = {
  ethanol: 'CCO',
  hexane: 'CCCCCC',
  benzene: 'c1ccccc1',
  naphthalene: 'c1ccc2ccccc2c1',
  caffeine: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C',
  caffeineAromatic: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C',
  aspirin: 'CC(=O)OC1=CC=CC=C1C(=O)O',
  ibuprofen: 'CC(C)CC1=CC=C(C=C1)C(C)C(=O)O',
  paracetamol: 'CC(=O)NC1=CC=C(C=C1)O',
  glucoseChain: 'OC[C@@H](O)[C@@H](O)[C@H](O)[C@@H](O)C=O',
  glucoseRing: 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O',
  cholesterol: 'C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C',
  biphenyl: 'c1ccccc1-c1ccccc1',
  spiro: 'C1CCC2(C1)CCCCC2',
  toluene: 'Cc1ccccc1',
  phenol: 'Oc1ccccc1',
  cyclohexane: 'C1CCCCC1'
}

const dist = (p: Pt, q: Pt): number => Math.hypot(p[0] - q[0], p[1] - q[1])
const angleAt = (pos: Pt[], a: number, b: number, c: number): number => {
  const u = [pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]]
  const v = [pos[c][0] - pos[b][0], pos[c][1] - pos[b][1]]
  return (Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]))) * 180) / Math.PI
}

describe('disposición 2D', () => {
  it.each(Object.entries(MOLECULES))('%s: enlaces de 1 y átomos separados', (_, smiles) => {
    const mol = parseSmiles(smiles)
    const layout = layoutStructure(mol)
    for (const b of mol.bonds) expect(Math.abs(dist(layout.pos[b.a], layout.pos[b.b]) - 1)).toBeLessThan(0.02)
    const q = layoutQuality(mol, layout)
    expect(q.minAtomDistance).toBeGreaterThan(0.6)
    expect(q.crossings).toBe(0)
    expect(q.deformed).toBe(false)
  })

  it('los átomos de cada anillo están a la misma distancia de su centro', () => {
    for (const smiles of [MOLECULES.naphthalene, MOLECULES.caffeine, MOLECULES.cholesterol]) {
      const mol = parseSmiles(smiles)
      const { pos } = layoutStructure(mol)
      for (const ring of mol.rings) {
        const c: Pt = [ring.reduce((s, a) => s + pos[a][0], 0) / ring.length, ring.reduce((s, a) => s + pos[a][1], 0) / ring.length]
        const r = ring.map((a) => dist(pos[a], c))
        expect(Math.max(...r) - Math.min(...r)).toBeLessThan(0.02)
      }
    }
  })

  it('O=C=O y CC#N son lineales', () => {
    expect(angleAt(layoutStructure(parseSmiles('O=C=O')).pos, 0, 1, 2)).toBeCloseTo(180, 3)
    expect(angleAt(layoutStructure(parseSmiles('CC#N')).pos, 0, 1, 2)).toBeCloseTo(180, 3)
  })

  it('una cadena va a lo ancho en zigzag de 120°', () => {
    const { pos } = layoutStructure(parseSmiles('CCCCCC'))
    const xs = pos.map((p) => p[0])
    const ys = pos.map((p) => p[1])
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys))
    for (let i = 1; i < 5; i++) expect(angleAt(pos, i - 1, i, i + 1)).toBeCloseTo(120, 3)
    // los enlaces, a ±30° como en los libros
    for (let i = 0; i < 5; i++) {
      const a = (Math.atan2(pos[i + 1][1] - pos[i][1], pos[i + 1][0] - pos[i][0]) * 180) / Math.PI
      expect(Math.abs(Math.abs(a) - 30)).toBeLessThan(0.5)
    }
  })

  it('el primer átomo queda a la izquierda (CCO: el OH a la derecha)', () => {
    const { pos } = layoutStructure(parseSmiles('CCO'))
    expect(pos[0][0]).toBeLessThan(pos[2][0])
  })

  it('el benceno solo, con un vértice arriba', () => {
    const { pos } = layoutStructure(parseSmiles('c1ccccc1'))
    const top = Math.max(...pos.map((p) => p[1]))
    expect(pos.filter((p) => Math.abs(p[1] - top) < 1e-6)).toHaveLength(1)
  })

  it('las partes separadas («.») quedan a 1,6 o más', () => {
    const { pos, parts } = layoutStructure(parseSmiles('[Na+].[Cl-]'))
    expect(parts).toHaveLength(2)
    expect(dist(pos[0], pos[1])).toBeGreaterThanOrEqual(1.6)
  })

  it('cada parte de una reacción o de una mezcla se dibuja igual que sola (las partes ya hechas no estorban)', () => {
    /** Distancias entre todos los átomos de `atoms` (no cambian al mover, girar o reflejar la parte). */
    const shape = (pos: Pt[], atoms: number[]): number[] => atoms.flatMap((a, i) => atoms.slice(i + 1).map((b) => dist(pos[a], pos[b])))
    const cases: Array<[string, string[]]> = [
      ['CCOC(C)=O.O>>CCO.CC(O)=O', ['CCOC(C)=O', 'O', 'CCO', 'CC(O)=O']],
      ['c1ccccc1.O=[N+]([O-])O>>O=[N+]([O-])c1ccccc1.O', ['c1ccccc1', 'O=[N+]([O-])O', 'O=[N+]([O-])c1ccccc1', 'O']],
      ['C=CC.BrBr>>CC(Br)CBr', ['C=CC', 'BrBr', 'CC(Br)CBr']],
      ['CC(C)(C)Br.O>>CC(C)(C)O.Br', ['CC(C)(C)Br', 'O', 'CC(C)(C)O', 'Br']],
      ['CCCC.CC(C)C', ['CCCC', 'CC(C)C']]
    ]
    for (const straight of [false, true]) {
      for (const [smiles, alone] of cases) {
        const mol = parseStructure(smiles).molecule
        const { pos, parts } = layoutStructure(mol, { straight })
        expect(parts, smiles).toHaveLength(alone.length)
        parts.forEach((part, k) => {
          const single = layoutStructure(parseSmiles(alone[k]), { straight }).pos
          const want = shape(single, part.map((_, i) => i))
          const got = shape(pos, part)
          got.forEach((d, i) => expect(d, `${smiles} · ${alone[k]}${straight ? ' (recta)' : ''}`).toBeCloseTo(want[i], 6))
        })
      }
    }
  })

  it('marca los sistemas con puentes (norbornano, adamantano)', () => {
    for (const s of ['C1CC2CCC1C2', 'C1C2CC3CC1CC(C2)C3']) {
      const mol = parseSmiles(s)
      const q = layoutQuality(mol, layoutStructure(mol))
      expect(q.bridged || q.deformed).toBe(true)
    }
  })

  it('es determinista (cafeína, coordenadas redondeadas)', () => {
    const round = (s: string): string => layoutStructure(parseSmiles(s)).pos.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')
    expect(round(MOLECULES.caffeine)).toBe(round(MOLECULES.caffeine))
    expect(round(MOLECULES.caffeine)).toBe(
      '0.00,0.92 0.98,1.13 1.38,2.04 2.38,1.94 2.59,0.96 1.72,0.46 1.72,-0.54 0.86,-1.04 2.59,-1.04 3.45,-0.54 4.32,-1.04 3.45,0.46 4.32,0.96 2.59,-2.04'
    )
  })
})

describe('cis/trans', () => {
  const sameSide = (smiles: string, x: number, c1: number, c2: number, y: number): boolean => {
    const { pos } = layoutStructure(parseSmiles(smiles))
    const ax = [pos[c2][0] - pos[c1][0], pos[c2][1] - pos[c1][1]]
    const cross = (o: Pt, q: Pt): number => ax[0] * (q[1] - o[1]) - ax[1] * (q[0] - o[0])
    return cross(pos[c1], pos[x]) * cross(pos[c2], pos[y]) > 0
  }
  it('but-2-eno cis y trans', () => {
    expect(sameSide('C/C=C\\C', 0, 1, 2, 3)).toBe(true)
    expect(sameSide('C/C=C/C', 0, 1, 2, 3)).toBe(false)
  })
  it('1,2-difluoroeteno', () => {
    expect(sameSide('F/C=C/F', 0, 1, 2, 3)).toBe(false)
    expect(sameSide('F/C=C\\F', 0, 1, 2, 3)).toBe(true)
    expect(sameSide('C(/F)=C/F', 1, 0, 2, 3)).toBe(true)
  })
  it('ácido oleico (cis) y elaídico (trans)', () => {
    const oleic = 'CCCCCCCC/C=C\\CCCCCCCC(=O)O'
    const elaidic = 'CCCCCCCC/C=C/CCCCCCCC(=O)O'
    expect(sameSide(oleic, 7, 8, 9, 10)).toBe(true)
    expect(sameSide(elaidic, 7, 8, 9, 10)).toBe(false)
    const mol = parseSmiles(oleic)
    expect(layoutQuality(mol, layoutStructure(mol)).minAtomDistance).toBeGreaterThan(0.6)
  })
  it('los dobles enlaces de un anillo no se tocan', () => {
    const mol = parseSmiles('C1=C/CCCC1')
    expect(layoutQuality(mol, layoutStructure(mol)).deformed).toBe(false)
  })
  it('el repaso que separa las ramas no pasa un cis apretado a trans (cis-di-terc-butileteno, ácido maleico sustituido)', () => {
    expect(sameSide('CC(C)(C)/C=C\\C(C)(C)C', 1, 4, 5, 6)).toBe(true)
    expect(sameSide('CC(C)(C)/C=C/C(C)(C)C', 1, 4, 5, 6)).toBe(false)
    expect(sameSide('CC(C)(C)C(C)(C)/C=C\\C(C)(C)C(C)(C)C', 4, 7, 8, 9)).toBe(true)
    expect(sameSide('O=C(O)C(C(=O)O)/C=C\\C(C(=O)O)C(=O)O', 3, 7, 8, 9)).toBe(true)
    for (const smiles of ['CC(C)(C)/C=C\\C(C)(C)C', 'CC(C)(C)C(C)(C)/C=C\\C(C)(C)C(C)(C)C']) {
      const mol = parseSmiles(smiles)
      expect(layoutQuality(mol, layoutStructure(mol)).deformed, smiles).toBe(false)
    }
  })
  it('con anillos a los dos lados también: cis-estilbeno y cis-azobenceno', () => {
    expect(sameSide('c1ccccc1/C=C\\c1ccccc1', 5, 6, 7, 8)).toBe(true)
    expect(sameSide('c1ccccc1/C=C/c1ccccc1', 5, 6, 7, 8)).toBe(false)
    expect(sameSide('c1ccccc1/N=N\\c1ccccc1', 5, 6, 7, 8)).toBe(true)
    const mol = parseSmiles('c1ccccc1/C=C\\c1ccccc1')
    const layout = layoutStructure(mol)
    expect(layoutQuality(mol, layout).deformed).toBe(false)
    // los anillos siguen siendo hexágonos regulares
    for (const b of mol.bonds) expect(Math.abs(dist(layout.pos[b.a], layout.pos[b.b]) - 1)).toBeLessThan(0.02)
  })
})

describe('cadenas rectas (semidesarrollada y desarrollada)', () => {
  it('etanol desarrollado: cadena recta con los H arriba y abajo', () => {
    const mol = withExplicitHydrogens(parseSmiles('CCO'))
    const { pos } = layoutStructure(mol, { straight: true })
    expect(angleAt(pos, 0, 1, 2)).toBeCloseTo(180, 3)
    for (const b of mol.bonds) expect(Math.abs(dist(pos[b.a], pos[b.b]) - 1)).toBeLessThan(0.02)
    expect(layoutQuality(mol, { pos, rings: [], parts: [] }).minAtomDistance).toBeGreaterThan(0.9)
  })
  it('metano desarrollado: los cuatro H a 90°', () => {
    const mol = withExplicitHydrogens(parseSmiles('C'))
    const { pos } = layoutStructure(mol, { straight: true })
    const angles = [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]].map(([a, b]) => Math.round(angleAt(pos, a, 0, b)))
    expect(angles.sort()).toEqual([180, 180, 90, 90, 90, 90].sort())
  })
  it('la rama sale a 90° y la cadena principal sigue recta', () => {
    const { pos } = layoutStructure(parseSmiles('CC(C)CC'), { straight: true })
    expect(angleAt(pos, 0, 1, 3)).toBeCloseTo(180, 3)
    expect(angleAt(pos, 0, 1, 2)).toBeCloseTo(90, 3)
  })
})

describe('moléculas lineales', () => {
  it('C=C, C#C y O=C=O quedan tumbadas, de izquierda a derecha', () => {
    for (const s of ['C=C', 'C#C', 'O=C=O', 'CC#N', 'N#N']) {
      const { pos } = layoutStructure(parseSmiles(s))
      for (const p of pos) expect(Math.abs(p[1] - pos[0][1])).toBeLessThan(1e-6)
      expect(pos[0][0]).toBeLessThan(pos[pos.length - 1][0])
    }
  })
})

describe('nada encimado: moléculas de clase', () => {
  const REAL: Record<string, string> = {
    '1,1-dimetilciclohexano': 'CC1(C)CCCCC1',
    '1,1-dimetilciclohexano (PubChem)': 'CC1(CCCCC1)C',
    '1-etil-1-metilciclohexano': 'CCC1(C)CCCCC1',
    '1-metilciclohexanol': 'CC1(O)CCCCC1',
    '1,1-dimetilciclopropano': 'CC1(C)CC1',
    'α-terpineol': 'CC1(CCC(CC1)C(C)C)O',
    'terc-butanol': 'CC(C)(C)O',
    testosterona: 'CC12CCC3C(C1CCC2O)CCC4=CC(=O)CCC34C',
    estradiol: 'CC12CCC3C(C1CCC2O)CCC4=C3C=CC(=C4)O',
    cortisol: 'CC12CCC(=O)C=C1CCC3C2C(CC4(C3CCC4(C(=O)CO)O)C)O',
    colesterol: MOLECULES.cholesterol,
    'penicilina G': 'CC1(C)S[C@@H]2[C@H](C(=O)N2[C@H]1C(=O)O)NC(=O)Cc1ccccc1',
    amoxicilina: 'CC1(C(N2C(S1)C(C2=O)NC(=O)C(C3=CC=C(C=C3)O)N)C(=O)O)C',
    glucosa: MOLECULES.glucoseRing,
    sacarosa: 'C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O',
    lactosa: 'C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O[C@@H]2[C@H](O[C@H]([C@@H]([C@H]2O)O)O)CO)O)O)O)O',
    EDTA: 'C(CN(CC(=O)O)CC(=O)O)N(CC(=O)O)CC(=O)O',
    oseltamivir: 'CCC(CC)OC1C=C(CC(C1NC(=O)C)N)C(=O)OCC',
    'vitamina E': 'CC1=C(C2=C(CCC(O2)(C)CCCC(C)CCCC(C)CCCC(C)C)C(=C1O)C)C'
  }
  it.each(Object.entries(REAL))('%s: esquelética y semidesarrollada sin átomos encimados', (_, smiles) => {
    const mol = parseSmiles(smiles)
    for (const straight of [false, true]) {
      const layout = layoutStructure(mol, { straight })
      for (const b of mol.bonds) expect(Math.abs(dist(layout.pos[b.a], layout.pos[b.b]) - 1)).toBeLessThan(0.02)
      const q = layoutQuality(mol, layout)
      expect(q.deformed, `${straight ? 'recta' : 'zigzag'}: ${q.minAtomDistance.toFixed(2)}`).toBe(false)
      expect(q.minAtomDistance).toBeGreaterThan(0.7)
    }
  })

  it('el gem-dimetilo: los dos metilos a 60° entre sí y fuera del anillo, empiece la SMILES por donde empiece', () => {
    for (const [smiles, c, m1, m2, r1, r2] of [['CC1(C)CCCCC1', 1, 0, 2, 3, 7], ['C1CCCCC1(C)C', 5, 6, 7, 0, 4], ['CC1(CCCCC1)C', 1, 0, 7, 2, 6]] as const) {
      const { pos } = layoutStructure(parseSmiles(smiles))
      expect(angleAt(pos, m1, c, m2), smiles).toBeCloseTo(60, 3)
      for (const m of [m1, m2]) for (const r of [r1, r2]) expect(angleAt(pos, m, c, r), smiles).toBeGreaterThanOrEqual(89.9)
    }
  })

  it('un OH terciario de anillo no se queda debajo del metilo (1-metilciclohexanol)', () => {
    const { pos } = layoutStructure(parseSmiles('CC1(O)CCCCC1'))
    expect(dist(pos[0], pos[2])).toBeCloseTo(1, 3)
  })

  it('el metilo angular de un esteroide, en el hueco que dejan los anillos', () => {
    // testosterona: el C18 (átomo 1) cuelga del C13 (átomo 2), unión de los anillos C (6) y D (5)
    const mol = parseSmiles('CC12CCC3C(C1CCC2O)CCC4=CC(=O)CCC34C')
    const { pos } = layoutStructure(mol)
    const ringNeighbours = mol.bonds.filter((b) => (b.a === 1 || b.b === 1) && b.a !== 0 && b.b !== 0).map((b) => (b.a === 1 ? b.b : b.a))
    expect(ringNeighbours).toHaveLength(3)
    for (const r of ringNeighbours) expect(angleAt(pos, 0, 1, r)).toBeGreaterThan(60)
  })

  it('las ramas que se encuentran se separan (EDTA, sacarosa) sin tocar la geometría cis/trans', () => {
    for (const smiles of [REAL.EDTA, REAL.sacarosa]) expect(layoutQuality(parseSmiles(smiles), layoutStructure(parseSmiles(smiles))).minAtomDistance).toBeGreaterThan(0.7)
    // ácido oleico con las ramas apretadas alrededor: sigue cis
    const oleicLike = 'CC(C)(C)CCCCCC/C=C\\CCCCCCCC(=O)O'
    const { pos } = layoutStructure(parseSmiles(oleicLike))
    const [c1, c2, x, y] = [10, 11, 9, 12]
    const ax = [pos[c2][0] - pos[c1][0], pos[c2][1] - pos[c1][1]]
    const cross = (o: Pt, q: Pt): number => ax[0] * (q[1] - o[1]) - ax[1] * (q[0] - o[0])
    expect(cross(pos[c1], pos[x]) * cross(pos[c2], pos[y])).toBeGreaterThan(0)
  })

  it('sigue marcando lo que no tiene arreglo en plano (morfina, con puentes)', () => {
    const mol = parseSmiles('CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O')
    const q = layoutQuality(mol, layoutStructure(mol))
    expect(q.bridged && q.deformed).toBe(true)
  })
})

describe('desarrollada: los H no se pisan', () => {
  const SCHOOL: Record<string, string> = {
    etanol: 'CCO', isobutano: 'CC(C)C', acetona: 'CC(C)=O', neopentano: 'CC(C)(C)C', 'terc-butanol': 'CC(C)(C)O', '2-metilbutano': 'CC(C)CC',
    '2,2-dimetilbutano': 'CCC(C)(C)C', metilciclohexano: 'CC1CCCCC1', ciclohexanol: 'OC1CCCCC1', '1-metilciclohexanol': 'CC1(O)CCCCC1',
    '1,1-dimetilciclohexano': 'CC1(C)CCCCC1', 'ácido cítrico': 'C(C(=O)O)C(CC(=O)O)(C(=O)O)O', glucosa: MOLECULES.glucoseRing,
    'glucosa abierta': MOLECULES.glucoseChain, limoneno: 'CC1=CCC(CC1)C(=C)C', ibuprofeno: MOLECULES.ibuprofen
  }
  it.each(Object.entries(SCHOOL))('%s', (_, smiles) => {
    const mol = withExplicitHydrogens(parseSmiles(smiles))
    const layout = layoutStructure(mol, { straight: true })
    const q = layoutQuality(mol, layout)
    expect(q.deformed, q.minAtomDistance.toFixed(2)).toBe(false)
    // ningún átomo dentro de un anillo
    for (const ring of mol.rings) {
      const c: Pt = [ring.reduce((s, a) => s + layout.pos[a][0], 0) / ring.length, ring.reduce((s, a) => s + layout.pos[a][1], 0) / ring.length]
      for (let a = 0; a < mol.atoms.length; a++) if (!ring.includes(a)) expect(dist(layout.pos[a], c)).toBeGreaterThan(0.8)
    }
  })
  it('isobutano: los H del metilo de la rama se abren en abanico, sin caer sobre los de los vecinos', () => {
    const mol = withExplicitHydrogens(parseSmiles('CC(C)C'))
    expect(layoutQuality(mol, layoutStructure(mol, { straight: true })).minAtomDistance).toBeGreaterThan(0.75)
  })
})
