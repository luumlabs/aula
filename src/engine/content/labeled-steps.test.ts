import { describe, expect, it } from 'vitest'
import { decodeBlock, type Block } from '@shared/schema'
import { ContentValidator } from './validator'
import { ContentNormalizer } from './normalizer'

const v = ContentValidator.withMath()
const block = (json: string): Block => decodeBlock(ContentNormalizer.block(JSON.parse(json)))!
const issues = (b: Block) => v.checkBlock(b, 'b').filter((i) => i.path.includes('steps'))
const CELL = '"type":"labeled","alt":"célula","drawing":{"width":400,"height":300,"items":[{"kind":"circle","cx":200,"cy":150,"r":100}]},"parts":[{"id":"n","name":"Núcleo","x":0.5,"y":0.5,"r":0.08},{"id":"m","name":"Membrana","x":0.75,"y":0.5},{"id":"c","name":"Citoplasma","x":0.4,"y":0.7},{"id":"r","name":"Ribosoma","x":0.3,"y":0.3},{"id":"g","name":"Golgi","x":0.62,"y":0.3}]'

describe('validación del recorrido guiado de una figura', () => {
  it('un buen recorrido no da avisos', () => {
    expect(issues(block(`{${CELL},"steps":[{"md":"Todo","parts":[]},{"md":"El núcleo","parts":["n"]},{"md":"La membrana","parts":["m"]}]}`))).toEqual([])
  })

  it('una parte que no existe es un error', () => {
    const e = issues(block(`{${CELL},"steps":[{"md":"a","parts":["n"]},{"md":"b","parts":["mitocondria"]}]}`))
    expect(e.some((i) => i.severity === 'error' && i.message.includes('mitocondria'))).toBe(true)
  })

  it('un solo paso es un aviso; un paso que rodea más de 4 partes, una nota', () => {
    expect(issues(block(`{${CELL},"steps":[{"md":"a","parts":["n"]}]}`)).some((i) => i.severity === 'warning')).toBe(true)
    const many = issues(block(`{${CELL},"steps":[{"md":"a","parts":["n","m","c","r","g"]},{"md":"b","parts":["n"]}]}`))
    expect(many.some((i) => i.severity === 'info' && i.message.includes('5 partes'))).toBe(true)
  })

  it('un paso sin texto es un error; `tour` se lee como `steps`', () => {
    const e = issues(block(`{${CELL},"tour":[{"md":"","parts":["n"]},{"md":"b","parts":["m"]}]}`))
    expect(e.some((i) => i.severity === 'error' && i.message.includes('no explica'))).toBe(true)
  })
})
