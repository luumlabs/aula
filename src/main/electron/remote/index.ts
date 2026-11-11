// Acceso a Aula desde los dispositivos del estudiante: junta el servidor remoto, los dispositivos vinculados y la red
// privada de Tailscale, y guarda si está encendido (`<datos>/Remote/`). Apagado por defecto.
import { app, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RemoteStatus } from '@shared/ipc/remote'
import { aiLocale } from '@shared/ai/i18n'
import { DeviceRegistry } from '@main/services/remote/devices'
import { UploadStore } from '@main/services/remote/uploads'
import { userFiles } from '@main/services/userFiles'
import { writeFileAtomic } from '@main/services/fs'
import { paths } from '@main/services/paths'
import { log } from '@main/services/log'
import { rendererRoot } from '../protocol'
import { emit } from '../rpc'
import { RemoteServer } from './server'
import { Tailnet } from './tailnet'

class RemoteAccess {
  private readonly dir = join(paths.root(), 'Remote')
  private readonly proxyKey = randomBytes(48).toString('base64url')
  private readonly devices = new DeviceRegistry(join(this.dir, 'devices.json'))
  // fuera de la carpeta de datos: de ahí dentro Aula solo acepta materiales de Packs/ y Documents/
  private readonly uploads = new UploadStore(join(app.getPath('temp'), 'Aula Uploads'), { grant: (path) => userFiles.grant(path) })
  private readonly server = new RemoteServer({
    devices: this.devices, uploads: this.uploads, rendererRoot: rendererRoot(), icon: join(__dirname, '../../resources/icon.png'), language: () => aiLocale(), version: app.getVersion(), proxyKey: this.proxyKey,
    onChange: () => { if (!this.devices.pairingOpen()) this.pairing = undefined; this.changed() }
  })
  private readonly tailnet = new Tailnet({ binary: tailnetBinary(), stateDir: join(this.dir, 'tailnet'), proxyKey: this.proxyKey, onChange: () => this.changed() })
  private enabled = false
  private pairing: { code: string; expires: string } | undefined

  /** Al arrancar Aula: si estaba encendido, vuelve a encenderse. */
  async init(): Promise<void> {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')) as { enabled?: unknown }
      if (raw.enabled === true) await this.setEnabled(true)
    } catch { /* primera vez: apagado */ }
  }

  async setEnabled(on: boolean): Promise<RemoteStatus> {
    if (on && !this.enabled) {
      this.uploads.sweep()
      const port = await this.server.start()
      this.tailnet.start(port)
    } else if (!on && this.enabled) {
      this.tailnet.stop()
      this.devices.cancelPairing()
      this.pairing = undefined
      await this.server.stop()
    }
    this.enabled = on
    try {
      mkdirSync(this.dir, { recursive: true })
      writeFileAtomic(join(this.dir, 'state.json'), JSON.stringify({ version: 1, enabled: on }))
    } catch (err) { log.warn('[remoto] no se pudo guardar el estado', err) }
    return this.changed()
  }

  startPairing(): RemoteStatus {
    if (this.enabled) this.pairing = this.devices.startPairing()
    return this.changed()
  }

  cancelPairing(): RemoteStatus {
    this.devices.cancelPairing()
    this.pairing = undefined
    return this.changed()
  }

  revoke(id: string): RemoteStatus {
    this.devices.revoke(id)
    this.uploads.sweep(Date.now(), id)
    return this.changed()
  }

  tailnetLogin(): RemoteStatus {
    const url = this.tailnet.status.authURL
    // solo la página de inicio de sesión de Tailscale, y en el navegador del sistema
    if (url && /^https:\/\/login\.tailscale\.com\//.test(url)) void shell.openExternal(url)
    return this.status()
  }

  tailnetLogout(): RemoteStatus {
    this.tailnet.logout()
    return this.status()
  }

  status(): RemoteStatus {
    const t = this.tailnet.status
    if (this.pairing && Date.parse(this.pairing.expires) <= Date.now()) this.pairing = undefined
    return {
      enabled: this.enabled,
      ...(this.enabled && this.server.running ? { localURL: `http://127.0.0.1:${this.server.port}` } : {}),
      tailnet: { state: this.enabled ? t.state : t.state === 'unavailable' ? 'unavailable' : 'off', ...(t.authURL ? { authURL: t.authURL } : {}), ...(t.name ? { name: t.name } : {}), ...(t.user ? { user: t.user } : {}), ...(t.message ? { message: t.message } : {}) },
      ...(this.enabled && t.state === 'running' ? { deviceURL: `http://${t.name ?? 'aula-mac'}` } : {}),
      devices: this.devices.list(),
      ...(this.pairing ? { pairing: this.pairing } : {}),
      connected: this.server.listeners
    }
  }

  private changed(): RemoteStatus {
    const s = this.status()
    emit('remote.changed', s)
    return s
  }

  async shutdown(): Promise<void> {
    this.tailnet.stop()
    await this.server.stop().catch(() => undefined)
  }
}

/** El componente de Tailscale: dentro de la app empaquetada o, en desarrollo, donde lo deja `native/tsnet/build.sh`. */
function tailnetBinary(): string {
  const packaged = join(process.resourcesPath ?? '', 'bin', 'aula-tsnet')
  if (app.isPackaged) return packaged
  const dev = join(app.getAppPath(), 'native', 'tsnet', 'bin', 'aula-tsnet')
  return existsSync(dev) ? dev : packaged
}

let instance: RemoteAccess | null = null
export function remoteAccess(): RemoteAccess {
  instance ??= new RemoteAccess()
  return instance
}
