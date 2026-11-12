// Acceso a Aula desde los dispositivos del estudiante: junta el servidor remoto, los dispositivos vinculados y la red
// privada de Tailscale, y guarda si está encendido (`<datos>/Remote/`). Apagado por defecto.
// Aula como servidor (`--server`, sin ventana): siempre encendido, con el nombre «aula-server» en la red de Tailscale de quien
// la instaló, y la consola (la salida estándar del proceso y `aula-server`) dice qué hacer: iniciar sesión en Tailscale y
// vincular el primer dispositivo, que será el propietario.
import { app, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { RemoteStatus } from '@shared/ipc/remote'
import { aiLocale, tr } from '@shared/ai/i18n'
import { DeviceRegistry } from '@main/services/remote/devices'
import { UploadStore } from '@main/services/remote/uploads'
import { isServerMode, serverHostname } from '@main/services/remote/server-mode'
import { userFiles } from '@main/services/userFiles'
import { writeFileAtomic } from '@main/services/fs'
import { paths } from '@main/services/paths'
import { log } from '@main/services/log'
import { rendererRoot } from '../protocol'
import { emit } from '../rpc'
import { RemoteServer } from './server'
import { Tailnet } from './tailnet'

/** Una línea en la consola del servidor (y en el registro). */
function say(line: string): void {
  log.info('[servidor]', line)
  try { process.stdout.write(`Aula · ${line}\n`) } catch { /* sin salida */ }
}

/** El identificador de esta instalación para su cookie (estable entre arranques). */
function installId(dir: string): string {
  const file = join(dir, 'install-id')
  try {
    const id = readFileSync(file, 'utf8').trim()
    if (/^[a-f0-9]{12}$/.test(id)) return id
  } catch { /* primera vez */ }
  const id = randomBytes(6).toString('hex')
  try { writeFileAtomic(file, id) } catch (err) { log.warn('[remoto] no se pudo guardar el identificador', err) }
  return id
}

const hhmm = (iso: string): string => new Intl.DateTimeFormat(tr('es-ES', 'en-GB'), { hour: '2-digit', minute: '2-digit' }).format(Date.parse(iso))

class RemoteAccess {
  private readonly dir = join(paths.root(), 'Remote')
  /** Aula como servidor: sin ventana, el acceso no se apaga y un propietario hace de ventana. */
  readonly headless = isServerMode()
  private readonly proxyKey = randomBytes(48).toString('base64url')
  private readonly adminToken = this.headless ? randomBytes(32).toString('base64url') : ''
  private readonly devices = new DeviceRegistry(join(this.dir, 'devices.json'))
  // fuera de la carpeta de datos: de ahí dentro Aula solo acepta materiales de Packs/ y Documents/
  private readonly uploads = new UploadStore(join(app.getPath('temp'), 'Aula Uploads'), { grant: (path) => userFiles.grant(path) })
  private readonly server = new RemoteServer({
    devices: this.devices, uploads: this.uploads, rendererRoot: rendererRoot(), icon: join(__dirname, '../../resources/icon.png'), language: () => aiLocale(), version: app.getVersion(), proxyKey: this.proxyKey,
    cookieName: `aula_device_${installId(this.dir)}`,
    host: this.headless ? 'server' : 'mac',
    ...(this.headless ? { admin: { token: this.adminToken, status: () => this.status(), link: (owner: boolean) => this.consoleLink(owner) } } : {}),
    onChange: () => { if (!this.devices.pairingOpen()) this.pairing = undefined; this.changed() }
  })
  private readonly tailnet = new Tailnet({
    binary: tailnetBinary(), stateDir: join(this.dir, 'tailnet'), proxyKey: this.proxyKey, onChange: () => this.changed(),
    hostname: this.headless ? serverHostname() : undefined
  })
  private enabled = false
  private pairing: { code: string; expires: string; owner: boolean } | undefined
  /** Lo último que se contó en la consola del servidor (para no repetirlo). */
  private told = ''
  private knownDevices = new Set<string>()
  private ownerTimer: ReturnType<typeof setInterval> | null = null

  /** Al arrancar Aula: si estaba encendido, vuelve a encenderse. Como servidor, siempre. */
  async init(): Promise<void> {
    if (this.headless) {
      say(tr(`Aula ${app.getVersion()} como servidor, sin ventana · datos en ${paths.root()}`, `Aula ${app.getVersion()} running as a server, without a window · data in ${paths.root()}`))
      for (const d of this.devices.list()) this.knownDevices.add(d.id)
      await this.setEnabled(true)
      if (!this.tailnet.available) say(tr('Falta el componente de Tailscale (aula-tsnet): los dispositivos no podrán llegar.', 'The Tailscale component (aula-tsnet) is missing: devices will not be able to reach this server.'))
      // sin propietario todavía: se abre un código de propietario (y otro cuando caduque) hasta que alguien lo use
      this.offerOwnerCode()
      this.ownerTimer = setInterval(() => this.offerOwnerCode(), 30_000)
      this.ownerTimer.unref?.()
      return
    }
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')) as { enabled?: unknown }
      if (raw.enabled === true) await this.setEnabled(true)
    } catch { /* primera vez: apagado */ }
  }

  async setEnabled(on: boolean): Promise<RemoteStatus> {
    // un servidor sin ventana no se queda sin acceso: sería dejar fuera a todos sus dispositivos
    if (this.headless && !on) return this.status()
    if (on && !this.enabled) {
      this.uploads.sweep()
      const port = await this.server.start()
      if (this.headless) this.writeAdmin(port)
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

  /** Un código para vincular un dispositivo. Solo como servidor puede ser de propietario (lo pide un propietario o la consola). */
  startPairing(opts: { owner?: boolean } = {}): RemoteStatus {
    if (this.enabled) this.pairing = this.devices.startPairing({ owner: this.headless && opts.owner === true })
    return this.changed()
  }

  cancelPairing(): RemoteStatus {
    this.devices.cancelPairing()
    this.pairing = undefined
    return this.changed()
  }

  revoke(id: string): RemoteStatus {
    this.devices.revoke(id)
    this.knownDevices.delete(id)
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
      ...(this.headless ? { server: true } : {}),
      ...(this.enabled && this.server.running ? { localURL: `http://127.0.0.1:${this.server.port}` } : {}),
      tailnet: { state: this.enabled ? t.state : t.state === 'unavailable' ? 'unavailable' : 'off', ...(t.authURL ? { authURL: t.authURL } : {}), ...(t.name ? { name: t.name } : {}), ...(t.user ? { user: t.user } : {}), ...(t.message ? { message: t.message } : {}) },
      ...(this.enabled && t.state === 'running' ? { deviceURL: `http://${t.name ?? this.tailnet.hostname}` } : {}),
      devices: this.devices.list(),
      ...(this.pairing ? { pairing: this.pairing.owner ? this.pairing : { code: this.pairing.code, expires: this.pairing.expires } } : {}),
      connected: this.server.listeners
    }
  }

  private changed(): RemoteStatus {
    const s = this.status()
    if (this.headless) this.tell(s)
    emit('remote.changed', s)
    return s
  }

  // MARK: Aula como servidor

  /** La consola (`aula-server link`): un código nuevo, de propietario salvo que se pida uno normal. */
  private consoleLink(owner: boolean): { code: string; expires: string; owner: boolean } | null {
    this.startPairing({ owner })
    const p = this.pairing
    if (!p) return null
    say(p.owner
      ? tr(`Código de propietario: ${p.code} (vale hasta las ${hhmm(p.expires)}).`, `Owner code: ${p.code} (valid until ${hhmm(p.expires)}).`)
      : tr(`Código para vincular un dispositivo: ${p.code} (vale hasta las ${hhmm(p.expires)}).`, `Code to link a device: ${p.code} (valid until ${hhmm(p.expires)}).`))
    return p
  }

  /** Sin propietario: abre un código de propietario si no hay ninguno esperando, y lo cuenta. */
  private offerOwnerCode(): void {
    if (!this.enabled || this.devices.hasOwner()) {
      if (this.ownerTimer && this.devices.hasOwner()) { clearInterval(this.ownerTimer); this.ownerTimer = null }
      return
    }
    if (this.pairing && Date.parse(this.pairing.expires) > Date.now()) return
    this.startPairing({ owner: true })
    const p = this.pairing
    if (p) say(tr(
      `Vincula tu primer dispositivo (será el propietario) con el código ${p.code} · vale hasta las ${hhmm(p.expires)}; luego se da otro. En el dispositivo: la app de Aula, con la misma cuenta de Tailscale.`,
      `Link your first device (it will be the owner) with the code ${p.code} · valid until ${hhmm(p.expires)}; a new one follows. On the device: the Aula app, signed in to the same Tailscale account.`))
  }

  /** Cuenta en la consola lo que cambió de la red privada y los dispositivos nuevos. */
  private tell(s: RemoteStatus): void {
    const t = s.tailnet
    const key = `${t.state}|${t.authURL ?? ''}|${t.name ?? ''}|${t.message ?? ''}`
    if (key !== this.told) {
      this.told = key
      if (t.state === 'needsLogin' && t.authURL) say(tr(`Para que tus dispositivos lleguen a este servidor, inicia sesión en Tailscale con TU cuenta (la misma que usarás en el iPad, el iPhone o Android): ${t.authURL}`, `To let your devices reach this server, sign in to Tailscale with YOUR account (the same one you will use on your iPad, iPhone or Android): ${t.authURL}`))
      else if (t.state === 'needsApproval') say(tr('Tailscale espera que apruebes este equipo en tu consola de administración de Tailscale.', 'Tailscale is waiting for you to approve this machine in your Tailscale admin console.'))
      else if (t.state === 'running') say(tr(`En tu red de Tailscale como «${t.name ?? this.tailnet.hostname}»${t.user ? ` (${t.user})` : ''}. Los dispositivos de esa misma cuenta ya pueden abrirlo.`, `On your Tailscale network as “${t.name ?? this.tailnet.hostname}”${t.user ? ` (${t.user})` : ''}. Devices signed in to that same account can open it now.`))
      else if (t.state === 'error' && t.message) say(tr(`Tailscale: ${t.message}`, `Tailscale: ${t.message}`))
    }
    for (const d of s.devices) {
      if (this.knownDevices.has(d.id)) continue
      this.knownDevices.add(d.id)
      say(d.owner ? tr(`Vinculado «${d.name}» como propietario.`, `Linked “${d.name}” as the owner.`) : tr(`Vinculado «${d.name}».`, `Linked “${d.name}”.`))
    }
  }

  /** Dónde está la consola y su clave: para `aula-server`, legible solo por quien ejecuta Aula. */
  private writeAdmin(port: number): void {
    const file = join(this.dir, 'admin.json')
    try {
      mkdirSync(this.dir, { recursive: true })
      writeFileAtomic(file, JSON.stringify({ version: 1, port, token: this.adminToken }), 0o600)
      chmodSync(file, 0o600)
    } catch (err) { log.warn('[servidor] no se pudo escribir la consola', err) }
  }

  async shutdown(): Promise<void> {
    if (this.ownerTimer) { clearInterval(this.ownerTimer); this.ownerTimer = null }
    this.tailnet.stop()
    await this.server.stop().catch(() => undefined)
    if (this.headless) { try { rmSync(join(this.dir, 'admin.json'), { force: true }) } catch { /* nada */ } }
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
