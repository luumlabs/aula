// Estado de energía de la ventana (para que la interfaz duerma lo ambiental cuando no se ve).
import { handle } from '../rpc'
import { powerState } from '../power'

export function register(): void {
  handle('app.powerState', () => powerState())
}
