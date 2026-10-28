// Gota flotante de Aula (abajo a la derecha): la marca del arco; al pasar el ratón el sol asoma, la gota sube un poco y sale a
// su lado un bocadillo «Pregúntale a Aula».
// Rendimiento: nada de animar el ancho (antes era un muelle de motion sobre `width: auto`: medir y maquetar en cada fotograma,
// más un bucle del sol en JavaScript mientras el ratón seguía encima). Ahora la geometría es fija y todo son transiciones CSS de
// transform/opacity en su propia capa: el hilo principal no trabaja mientras el ratón está encima.
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AulaMark } from '@renderer/design'
import { navigate, useNav } from '../router'
import { useAulaMarkState } from '@renderer/screens/chat/liveStatus'
import { isDemo } from '@renderer/lib/demo'
import { coversAControl, INTERACTIVE, overlapCenter, type Box } from './orbDodge'
import './orb.css'

/** Los controles que hay debajo de la gota ahora mismo (sin contar la gota): todos los que se cruzan con ella y se ven ahí (no
 *  tapados por otra capa). Antes se miraban 5 puntos fijos y un interruptor en el borde de la gota se escapaba. */
function controlsBeneath(orb: Box, own: Element): Box[] {
  const out: Box[] = []
  for (const ctl of document.querySelectorAll(INTERACTIVE)) {
    if (own.contains(ctl)) continue
    const r = ctl.getBoundingClientRect()
    const at = r.width > 0 && r.height > 0 ? overlapCenter(orb, r) : null
    if (!at) continue
    const top = document.elementsFromPoint(at[0], at[1]).find((el) => !own.contains(el))
    if (top && (ctl === top || ctl.contains(top) || top.contains(ctl))) out.push(r)
  }
  return out
}

export function OrbLauncher() {
  const { t } = useTranslation()
  const route = useNav((s) => s.route)
  // el atardecer mientras Aula responde en cualquier conversación y «listo» al terminar (CSS: sin JavaScript por fotograma)
  const mark = useAulaMarkState()
  const box = useRef<HTMLDivElement>(null)
  // mientras se desplaza la vista, la gota se aparta (así no tapa los controles de la esquina al buscarlos); vuelve al parar.
  // Sin React por evento: solo un atributo en su propio elemento (transform y opacity en CSS).
  useEffect(() => {
    let timer = 0
    const onScroll = (): void => {
      box.current?.setAttribute('data-scrolling', '')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        box.current?.removeAttribute('data-scrolling')
        // al parar: ¿quedó un control debajo?
        window.dispatchEvent(new Event('aula-orb-check'))
      }, 650)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.clearTimeout(timer)
    }
  }, [])
  // con la vista quieta, si debajo queda un control (un interruptor, «See all»), la gota se aparta del todo: ni se ve ni se
  // enfoca (A4-P2-13). Se mira al parar de desplazar, al cambiar de pantalla, al cambiar el tamaño y al enfocar algo con Tab;
  // nada por fotograma. En las capturas y el vídeo (modo demostración) se queda donde está.
  useEffect(() => {
    if (isDemo()) return
    const el = box.current
    if (!el) return
    // su sitio sin transformaciones (la entrada y el apartarse la escalan): la caja fija de la esquina
    const place = (): Box => ({ left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight })
    const check = (): void => {
      if (el.hasAttribute('data-scrolling')) return
      const r = place()
      // se mira con la gota fuera (si ya estaba apartada no sale en elementsFromPoint, y si no, se ignora)
      el.toggleAttribute('data-covering', coversAControl(r, controlsBeneath(r, el)))
    }
    const timers = [window.setTimeout(check, 450), window.setTimeout(check, 1400)]
    const onFocus = (e: FocusEvent): void => {
      const t = e.target as HTMLElement | null
      if (!t || el.contains(t) || typeof t.getBoundingClientRect !== 'function') return
      // con Tab, lo enfocado que quede debajo (aunque sea un poco) también la aparta
      if (coversAControl(place(), [t.getBoundingClientRect()], 0.05)) el.setAttribute('data-covering', '')
      else check()
    }
    window.addEventListener('aula-orb-check', check)
    window.addEventListener('resize', check)
    document.addEventListener('focusin', onFocus)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.removeEventListener('aula-orb-check', check)
      window.removeEventListener('resize', check)
      document.removeEventListener('focusin', onFocus)
    }
  }, [route])
  // en el chat, al estudiar, leyendo un documento (Aula ya está en el panel del lector) y dentro de una herramienta (tiene sus
  // propios controles en las esquinas) no hace falta
  if (route.name === 'chat' || route.name === 'study' || (route.name === 'documents' && route.doc) || (route.name === 'tools' && route.tool)) return null
  return (
    <div ref={box} className="aula-orb fixed bottom-6 right-6 z-40">
      <button type="button" data-aula-hover onClick={() => navigate({ name: 'chat' })} aria-label={t('orb.ask')} className="aula-orb__drop grid place-items-center w-11 h-11 rounded-full bg-raised border-[0.5px] border-line text-text outline-none">
        <AulaMark size={22} state={mark} hover />
        <span aria-hidden className="aula-orb__label t-ui font-medium">
          {t('orb.ask')}
        </span>
      </button>
    </div>
  )
}
