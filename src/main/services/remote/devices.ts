// Dispositivos del estudiante (su iPad, su iPhone) que pueden usar Aula a distancia. Sin Electron.
//  · Emparejar: Aula enseña en el Mac un código de un solo uso (6 cifras, 10 minutos); el dispositivo lo envía y recibe
//    su ficha (un secreto largo que solo él guarda; aquí queda su huella, nunca la ficha).
//  · Cada petición trae la ficha; caduca si el dispositivo pasa 90 días sin usarla y se puede retirar desde Ajustes.
//  · Propietario: en Aula como servidor (sin ventana) no hay un Mac desde el que llevar las claves, las plataformas o los
//    dispositivos, así que el dispositivo de quien la instaló hace de ventana. Solo se es propietario con un código pedido
//    así: el primero que enseña el servidor al arrancar sin propietario, el de su consola (`aula-server link`) o el que da
//    otro propietario. En el Mac no hay propietarios: su ventana ya lo es.
//    Los códigos de propietario que el servidor abre solo (sin propietario todavía) comparten un tope de intentos fallidos:
//    adivinar uno no puede seguir sin límite a base de esperar al siguiente. Pasado el tope hay que pedirlo a mano.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../fs'

export interface RemoteDevice {
  id: string
  /** Como lo llama el estudiante («iPad de Ana»). */
  name: string
  /** ipad, iphone, android o web. */
  platform: string
  /** Hace de ventana de Aula como servidor (remote/policy.ts): solo con un código de propietario. */
  owner?: boolean
  /** sha256 de la ficha. */
  tokenHash: string
  created: string
  lastSeen: string
}

export type RemoteDeviceView = Omit<RemoteDevice, 'tokenHash'>

export const PAIRING_MINUTES = 10
export const TOKEN_DAYS = 90
/** Intentos fallidos seguidos antes de anular el código (hay que pedir otro). También el tope de intentos fallidos con
 *  códigos de propietario, sumando todos, desde que alguien pidió uno a mano (`ownerCodesBlocked`). */
export const MAX_ATTEMPTS = 5
const MAX_DEVICES = 12

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export class PairingError extends Error {
  constructor(readonly code: 'noCode' | 'expired' | 'wrong' | 'tooMany' | 'full') {
    super(code)
    this.name = 'PairingError'
  }
}

