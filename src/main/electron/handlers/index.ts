// Registro de todos los dominios del IPC. Cada dominio añade UNA línea aquí.
import { register as app } from './app'
import { register as settings } from './settings'
import { register as updates } from './updates'
import { register as calendar } from './calendar'
import { register as platforms } from './platforms'
import { register as courses } from './courses'
import { register as ai } from './ai'
import { register as agents } from './agents'
import { register as study } from './study'
import { register as documents } from './documents'
import { register as automations } from './automations'
import { register as generation } from './generation'
import { register as assistant } from './assistant'
import { register as achievements } from './achievements'
import { register as search } from './search'
import { register as secrets } from './secrets'
import { register as power } from './power'

export function registerAllHandlers(): void {
  app()
  settings()
  updates()
  calendar()
  platforms()
  courses()
  ai()
  agents()
  study()
  documents()
  automations()
  generation()
  assistant()
  achievements()
  search()
  secrets()
  power()
}
