import { describe, expect, it } from 'vitest'
import { defaultAISettings, parseDailyBudget } from './ai'

describe('tope de gasto diario', () => {
  it('apagado por defecto', () => {
    expect(defaultAISettings().dailyBudgetUSD).toBe(0)
  })
  it('entiende coma o punto decimal y el símbolo del dólar', () => {
    expect(parseDailyBudget('2')).toBe(2)
    expect(parseDailyBudget('1,5')).toBe(1.5)
    expect(parseDailyBudget(' 0.75 ')).toBe(0.75)
    expect(parseDailyBudget('3 US$')).toBe(3)
    expect(parseDailyBudget('$4.256')).toBe(4.26)
    expect(parseDailyBudget('.5')).toBe(0.5)
  })
  it('rechaza lo que no es un tope posible', () => {
    for (const bad of ['', '0', '-1', 'abc', '1e3', '20000', '1,5,2', 'Infinity']) expect(parseDailyBudget(bad)).toBeNull()
  })
})
