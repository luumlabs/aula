// Grupo de pestañas de lectura ocultas: una por (cuenta, nombre), como mucho `max` a la vez (se cierra la más antigua ociosa) y
// cada una se cierra sola tras unos minutos sin uso (las ventanas ocultas no deben impedir que la app se cierre ni gastar
// memoria). Al cerrar la ventana principal se cierran todas.
import type { PlatformAccount } from '@shared/settings/platforms'
import { AulaError } from '@main/services/errors'
import { tr } from '@shared/ai/i18n'
import { getMainWindow } from '../window'
import { ReaderTab } from './tab'

export interface TabRef {
  /** Cuenta cuya sesión se usa (null = sin cuenta, sesión en memoria). */
  accountId: string | null
  /** Nombre de la pestaña (varias pestañas con nombre comparten la sesión de la cuenta). */
  tab?: string
}

function keyOf(ref: TabRef): string {
  const name = (ref.tab ?? 'main').trim() || 'main'
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) throw new AulaError('invalid_args', tr('Nombre de pestaña no válido.', 'Invalid tab name.'))
  return `${ref.accountId ?? '~web'}|${name}`
}

export class ReaderPool {
  private tabs = new Map<string, ReaderTab>()
  private sweeper: ReturnType<typeof setInterval> | null = null
  private hookedMain = new Set<number>()

  constructor(private readonly accountOf: (id: string) => PlatformAccount | null, private readonly max = 4, private readonly idleMs = 3 * 60_000) {}

  /** La pestaña (existente o nueva). */
  get(ref: TabRef): ReaderTab {
    const key = keyOf(ref)
    const existing = this.tabs.get(key)
    if (existing && !existing.closed) return existing
    this.makeRoom()
    const accountId = ref.accountId
    const tab = new ReaderTab(accountId, (ref.tab ?? 'main').trim() || 'main', () => (accountId ? this.accountOf(accountId) : null))
    tab.whenClosed(() => {
      if (this.tabs.get(key) === tab) this.tabs.delete(key)
    })
    this.tabs.set(key, tab)
    this.ensureSweeper()
    this.hookMainWindow()
    return tab
  }

  /** La pestaña si ya existe (para leer la página actual sin abrir otra). */
  peek(ref: TabRef): ReaderTab | null {
    const t = this.tabs.get(keyOf(ref))
    return t && !t.closed ? t : null
  }

  /** La pestaña con ese nombre usada más recientemente, de cualquier cuenta (cuando quien llama no dice la cuenta). */
  latest(name?: string): ReaderTab | null {
    const n = (name ?? 'main').trim() || 'main'
    let best: ReaderTab | null = null
    for (const t of this.tabs.values()) if (!t.closed && t.name === n && (!best || t.lastUsed > best.lastUsed)) best = t
    return best
  }

  close(ref: TabRef): void {
    this.tabs.get(keyOf(ref))?.close()
    this.tabs.delete(keyOf(ref))
  }

  closeAccount(accountId: string): void {
    for (const [k, t] of [...this.tabs]) {
      if (t.accountId === accountId) {
        t.close()
        this.tabs.delete(k)
      }
    }
  }

  closeAll(): void {
    for (const t of this.tabs.values()) t.close()
    this.tabs.clear()
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
  }

  size(): number {
    return this.tabs.size
  }

  private makeRoom(): void {
    while (this.tabs.size >= this.max) {
      const idle = [...this.tabs.entries()].filter(([, t]) => !t.busy).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
      if (!idle) throw new AulaError('busy', tr('Hay demasiadas páginas abiertas a la vez; espera un momento.', 'Too many pages are open at once; wait a moment.'))
      idle[1].close()
      this.tabs.delete(idle[0])
    }
  }

  private ensureSweeper(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => this.sweep(), 30_000)
    this.sweeper.unref?.()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [k, t] of [...this.tabs]) {
      if (t.closed || (!t.busy && now - t.lastUsed > this.idleMs)) {
        t.close()
        this.tabs.delete(k)
      }
    }
    if (this.tabs.size === 0 && this.sweeper) {
      clearInterval(this.sweeper)
      this.sweeper = null
    }
  }

  /** Con la ventana principal cerrada, las ocultas sobran (y así «cerrar todas las ventanas» cierra la app en Windows/Linux). */
  private hookMainWindow(): void {
    const main = getMainWindow()
    if (!main || this.hookedMain.has(main.id)) return
    this.hookedMain.add(main.id)
    main.once('closed', () => this.closeAll())
  }
}
