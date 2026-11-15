import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FigureRenderJobs } from './render-job'
class Owner extends EventEmitter { destroyed = false; isDestroyed(): boolean { return this.destroyed } }
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { resolve, promise } }
afterEach(() => vi.useRealTimers())
describe('una exportación con propietario y deadline', () => {
  it('reserva antes de validar y rechaza al segundo sin recorrer su DTO', async () => {
    const jobs = new FigureRenderJobs(), a = new Owner(), b = new Owner(), done = deferred<number>(), identify = vi.fn(() => 'other')
    const first = jobs.run(a, () => 'one', async job => job.wait(done.promise))
    await expect(jobs.run(b, identify, async () => 2)).rejects.toMatchObject({ code: 'busy' })
    expect(identify).not.toHaveBeenCalled()
    done.resolve(1); await expect(first).resolves.toBe(1)
    await expect(jobs.run(b, identify, async () => 2)).resolves.toBe(2)
  })
  it('el id no permite cancelar otro objeto emisor y una respuesta tardía no ocupa otro trabajo', async () => {
    const jobs = new FigureRenderJobs(), owner = new Owner(), cleanup = vi.fn(), done = deferred<number>()
    const first = jobs.run(owner, () => 'one', async job => { job.cleanup(cleanup); return job.wait(done.promise) })
    jobs.cancel(new Owner(), 'one'); expect(cleanup).not.toHaveBeenCalled()
    jobs.cancel(owner, 'wrong'); expect(cleanup).not.toHaveBeenCalled()
    jobs.cancel(owner, 'one')
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    expect(cleanup).toHaveBeenCalledTimes(1); expect(owner.listenerCount('destroyed')).toBe(0)
    await expect(jobs.run(owner, () => 'two', async () => 2)).resolves.toBe(2)
    done.resolve(99)
  })
  it('cierre del emisor y timeout destruyen recursos, sin timers ni cola', async () => {
    vi.useFakeTimers()
    const jobs = new FigureRenderJobs(20_000), owner = new Owner(), cleanup = vi.fn()
    const first = jobs.run(owner, () => 'one', async job => { job.cleanup(cleanup); return job.wait(new Promise(() => undefined)) })
    const rejection = expect(first).rejects.toMatchObject({ code: 'render_timeout' })
    await vi.advanceTimersByTimeAsync(20_000); await rejection
    expect(cleanup).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
    const next = jobs.run(owner, () => 'two', async job => { job.cleanup(cleanup); return job.wait(new Promise(() => undefined)) })
    owner.emit('destroyed'); await expect(next).rejects.toMatchObject({ code: 'cancelled' })
    expect(cleanup).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
  })
  it('comprueba tiempo monotónico después de la validación síncrona', async () => {
    let now = 0
    const jobs = new FigureRenderJobs(20, () => now), task = vi.fn(async () => 1)
    await expect(jobs.run(new Owner(), () => { now = 21; return 'one' }, task)).rejects.toMatchObject({ code: 'render_timeout' })
    expect(task).not.toHaveBeenCalled()
  })
  it('mantiene el slot hasta limpiar almacenamiento y libera también cuando falla', async () => {
    const jobs = new FigureRenderJobs(), owner = new Owner(), cleaned = deferred<void>()
    const first = jobs.run(owner, () => 'one', async job => { job.cleanup(() => cleaned.promise); return 1 })
    await Promise.resolve(); await Promise.resolve()
    await expect(jobs.run(owner, () => 'two', async () => 2)).rejects.toMatchObject({ code: 'busy' })
    cleaned.resolve(); await expect(first).resolves.toBe(1)
    await expect(jobs.run(owner, () => 'three', async job => { job.cleanup(async () => { throw new Error('clear failed') }); return 3 })).rejects.toThrow('clear failed')
    await expect(jobs.run(owner, () => 'four', async () => 4)).resolves.toBe(4)
  })
})
