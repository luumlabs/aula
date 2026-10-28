// Logo de un proveedor o modelo de IA. En reposo va en la tinta de la interfaz (como un icono más de «Papel y luz»); el color
// de su marca aparece solo en el que está en uso (`active`) o al pasar el ratón por su fila (`.group` o `[data-logo-hover]`).
// Las marcas negras usan la tinta; el motor propio de Aula, su arco y sol en ladrillo; un servicio propio, un enchufe.
import { memo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../icons/Icon'
import { cx } from '../cx'
import { BRAND_LOGOS } from './logos'
import { isBrandLogo, logoForModel, logoForProvider, type LogoId, type ProviderLike } from './resolve'
import './providerLogo.css'

export type ProviderLogoTone = 'auto' | 'ink' | 'brand'

export interface ProviderLogoProps {
  /** El logo ya elegido; si no, se busca por `provider` o por `model`. */
  logo?: LogoId | null
  provider?: ProviderLike
  /** Modelo («deepseek/deepseek-v4.1-flash»): el logo de quien lo hizo. */
  model?: string
  /** Tamaño en px (14–40): del logo o, con `tile`, de la loseta. */
  size?: number
  /** Dentro de una loseta redondeada (como las filas de Ajustes). */
  tile?: boolean
  /** auto: tinta y color de marca al pasar el ratón o en uso · ink: siempre tinta · brand: siempre color de marca. */
  tone?: ProviderLogoTone
  /** Es el que está en uso: va en su color (y la loseta con un velo plano de ese color). */
  active?: boolean
  /** Nombre accesible (por defecto, el de la marca). */
  label?: string
  /** Al lado ya se lee el nombre: el logo no se anuncia dos veces. */
  decorative?: boolean
  className?: string
}

const clamp = (n: number) => Math.max(14, Math.min(40, Math.round(n)))

export const ProviderLogo = memo(function ProviderLogo({ logo, provider, model, size = 18, tile, tone = 'auto', active, label, decorative, className }: ProviderLogoProps) {
  const { t } = useTranslation('settings')
  const id: LogoId = logo ?? (provider ? logoForProvider(provider) : logoForModel(model)) ?? 'custom'
  const box = clamp(size)
  const glyph = tile ? Math.round(box * 0.5) : box
  const brand = isBrandLogo(id) ? BRAND_LOGOS[id] : null
  const name = label ?? brand?.name ?? t(id === 'aula' ? 'ai.logo.aula' : 'ai.logo.custom')
  // el color de la marca como variable: la hoja de estilos decide cuándo se ve (y lo aclara en oscuro)
  const style = { '--pl-c': brand?.color ?? (id === 'aula' ? 'var(--accent)' : 'var(--text)'), width: box, height: box } as CSSProperties
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': name }

  return (
    <span
      className={cx('provider-logo', tile && 'provider-logo--tile', className)}
      data-tone={tone}
      data-active={active ? '' : undefined}
      data-logo={id}
      data-colored={brand?.color || id === 'aula' ? '' : undefined}
      style={style}
      title={decorative ? undefined : name}
      {...a11y}
    >
      {brand ? (
        <svg className="provider-logo__glyph" width={glyph} height={glyph} viewBox={brand.viewBox} fill="currentColor" aria-hidden focusable="false">
          {brand.paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      ) : (
        <Icon className="provider-logo__glyph" name={id === 'aula' ? 'aula' : 'plug'} size={glyph} />
      )}
    </span>
  )
})

/** Una fila de logos pequeños (los proveedores con los que funciona una clave, p. ej.); el resto como «+N». */
export function ProviderLogoRow({ providers, max = 8, size = 16, className }: { providers: ProviderLike[]; max?: number; size?: number; className?: string }) {
  const shown = providers.slice(0, max)
  const rest = providers.length - shown.length
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1.5', className)}>
      {shown.map((p, i) => (
        <span key={p.id ?? i} data-logo-hover className="inline-flex">
          <ProviderLogo provider={p} size={size} label={p.label ?? undefined} />
        </span>
      ))}
      {rest > 0 && <span className="t-footnote text-text3 tabular">+{rest}</span>}
    </span>
  )
}

export { logoForProvider, logoForModel, logoForText, type LogoId, type ProviderLike } from './resolve'
