// Ajustes → «Aula en tus dispositivos»: usar Aula desde el iPad o el iPhone con todo (cursos, IA, datos) en este Mac.
// Un interruptor, el estado de la red privada (Tailscale, dentro de Aula), el código para vincular un dispositivo y la
// lista de los vinculados. Apagado por defecto. La lógica está en el proceso principal ('remote.*').
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDeviceInfo, RemoteStatus } from '@shared/ipc/remote'
import { Button, Card, ConfirmDialog, Icon, Spinner, Switch, cx, toast, type IconName } from '@renderer/design'
import { api } from '@renderer/lib/api'
import { useRpc } from '@renderer/lib/useRpc'
import { rowTime } from '../inbox/format'

const DEVICE_ICONS: Record<string, IconName> = { ipad: 'tablet', iphone: 'phone', web: 'browser' }

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

export function DevicesCard() {
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
  if (!status) return null
  const on = status.enabled
  const net = status.tailnet
  const ready = on && net.state === 'running'
  const address = status.deviceURL ?? 'http://aula-mac'
  const headline = !on ? t('devices.off') : ready ? (status.connected ? t('devices.connected', { count: status.connected }) : t('devices.ready')) : t(`devices.net.${net.state}`)

  return (
    <Card padded="lg" className={cx('transition-colors', on && 'bg-accent-wash!')}>
      <div className="flex items-start gap-4">
        <div className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-[13px]', on ? 'bg-accent text-on-accent' : 'bg-fill2 text-text2')}>
          <Icon name="tablet" size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="t-title2">{t('devices.title')}</h2>
            <Switch checked={on} disabled={busy} onChange={(v) => void run(() => api.invoke('remote.setEnabled', { enabled: v }))} label={t('devices.title')} />
          </div>
          <p className="t-ui text-text2 mt-1" aria-live="polite">{headline}</p>
          <p className="t-callout text-text2 mt-2">{t('devices.hint')}</p>
        </div>
      </div>

      {on && (
        <div className="mt-4 flex flex-col">
          <Network status={status} busy={busy} run={run} />

          {ready && (
            <div className="border-t-[0.5px] border-line-soft py-3">
              {status.pairing && left ? (
                <div>
                  <div className="t-callout font-medium">{t('devices.codeTitle')}</div>
                  <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <div aria-label={status.pairing.code.split('').join(' ')} className="font-serif text-[40px] font-medium leading-none tracking-[0.12em] tabular text-text select-text">
                      {status.pairing.code.slice(0, 3)}<span className="mx-[0.12em] text-text3">·</span>{status.pairing.code.slice(3)}
                    </div>
                    <div className="t-ui text-text3 tabular pb-1">{t('devices.codeExpires', { left })}</div>
                  </div>
                  <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 t-callout text-text2">
                    <li>{t('devices.step1')}</li>
                    <li>{t('devices.step2', { address })}</li>
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
                  <Button variant={status.devices.length ? 'secondary' : 'primary'} disabled={busy} icon={<Icon name="plus" size={14} />} onClick={() => void run(() => api.invoke('remote.startPairing'))}>{t('devices.linkAction')}</Button>
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
                    <div className="t-callout font-medium truncate">{d.name}</div>
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
        description={t('devices.removeBody')}
        confirmLabel={t('devices.remove')}
        cancelLabel={t('devices.cancel')}
        danger
      />
    </Card>
  )
}

/** La red privada: qué falta para que los dispositivos encuentren este Mac, con el único botón que toca en cada caso. */
function Network({ status, busy, run }: { status: RemoteStatus; busy: boolean; run: (call: () => Promise<RemoteStatus>) => Promise<void> }) {
  const { t } = useTranslation('settings')
  const net = status.tailnet
  const row = 'flex items-center justify-between gap-4 border-t-[0.5px] border-line-soft py-3'
  switch (net.state) {
    case 'running':
      return (
        <div className={row}>
          <div className="min-w-0">
            <div className="t-callout font-medium flex items-center gap-1.5"><Icon name="check-circle" size={15} className="text-accent-text" />{t('devices.netRunning')}</div>
            <div className="t-ui text-text3 mt-0.5 truncate">{net.user ? t('devices.netAs', { user: net.user, name: net.name ?? 'aula-mac' }) : net.name}</div>
          </div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => api.invoke('remote.tailnetLogout'))}>{t('devices.netLogout')}</Button>
        </div>
      )
    case 'needsLogin':
      return (
        <div className={row}>
          <div className="min-w-0">
            <div className="t-callout font-medium">{t('devices.netLoginTitle')}</div>
            <div className="t-ui text-text3 mt-0.5">{t('devices.netLoginHint')}</div>
          </div>
          <Button variant="primary" disabled={busy || !net.authURL} iconRight={<Icon name="external" size={14} />} onClick={() => void run(() => api.invoke('remote.tailnetLogin'))}>{t('devices.netLoginAction')}</Button>
        </div>
      )
    case 'needsApproval':
      return <Note row={row} title={t('devices.netApprovalTitle')} body={t('devices.netApprovalHint')} />
    case 'unavailable':
      return <Note row={row} title={t('devices.netUnavailableTitle')} body={t('devices.netUnavailableHint')} />
    case 'error':
      return <Note row={row} title={t('devices.netErrorTitle')} body={net.message ?? t('devices.netErrorHint')} />
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
