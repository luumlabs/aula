import { describe, expect, it } from 'vitest'
import { remoteCall } from './policy'

describe('figuras sólo en el escritorio local', () => {
  it.each(['figures.save', 'figures.revealSaved', 'figures.renderDrawingPng', 'figures.cancelRender'])('niega %s a dispositivos y propietarios del servidor', method => {
    for (const owner of [false, true]) expect(remoteCall(method, { path: '/tmp/no.svg' }, { owner }).verdict).toBe('deny')
  })
})
