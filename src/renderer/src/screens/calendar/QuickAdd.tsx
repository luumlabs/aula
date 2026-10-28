// La cápsula flotante para añadir hablando normal: «Prueba de inglés el lunes a las 10».
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Icon, Kbd, spring, toast } from '@renderer/design'
import { quickAdd } from './data'

export function QuickAdd({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation('calendar')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (text.trim().length < 4) {
      setPreview(null)
      return
    }
    timer.current = setTimeout(async () => {
      const r = await quickAdd(text, false)
      setPreview(r?.summary || null)
    }, 300)
  }, [text])
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    const r = await quickAdd(text, true)
    setBusy(false)
    if (r) {
      toast.success(t('added'), r.summary)
      setText('')
      setPreview(null)
      onAdded()
    }
  }
  return (
    <motion.div className="pointer-events-auto w-[min(640px,90%)]" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring.bouncy, delay: 0.25 }}>
      <AnimatePresence>
        {preview && (
          <motion.div className="mb-2 mx-4 t-ui text-text2 material-menu rounded-[12px] px-3 py-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
            {t('quickPreview', { what: preview })}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-2.5 h-12 rounded-full material-menu px-4 focus-within:shadow-[var(--e3),0_0_0_3px_var(--accent-wash)] transition-shadow">
        <span className="text-accent-text">
          <Icon name="plus" size={18} />
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder={t('quickPlaceholder')}
          className="flex-1 bg-transparent outline-none t-callout placeholder:text-text3"
          aria-label={t('add')}
        />
        {text && <Kbd>↩</Kbd>}
      </div>
    </motion.div>
  )
}
