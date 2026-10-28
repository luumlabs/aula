// «Pedir cambios a Aula»: lo que quieres cambiar o añadir (a todo el curso o a un tema), con materiales opcionales. El
// equipo lo hace en segundo plano (generation.extend) y todo queda en «Cambios de Aula» para deshacerlo.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { Button, Chip, Dialog, Icon, Select, Spinner, TextArea, toast, cx } from '@renderer/design'
import { api, isAulaError } from '@renderer/lib/api'
import { navigate } from '@renderer/app/router'
import type { Pack } from '@shared/schema/pack'
import type { MaterialView } from '@shared/generation/types'

const SUGGESTIONS = ['harder', 'simpler', 'example', 'cards', 'mistake', 'lesson'] as const

export function RequestChangesDialog({ pack, open, onClose, skillId }: { pack: Pack; open: boolean; onClose: () => void; skillId?: string }) {
  const { t } = useTranslation(['course', 'common'])
  const [text, setText] = useState('')
  const [skill, setSkill] = useState<string>(skillId ?? '')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [materials, setMaterials] = useState<MaterialView[]>([])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setText('')
    setSkill(skillId ?? '')
    setDraftId(null)
    setMaterials([])
  }, [open, skillId])

  // progreso de lectura de los materiales añadidos
  useEffect(() => {
    if (!draftId) return
    return api.on('create.material', (e) => {
      if (e.draftId !== draftId) return
      setMaterials((list) => (list.some((m) => m.id === e.material.id) ? list.map((m) => (m.id === e.material.id ? e.material : m)) : [...list, e.material]))
    })
  }, [draftId])

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setAdding(true)
    try {
      const paths = [...files].map((f) => api.pathForFile(f)).filter(Boolean)
      const r = await api.invoke('create.addFiles', { paths, draftId: draftId ?? undefined })
      setDraftId(r.draftId)
      setMaterials(r.materials)
    } catch (e) {
      toast.error(t('changes.filesFailed'), isAulaError(e) || e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const send = async () => {
    const instruction = text.trim()
    if (!instruction) return
    setBusy(true)
    try {
      // el equipo importa antes los materiales del borrador si la instrucción lo nombra
      const full = draftId && materials.length ? `${instruction}\n\n(borrador ${draftId})` : instruction
      const r = await api.invoke('generation.extend', { packId: pack.id, instruction: full, skillId: skill || undefined })
      onClose()
      navigate({ name: 'run', id: r.runId })
    } catch (e) {
      toast.error(t('changes.failed'), isAulaError(e) || e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const reading = materials.some((m) => m.status === 'processing')
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('changes.title')}
      description={t('changes.body')}
      footer={
        <>
          <span className="t-footnote text-text3 mr-auto">{t('changes.undoHint')}</span>
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!text.trim() || reading} onClick={() => void send()} icon={<Icon name="refine" size={15} />}>
            {t('changes.send')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <Select
            label={t('changes.where')}
            value={skill}
            onChange={(v) => setSkill(v)}
            options={[{ value: '', label: t('changes.wholeCourse') }, ...pack.skills.map((s) => ({ value: s.id, label: s.title }))]}
          />
        </div>
        <TextArea autoGrow value={text} onChange={(e) => setText(e.target.value)} placeholder={t('changes.placeholder')} rows={4} autoFocus aria-label={t('changes.title')} />
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((k) => (
            <Chip key={k} onClick={() => setText((v) => (v.trim() ? `${v.trim()} ${t(`changes.suggest.${k}`)}` : t(`changes.suggest.${k}`)))}>
              {t(`changes.chip.${k}`)}
            </Chip>
          ))}
        </div>
        <div className="rounded-[16px] bg-sunken p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="t-ui font-medium">{t('changes.materials')}</div>
              <div className="t-footnote text-text3">{t('changes.materialsHint')}</div>
            </div>
            <Button size="sm" variant="secondary" loading={adding} icon={<Icon name="attach" size={14} />} onClick={() => fileInput.current?.click()}>
              {t('changes.addFiles')}
            </Button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
          </div>
          <AnimatePresence initial={false}>
            {materials.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2.5 mt-2.5">
                {m.status === 'processing' ? <Spinner size={13} /> : <Icon name={m.status === 'failed' ? 'alert-circle' : 'file-text'} size={15} className={cx(m.status === 'failed' ? 'text-danger' : 'text-text3')} />}
                <span className="t-callout truncate flex-1">{m.title}</span>
                <span className={cx('t-caption truncate max-w-[50%]', m.status === 'failed' ? 'text-danger' : 'text-text3')}>{m.status === 'failed' ? m.error : m.detail ?? ''}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Dialog>
  )
}
