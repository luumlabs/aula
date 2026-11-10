// Dispositivos del estudiante (su iPad, su iPhone) que pueden usar Aula a distancia. Sin Electron.
//  · Emparejar: Aula enseña en el Mac un código de un solo uso (6 cifras, 10 minutos); el dispositivo lo envía y recibe
//    su ficha (un secreto largo que solo él guarda; aquí queda su huella, nunca la ficha).
//  · Cada petición trae la ficha; caduca si el dispositivo pasa 90 días sin usarla y se puede retirar desde Ajustes.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../fs'

export interface RemoteDevice {
  id: string
  /** Como lo llama el estudiante («iPad de Ana»). */
  name: string
  /** ipad, iphone o web. */
  platform: string
  /** sha256 de la ficha. */
  tokenHash: string
  created: string
  lastSeen: string
}

export type RemoteDeviceView = Omit<RemoteDevice, 'tokenHash'>

export const PAIRING_MINUTES = 10
export const TOKEN_DAYS = 90
/** Intentos fallidos seguidos antes de anular el código (hay que pedir otro). */
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
  private pairing: { hash: string; expires: number; attempts: number } | null = null

  constructor(private readonly file: string, private readonly now: () => number = Date.now) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { devices?: unknown }
      if (!Array.isArray(raw.devices)) return
      this.devices = raw.devices.flatMap((d): RemoteDevice[] => {
        const o = d as Partial<RemoteDevice>
        return typeof o?.id === 'string' && typeof o.tokenHash === 'string' && typeof o.name === 'string'
          ? [{ id: o.id, name: o.name, platform: typeof o.platform === 'string' ? o.platform : 'web', tokenHash: o.tokenHash, created: o.created ?? new Date(0).toISOString(), lastSeen: o.lastSeen ?? new Date(0).toISOString() }]
          : []
      })
    } catch { this.devices = [] }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileAtomic(this.file, JSON.stringify({ version: 1, devices: this.devices }, null, 2))
  }

  /** Empieza un emparejamiento: devuelve el código que se enseña en el Mac (el anterior deja de valer). */
  startPairing(): { code: string; expires: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const expires = this.now() + PAIRING_MINUTES * 60_000
    this.pairing = { hash: sha(code), expires, attempts: 0 }
    return { code, expires: new Date(expires).toISOString() }
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
      if (++p.attempts >= MAX_ATTEMPTS) { this.pairing = null; throw new PairingError('tooMany') }
      throw new PairingError('wrong')
    }
    this.pairing = null
    this.pruneExpired()
    if (this.devices.length >= MAX_DEVICES) throw new PairingError('full')
    const token = randomBytes(32).toString('base64url')
    const at = new Date(this.now()).toISOString()
    const device: RemoteDevice = {
      id: randomBytes(6).toString('hex'), name: name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) || 'Dispositivo',
      platform: ['ipad', 'iphone', 'web'].includes(platform) ? platform : 'web', tokenHash: sha(token), created: at, lastSeen: at
    }
    this.devices.push(device)
    this.save()
    return { token, device: view(device) }
  }

  /** El dispositivo de una ficha (y apunta que se acaba de usar), o undefined si no vale o caducó. */
  authenticate(token: string | undefined): RemoteDeviceView | undefined {
    if (!token || token.length < 20 || token.length > 200) return undefined
    const hash = sha(token)
    const device = this.devices.find((d) => same(d.tokenHash, hash))
    if (!device) return undefined
    const now = this.now()
    if (now - Date.parse(device.lastSeen) > TOKEN_DAYS * 86_400_000) { this.revoke(device.id); return undefined }
    // se guarda como mucho una vez por hora: cada petición no escribe en disco
    if (now - Date.parse(device.lastSeen) > 3_600_000) { device.lastSeen = new Date(now).toISOString(); this.save() }
    return view(device)
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

  private pruneExpired(): void {
    const limit = this.now() - TOKEN_DAYS * 86_400_000
    this.devices = this.devices.filter((d) => Date.parse(d.lastSeen) > limit)
  }
}

function view(d: RemoteDevice): RemoteDeviceView {
  return { id: d.id, name: d.name, platform: d.platform, created: d.created, lastSeen: d.lastSeen }
}
