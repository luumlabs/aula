// Título de la barra superior (cada pantalla pone el suyo) y acciones extra a la derecha.
import { useEffect, type ReactNode } from 'react'
import { create } from 'zustand'
import { useScreenActive } from './router'

interface TitleState {
  title: ReactNode
  right: ReactNode
  /** Quién lo puso: al irse una pantalla solo borra el título si sigue siendo el suyo. */
  owner: symbol | null
}
export const useTitleStore = create<TitleState>(() => ({ title: null, right: null, owner: null }))

/** El título de la pantalla de delante. Las pantallas que se desvanecen ya no lo tocan, y al desmontarse no borran el de la
 * siguiente (las dos conviven unos milisegundos durante la transición). */
export function useScreenTitle(title: ReactNode, right: ReactNode = null, deps: unknown[] = []): void {
  const active = useScreenActive()
  useEffect(() => {
    if (!active) return
    const owner = Symbol('title')
    useTitleStore.setState({ title, right, owner })
    return () => {
      if (useTitleStore.getState().owner === owner) useTitleStore.setState({ title: null, right: null, owner: null })
    }
    // si el título es texto, también se actualiza cuando cambia (p. ej. al cambiar el idioma)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, active, typeof title === 'string' ? title : null])
}
