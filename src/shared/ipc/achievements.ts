// Logros (dominio «achievements»): la estantería de Estadísticas y el aviso pixel-art al conseguir uno.

export type AchievementId =
  | 'firstAnswer' | 'creator'
  | 'streak3' | 'streak7' | 'streak30'
  | 'hour1' | 'hours10'
  | 'correct100' | 'correct1000'
  | 'cards100' | 'cards1000'
  | 'firstMastered' | 'mastered10'
  | 'mistakes10' | 'mockPassed' | 'courseReady'

export interface AchievementView {
  id: AchievementId
  /** Lo que lleva (sin pasar de la meta) y la meta. */
  value: number
  goal: number
  earned: boolean
  /** Cuándo se vio conseguido por primera vez. */
  earnedAt?: string
}

declare module './contract' {
  interface RpcMethods {
    'achievements.list': { args: void; result: AchievementView[] }
  }
  interface RpcEvents {
    /** Logros recién conseguidos (para celebrarlos). */
    'achievements.earned': { ids: AchievementId[] }
  }
}
