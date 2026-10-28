// Los cursos de ejemplo que trae Aula se marcan como tales («Ejemplo»): quien acaba de instalarla no debe creer que el examen
// de muestra es suyo (A4-P1-1). En el modo demostración (capturas y vídeo) hacen de cursos del estudiante y no se marcan.
import { useTranslation } from 'react-i18next'
import { isSampleCourse } from '@shared/samples'
import { cx } from '@renderer/design'
import { isDemo } from './demo'

/** ¿Se marca este curso como ejemplo? */
export function showsAsSample(id: string | null | undefined): boolean {
  return isSampleCourse(id) && !isDemo()
}

/** La cápsula «Ejemplo», junto al título de un curso de ejemplo. */
export function SampleTag({ className }: { className?: string }) {
  const { t } = useTranslation('common')
  return (
    <span title={t('sample.hint')} className={cx('inline-flex h-[18px] shrink-0 items-center rounded-full bg-fill2 px-1.5 text-[11px] font-semibold leading-none text-text2 whitespace-nowrap', className)}>
      {t('sample.tag')}
    </span>
  )
}
