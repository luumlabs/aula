// Ajustes → «Aula en tus dispositivos»: usar Aula desde el iPad o el iPhone con todo (cursos, IA, datos) en este Mac.
// Un interruptor, el estado de la red privada (Tailscale, dentro de Aula), el código para vincular un dispositivo y la
// lista de los vinculados. Apagado por defecto. La lógica está en el proceso principal ('remote.*').
// Con Aula como servidor (sin Mac) la ve el dispositivo propietario: siempre encendida, sin cerrar la sesión de Tailscale (se
// quedaría fuera), con la opción de dar un código de propietario y la marca de quién lo es.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDeviceInfo, RemoteStatus } from '@shared/ipc/remote'
import { Button, ConfirmDialog, Icon, Section, Spinner, Switch, cx, toast, type IconName } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { useRpc } from '@renderer/lib/useRpc'
import { rowTime } from '../inbox/format'

const DEVICE_ICONS: Record<string, IconName> = { ipad: 'tablet', iphone: 'phone', android: 'phone', web: 'browser' }

/** «9:41» que queda para que caduque el código (vacío si ya caducó). */
function useCountdown(expires: string | undefined): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expires) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expires])
  if (!expires) return ''
  const left = Math.max(0, Math.round((Date.parse(expires) - now) / 1000))
  return left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''
}

