// IPC de logros (dominio «achievements»): la estantería y el aviso al conseguir uno (tras guardar progreso, agrupado).
import { checkAchievements, listAchievements } from '@main/services/achievements'
import { log } from '@main/services/log'
import { onCourseChanged } from '@main/services/store'
import { emit, handle } from '../rpc'

const SETTLE_MS = 1500

export function register(): void {
  handle('achievements.list', () => listAchievements())
  // primera comprobación: apunta en silencio lo que ya estaba conseguido
  try { checkAchievements() } catch (err) { log.warn('[logros] primera comprobación', err) }
  let timer: NodeJS.Timeout | null = null
  onCourseChanged(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      try {
        const ids = checkAchievements()
        if (ids.length) emit('achievements.earned', { ids })
      } catch (err) {
        log.warn('[logros] comprobación', err)
      }
    }, SETTLE_MS)
  })
}
