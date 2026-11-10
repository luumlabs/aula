// Novedades sin leer: lo enseñan la barra lateral y, en el teléfono, la barra de pestañas.
import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/api'

/** Novedades sin leer (se actualiza con 'automations.inboxChanged'). */
export function useInboxCount(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    api
      .invoke('automations.inboxCount')
      .then((v) => alive && setN(v.unread))
      .catch(() => {})
    const off = api.on('automations.inboxChanged', (e) => setN(e.unread))
    return () => {
      alive = false
      off()
    }
  }, [])
  return n
}