export function DevicesSection() {
  const { t } = useTranslation('settings')
  const { data: status, setData } = useRpc('remote.status', undefined, { events: ['remote.changed'] })
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<RemoteDeviceInfo | null>(null)
  const left = useCountdown(status?.pairing?.expires)
  // el código caducó a la vista: se vuelve a pedir el estado para que desaparezca
  useEffect(() => {
    if (status?.pairing && !left) void api.invoke('remote.status').then(setData).catch(() => {})
  }, [left, !!status?.pairing])

  const run = async (call: () => Promise<RemoteStatus>): Promise<void> => {
    setBusy(true)
    try { setData(await call()) } catch (e) { toast.error(t('devices.failed'), e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  // mientras llega el estado, solo el título (sin un hueco entre dos filetes)
  if (!status) return <Section title={t('devices.title')} rule={false} />
  const server = status.server === true
  const windows = !server && api.platform === 'win32'
  const dk = (k: string): string => (windows ? `devices.win.${k}` : `devices.${k}`)
  const fallbackName = server ? 'aula-server' : windows ? 'aula-windows' : 'aula-mac'
  const on = status.enabled
  const net = status.tailnet
  const ready = on && net.state === 'running'
  const address = status.deviceURL ?? `http://${fallbackName}`
  const name = status.tailnet.name ?? fallbackName
  const headline = !on
    ? t('devices.off')
    : ready
      ? status.connected
        ? t('devices.connected', { count: status.connected })
        : t('devices.ready')
      : windows && net.state === 'needsApproval'
        ? t('devices.win.netNeedsApproval')
        : t(`devices.net.${net.state}`)

  return (
    <Section
      title={server ? t('devices.server.title') : t('devices.title')}
      rule={false}
      detail={<span className="text-text2" aria-live="polite">{headline}</span>}
      // un servidor no se apaga desde un dispositivo: dejaría fuera a todos
      action={!server ? <Switch checked={on} disabled={busy} onChange={(v) => void run(() => api.invoke('remote.setEnabled', { enabled: v }))} label={t('devices.title')} /> : undefined}
    >
      <p className="t-callout text-text2">{server ? t('devices.server.hint') : t(dk('hint'))}</p>

      {on && (
        <div className="mt-4 flex flex-col">
          <Network status={status} windows={windows} fallbackName={fallbackName} name={name} busy={busy} run={run} />

          {ready && (
            <div className="border-t-[0.5px] border-line-soft py-3">
              {status.pairing && left ? (
                <div>
                  <div className="t-callout font-medium">{status.pairing.owner ? t('devices.server.ownerCodeTitle') : t('devices.codeTitle')}</div>
                  <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <div aria-label={status.pairing.code.split('').join(' ')} className="font-serif text-[40px] font-medium leading-none tracking-[0.12em] tabular text-text select-text">
                      {status.pairing.code.slice(0, 3)}<span className="mx-[0.12em] text-text3">·</span>{status.pairing.code.slice(3)}
                    </div>
                    <div className="t-ui text-text3 tabular pb-1">{t('devices.codeExpires', { left })}</div>
                  </div>
                  <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 t-callout text-text2">
                    <li>{server ? t('devices.server.step1') : t(dk('step1'))}</li>
                    <li>{server ? t('devices.server.step2', { name }) : t(dk('step2'), { address, name })}</li>
                    <li>{t('devices.step3')}</li>
                  </ol>
                  <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => void run(() => api.invoke('remote.cancelPairing'))}>{t('devices.cancelCode')}</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="t-callout font-medium">{t('devices.link')}</div>
                    <div className="t-ui text-text3 mt-0.5">{t('devices.linkHint')}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {server && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.invoke('remote.startPairing', { owner: true }))}>{t('devices.server.linkOwner')}</Button>}
                    <Button variant={status.devices.length ? 'secondary' : 'primary'} disabled={busy} icon={<Icon name="plus" size={14} />} onClick={() => void run(() => api.invoke('remote.startPairing'))}>{t('devices.linkAction')}</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {status.devices.length > 0 && (
            <ul className="m-0 list-none border-t-[0.5px] border-line-soft p-0 pt-1">
              {status.devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-fill2 text-text2"><Icon name={DEVICE_ICONS[d.platform] ?? 'browser'} size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="t-callout font-medium flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{d.name}</span>
                      {d.owner && <span className="t-caption shrink-0 rounded-full bg-accent-wash px-2 py-0.5 text-accent-text">{t('devices.owner')}</span>}
                    </div>
                    <div className="t-ui text-text3">{t('devices.lastSeen', { when: rowTime(t, d.lastSeen) })}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(d)}>{t('devices.remove')}</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => { const d = removing; if (d) void run(() => api.invoke('remote.revoke', { id: d.id })) }}
        title={t('devices.removeTitle', { name: removing?.name ?? '' })}
        description={server && removing?.owner ? t('devices.server.removeOwnerBody') : t('devices.removeBody')}
        confirmLabel={t('devices.remove')}
        cancelLabel={t('devices.cancel')}
        danger
      />
    </Section>
  )
}

/** La red privada: qué falta para que los dispositivos encuentren este equipo, con el único botón que toca en cada caso. */
function Network({ status, windows, fallbackName, name, busy, run }: { status: RemoteStatus; windows: boolean; fallbackName: string; name: string; busy: boolean; run: (call: () => Promise<RemoteStatus>) => Promise<void> }) {
  const { t } = useTranslation('settings')
  const net = status.tailnet
  const dk = (k: string): string => (windows ? `devices.win.${k}` : `devices.${k}`)
  const row = 'flex items-center justify-between gap-4 border-t-[0.5px] border-line-soft py-3'
  switch (net.state) {
    case 'running':
      return (
        <div className={row}>
          <div className="min-w-0">
            <div className="t-callout font-medium flex items-center gap-1.5"><Icon name="check-circle" size={15} className="text-accent-text" />{t('devices.netRunning')}</div>
            <div className="t-ui text-text3 mt-0.5 truncate">{net.user ? t(status.server ? 'devices.server.netAs' : dk('netAs'), { user: net.user, name: net.name ?? fallbackName }) : net.name}</div>
          </div>
          {/* la sesión de Tailscale de un servidor se cierra en su consola: desde aquí el dispositivo se quedaría fuera */}
          {!status.server && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.invoke('remote.tailnetLogout'))}>{t('devices.netLogout')}</Button>}
        </div>
      )
    case 'needsLogin':
      // un servidor inicia sesión en Tailscale desde su consola (la página sale en su registro y en «aula-server status»)
      if (status.server) return <Note row={row} title={t('devices.netLoginTitle')} body={t('devices.server.netLoginHint')} />
      return (
        <div className={row}>
          <div className="min-w-0">
            <div className="t-callout font-medium">{t('devices.netLoginTitle')}</div>
            <div className="t-ui text-text3 mt-0.5">{t(dk('netLoginHint'))}</div>
          </div>
          <Button variant="primary" disabled={busy || !net.authURL} iconRight={<Icon name="external" size={14} />} onClick={() => void run(() => api.invoke('remote.tailnetLogin'))}>{t('devices.netLoginAction')}</Button>
        </div>
      )
    case 'needsApproval':
      return <Note row={row} title={t(dk('netApprovalTitle'))} body={t(dk('netApprovalHint'), { name })} />
    case 'unavailable':
      return <Note row={row} title={t('devices.netUnavailableTitle')} body={t('devices.netUnavailableHint')} />
    case 'error':
      return <Note row={row} title={t('devices.netErrorTitle')} body={net.message ?? t(dk('netErrorHint'))} />
    default:
      return (
        <div className={cx(row, 'justify-start! gap-2.5 text-text2')}>
          <Spinner size={14} />
          <span className="t-callout">{t('devices.netStarting')}</span>
        </div>
      )
  }
}

function Note({ row, title, body }: { row: string; title: string; body: string }) {
  return (
    <div className={row}>
      <div className="min-w-0">
        <div className="t-callout font-medium">{title}</div>
        <div className="t-ui text-text3 mt-0.5">{body}</div>
      </div>
    </div>
  )
}
