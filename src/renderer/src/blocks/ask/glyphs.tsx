// Los dos glifos de la barra de marcar que no están entre los iconos de Aula: la pluma y el marcador (rejilla de 24, trazo
// redondeado, el mismo grosor que `Icon` a 13–16 px).

export function PenGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L8.4 18.1 4 19.5l1.4-4.4z" />
      <path d="M14.5 6l3 3" />
    </svg>
  )
}

export function MarkerGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M15.2 3.6l5.2 5.2-7.6 7.6-5.2-5.2z" />
      <path d="M7.6 11.2l-2.4 5.6 2.6 2.6 5-3" />
      <path d="M3.5 21h7" strokeWidth={2.6} opacity={0.55} />
    </svg>
  )
}
