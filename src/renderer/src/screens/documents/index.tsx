// Documentos: la biblioteca (sin documento en la ruta), el lector (`{ name: 'documents', doc: '<clave>[@página]' }`) y, en la
// ventana oculta de impresión (?print=1), la vista de impresión de los documentos que crea Aula.
import { useTranslation } from 'react-i18next'
import { parseDocKey } from '@shared/documents'
import { Button, EmptyState } from '@renderer/design'
import { navigate, useRoute } from '@renderer/app/router'
import { useScreenTitle } from '@renderer/app/title'
import { Library } from './Library'
import { Reader } from './reader/Reader'
import { isPrintWindow, PrintRoot } from './print/PrintRoot'

export { openDocument, openCourseSource } from './lib'
export { ExportDialog } from './export/ExportDialog'

export default function DocumentsScreen() {
  const route = useRoute()
  if (isPrintWindow()) return <PrintRoot />
  const doc = route.name === 'documents' ? route.doc : undefined
  if (!doc) return <LibraryScreen />
  const parsed = parseDocKey(doc)
  if (!parsed) return <BadLink />
  return <Reader key={doc.split('@')[0]} docRef={parsed.ref} initialPage={parsed.page} />
}

function LibraryScreen() {
  const { t } = useTranslation('documents')
  useScreenTitle(t('title'))
  return <Library />
}

function BadLink() {
  const { t } = useTranslation('documents')
  useScreenTitle(t('title'))
  return (
    <div className="grid flex-1 place-items-center">
      <EmptyState title={t('reader.gone')} body={t('reader.badLink')} action={<Button onClick={() => navigate({ name: 'documents' })}>{t('reader.back')}</Button>} />
    </div>
  )
}
