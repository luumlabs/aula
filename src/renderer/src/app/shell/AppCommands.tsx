// Comandos del menú nativo ('app.command') y el tema de la ventana: la barra de título del sistema sigue al tema de la interfaz.
import { useEffect } from 'react'
import { useTheme, toast } from '@renderer/design'
import { api } from '@renderer/lib/api'
import type { AppCommand } from '@shared/ipc/contract'
import type { AssistantNavigateTarget } from '@shared/assistant/types'
import { navigate, useNav } from '../router'
import { usePalette } from './CommandPalette'
import { TOGGLE_SIDEBAR_EVENT } from './Sidebar'

export function AppCommands() {
  const { dark } = useTheme()
  useEffect(() => {
    void api.invoke('app.setTheme', { dark }).catch(() => undefined)
  }, [dark])
  useEffect(() => api.on('app.command', ({ command }) => run(command)), [])
  // Aula (chat o tutor) pide abrir una pantalla
  useEffect(() => api.on('chat.navigate', ({ target }) => openTarget(target)), [])
  return null
}

function run(command: AppCommand): void {
  switch (command) {
    case 'newCourse':
      return navigate({ name: 'create' })
    case 'importCourse':
      void (api.invoke as unknown as (m: string) => Promise<{ id?: string } | null>)('courses.import')
        .then((r) => r?.id && navigate({ name: 'course', id: r.id }))
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      return
    case 'settings':
      return navigate({ name: 'settings' })
    case 'search':
      return usePalette.getState().open()
    case 'askAula':
      return navigate({ name: 'chat' })
    case 'studyNow':
      // el plan de hoy del primer curso que tenga algo pendiente (si no, Inicio)
      void api
        .invoke('home.summary')
        .then((h) => {
          const first = h.plan[0]
          navigate(first ? { name: 'study', id: first.courseId, mode: 'plan' } : { name: 'home' })
        })
        .catch(() => navigate({ name: 'home' }))
      return
    case 'goHome':
      return navigate({ name: 'home' })
    case 'goChat':
      return navigate({ name: 'chat' })
    case 'goCalendar':
      return navigate({ name: 'calendar' })
    case 'goTools':
      return navigate({ name: 'tools' })
    case 'goDocuments':
      return navigate({ name: 'documents' })
    case 'goInbox':
      return navigate({ name: 'inbox' })
    case 'goStats':
      return navigate({ name: 'stats' })
    case 'back':
      return useNav.getState().back()
    case 'forward':
      return useNav.getState().forward()
    case 'toggleSidebar':
      window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT))
      return
  }
}

/** Lo que Aula pide abrir desde el chat → una ruta de la app (también lo usan las menciones con «@» del chat). */
export function openTarget(t: AssistantNavigateTarget): void {
  const id = t.courseID
  switch (t.screen) {
    case 'home':
    case 'today':
      return navigate({ name: 'home' })
    case 'stats':
      return navigate({ name: 'stats' })
    case 'calendar':
      return navigate({ name: 'calendar' })
    case 'settings':
      return navigate({ name: 'settings', section: t.settingsPane })
    case 'create_course':
      return navigate({ name: 'create' })
    case 'tool':
      return navigate({ name: 'tools', tool: t.tool })
    case 'run':
      return id ? navigate({ name: 'course', id }) : undefined
    case 'course':
      return id ? navigate({ name: 'course', id }) : undefined
    case 'materials':
    case 'reference':
    case 'mistakes':
      return id ? navigate({ name: 'course', id, tab: t.screen }) : undefined
    case 'lesson':
      return id ? navigate({ name: 'study', id, mode: 'learn', skill: t.skillID }) : undefined
    case 'practice':
    case 'exercise':
      return id ? navigate({ name: 'study', id, mode: 'practice', skill: t.skillID }) : undefined
    case 'cards':
      return id ? navigate({ name: 'study', id, mode: 'cards', skill: t.skillID }) : undefined
    case 'exam':
      return id ? navigate({ name: 'study', id, mode: 'exam' }) : undefined
  }
}