export class DeviceRegistry {
  private devices: RemoteDevice[] = []
  private pairing: { hash: string; expires: number; attempts: number; owner: boolean } | null = null
  /** Intentos fallidos con códigos de propietario, sumando todos (no vuelve a cero con cada código nuevo). Se guarda: un
   *  reinicio no da más intentos. Vuelve a cero cuando alguien pide un código de propietario a mano o se vincula uno. */
  private ownerMisses = 0

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { devices?: unknown; ownerMisses?: unknown }
      if (typeof raw.ownerMisses === 'number' && Number.isFinite(raw.ownerMisses)) this.ownerMisses = Math.max(0, Math.floor(raw.ownerMisses))
      if (!Array.isArray(raw.devices)) return
      this.devices = raw.devices.flatMap((d): RemoteDevice[] => {
        const o = d as Partial<RemoteDevice>
        return typeof o?.id === 'string' && typeof o.tokenHash === 'string' && typeof o.name === 'string'
          ? [{ id: o.id, name: o.name, platform: typeof o.platform === 'string' ? o.platform : 'web', tokenHash: o.tokenHash, created: o.created ?? new Date(0).toISOString(), lastSeen: o.lastSeen ?? new Date(0).toISOString(), ...(o.owner === true ? { owner: true } : {}) }]
          : []
      })
    } catch { this.devices = [] }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileAtomic(this.file, JSON.stringify({ version: 1, devices: this.devices, ...(this.ownerMisses > 0 ? { ownerMisses: this.ownerMisses } : {}) }, null, 2))
  }

  /** Empieza un emparejamiento que pide una persona (la ventana del Mac, un propietario, la consola del servidor): devuelve
   *  el código que se enseña (el anterior deja de valer). Con `owner`, quien lo use será propietario (solo Aula como servidor
   *  los pide), y vuelve a haber intentos para los códigos de propietario. */
  startPairing(opts: { owner?: boolean } = {}): { code: string; expires: string; owner: boolean } {
    const owner = opts.owner === true
    if (owner) this.setOwnerMisses(0)
    return this.open(owner)
  }

  /** El código de propietario que abre el servidor solo mientras no hay propietario; null si ya se fallaron demasiados
   *  intentos con códigos de propietario (entonces hay que pedirlo a mano, con `startPairing`). */
  offerOwnerCode(): { code: string; expires: string; owner: boolean } | null {
    return this.ownerCodesBlocked() ? null : this.open(true)
  }

  /** ¿Se acabaron los intentos para los códigos de propietario que el servidor abre solo? */
  ownerCodesBlocked(): boolean {
    return this.ownerMisses >= MAX_ATTEMPTS
  }

  private open(owner: boolean): { code: string; expires: string; owner: boolean } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expires = this.now() + PAIRING_MINUTES * 60_000
    this.pairing = { hash: sha(code), expires, attempts: 0, owner }
    return { code, expires: new Date(expires).toISOString(), owner }
  }

  private setOwnerMisses(n: number): void {
    if (this.ownerMisses === n) return
    this.ownerMisses = n
    // si no se puede guardar, vale lo de memoria mientras Aula siga en marcha
    try { this.save() } catch { /* sin disco */ }
  }

  /** ¿Hay algún propietario vinculado? */
  hasOwner(): boolean {
    return this.devices.some((d) => d.owner === true)
  }

  cancelPairing(): void { this.pairing = null }

  /** ¿Hay un código esperando a que un dispositivo lo use? */
  pairingOpen(): boolean {
    return !!this.pairing && this.pairing.expires > this.now()
  }

  /** El dispositivo presenta el código: si vale, queda emparejado y recibe su ficha (solo esta vez). */
  completePairing(code: string, name: string, platform: string): { token: string; device: RemoteDeviceView } {
    const p = this.pairing
    if (!p) throw new PairingError('noCode')
    if (p.expires <= this.now()) { this.pairing = null; throw new PairingError('expired') }
    if (!same(sha(code.replace(/\D/g, '')), p.hash)) {
      const spent = ++p.attempts >= MAX_ATTEMPTS
      // de propietario: también cuenta para el tope de todos los códigos de propietario, y al llegar a él se anula este
      if (p.owner) this.setOwnerMisses(this.ownerMisses + 1)
      if (spent || (p.owner && this.ownerCodesBlocked())) { this.pairing = null; throw new PairingError('tooMany') }
      throw new PairingError('wrong')
    }
    this.pairing = null
    this.pruneExpired()
    if (this.devices.length >= MAX_DEVICES) throw new PairingError('full')
    const token = randomBytes(32).toString('base64url')
    const at = new Date(this.now()).toISOString()
    const device: RemoteDevice = {
      id: randomBytes(6).toString('hex'), name: name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) || 'Dispositivo',
      platform: ['ipad', 'iphone', 'android', 'web'].includes(platform) ? platform : 'web', tokenHash: sha(token), created: at, lastSeen: at,
      ...(p.owner ? { owner: true } : {})
    }
    this.devices.push(device)
    // quien tenía el código de propietario lo vio en la consola (o se lo dio otro propietario): vuelve a haber intentos
    if (p.owner) this.ownerMisses = 0
    this.save()
    return { token, device: view(device) }
  }

  /** El dispositivo de una ficha (y apunta que se acaba de usar), o undefined si no vale o caducó. */
  authenticate(token: string | undefined): RemoteDeviceView | undefined {
    if (!token || token.length < 20 || token.length > 200) return undefined
    const hash = sha(token)
    const device = this.devices.find((d) => same(d.tokenHash, hash))
    if (!device) return undefined
    if (this.expired(device)) { this.revoke(device.id); return undefined }
    // se guarda como mucho una vez por hora: cada petición no escribe en disco
    const now = this.now()
    if (now - Date.parse(device.lastSeen) > 3_600_000) { device.lastSeen = new Date(now).toISOString(); this.save() }
    return view(device)
  }

  /** El dispositivo con ese identificador si sigue vinculado y su ficha no caducó (sin apuntar que se usó): para lo que
   *  sigue abierto desde antes, como su flujo de eventos. */
  active(id: string): RemoteDeviceView | undefined {
    const device = this.devices.find((d) => d.id === id)
    return device && !this.expired(device) ? view(device) : undefined
  }

  list(): RemoteDeviceView[] {
    return this.devices.map(view)
  }

  revoke(id: string): boolean {
    const before = this.devices.length
    this.devices = this.devices.filter((d) => d.id !== id)
    if (this.devices.length === before) return false
    this.save()
    return true
  }

  private expired(d: RemoteDevice): boolean {
    return this.now() - Date.parse(d.lastSeen) > TOKEN_DAYS * 86_400_000
  }

  private pruneExpired(): void {
    const limit = this.now() - TOKEN_DAYS * 86_400_000
    this.devices = this.devices.filter((d) => Date.parse(d.lastSeen) > limit)
  }
}

function view(d: RemoteDevice): RemoteDeviceView {
  return { id: d.id, name: d.name, platform: d.platform, created: d.created, lastSeen: d.lastSeen, ...(d.owner ? { owner: true } : {}) }
}
