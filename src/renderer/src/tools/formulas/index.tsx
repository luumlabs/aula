// Fórmulas: hoja buscable de matemáticas, física y química (con «cuándo se usa» y qué es cada letra) y tabla de
// constantes físicas. Copiar el LaTeX con un clic; las favoritas se marcan con una estrella y se guardan.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Search, Star, X } from 'lucide-react'
import { Card, EmptyState, IconButton, cx, spring, useTheme } from '@renderer/design'
import { Tex } from '../shared/Tex'
import { toneInk } from '../shared/palette'
import { useCopy, useStored } from '../shared/ui'
import type { ToolProps } from '../registry'
import { CONSTANTS, FORMULAS, texOf, type Constant, type FormulaEntry, type Subject } from './lib/data'
import { groupByTopic, localizeDecimal, searchConstants, searchFormulas, type Lang } from './lib/search'

type Filter = Subject | 'all' | 'constants' | 'favorites'

const SUBJECT_TONE = { math: 'slate', physics: 'coral', chemistry: 'sage' } as const

export default function FormulasTool(_props: ToolProps) {
  const { t, i18n } = useTranslation('tools')
  const lang: Lang = i18n.language.startsWith('es') ? 'es' : 'en'
  const { dark } = useTheme()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useStored<Filter>('aula.tools.formulas.filter', 'all')
  const [favs, setFavs] = useStored<string[]>('aula.tools.formulas.favs', [])
  const favSet = useMemo(() => new Set(favs), [favs])
  const subject: Subject | 'all' = filter === 'math' || filter === 'physics' || filter === 'chemistry' ? filter : 'all'
  const list = useMemo(() => (filter === 'constants' ? [] : searchFormulas(query, lang, subject, filter === 'favorites' ? favSet : undefined)), [query, lang, subject, filter, favSet])
  const groups = useMemo(() => (query.trim() ? [{ topic: t('formulas.results'), subject: 'math' as Subject, items: list }] : groupByTopic(list, lang)), [list, lang, query, t])
  const consts = useMemo(() => (filter === 'all' || filter === 'constants' ? searchConstants(query, lang) : []), [filter, query, lang])
  const toggleFav = (id: string) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))

  const chips: { id: Filter; count: number }[] = [
    { id: 'all', count: FORMULAS.length + CONSTANTS.length },
    { id: 'math', count: FORMULAS.filter((f) => f.subject === 'math').length },
    { id: 'physics', count: FORMULAS.filter((f) => f.subject === 'physics').length },
    { id: 'chemistry', count: FORMULAS.filter((f) => f.subject === 'chemistry').length },
    { id: 'constants', count: CONSTANTS.length },
    { id: 'favorites', count: favs.length }
  ]

  return (
    <div className="flex flex-col gap-5">
      <Card padded className="flex flex-col gap-3">
        <label className="relative flex items-center">
          <Search size={17} className="absolute left-3.5 text-text3 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder={t('formulas.search')}
            aria-label={t('formulas.search')}
            autoFocus
            className="w-full h-11 rounded-[12px] bg-field border-[0.5px] border-line-strong/40 pl-10 pr-9 text-[15px] outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-wash)]"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 text-text3 hover:text-text" aria-label={t('formulas.clear')}>
              <X size={15} />
            </button>
          )}
        </label>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {chips.map((c) => {
            const on = filter === c.id
            const tone = c.id === 'math' || c.id === 'physics' || c.id === 'chemistry' ? toneInk(SUBJECT_TONE[c.id], dark) : null
            return (
              <button key={c.id} role="tab" aria-selected={on} onClick={() => setFilter(c.id)} className={cx('relative h-8 px-3 rounded-full inline-flex items-center gap-1.5 t-ui font-medium transition-colors', on ? 'text-accent-text' : 'text-text2 hover:text-text hover:bg-fill1')}>
                {on && <motion.span layoutId="formulas-filter" transition={spring.snappy} className="absolute inset-0 rounded-full bg-accent-wash" />}
                {tone && <span className="relative w-2 h-2 rounded-[2px]" style={{ background: tone }} />}
                {c.id === 'favorites' && <Star size={13} className="relative" />}
                <span className="relative">{t(`formulas.filter.${c.id}`)}</span>
                <span className="relative t-caption tabular">{c.count}</span>
              </button>
            )
          })}
        </div>
      </Card>

      {groups.every((g) => g.items.length === 0) && consts.length === 0 ? (
        <EmptyState title={filter === 'favorites' && !query ? t('formulas.noFavs') : t('formulas.none')} body={filter === 'favorites' && !query ? t('formulas.noFavsBody') : t('formulas.noneBody')} />
      ) : (
        groups.map((g) =>
          g.items.length ? (
            <section key={g.topic}>
              <div className="flex items-center gap-2 mb-2.5 px-1">
                {!query.trim() && <span className="w-2 h-2 rounded-[2px]" style={{ background: toneInk(SUBJECT_TONE[g.subject], dark) }} />}
                <h2 className="t-title2 text-[20px]">{g.topic}</h2>
                <span className="t-caption tabular">{g.items.length}</span>
              </div>
              <div className="grid gap-4 grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3">
                {g.items.map((f, i) => (
                  <FormulaCard key={f.id} f={f} lang={lang} index={i} fav={favSet.has(f.id)} onFav={() => toggleFav(f.id)} />
                ))}
              </div>
            </section>
          ) : null
        )
      )}
      {consts.length > 0 && <Constants list={consts} lang={lang} />}
    </div>
  )
}

function FormulaCard({ f, lang, index, fav, onFav }: { f: FormulaEntry; lang: Lang; index: number; fav: boolean; onFav: () => void }) {
  const { t } = useTranslation('tools')
  const copy = useCopy()
  const { dark } = useTheme()
  const [copied, setCopied] = useState(false)
  const tex = localizeDecimal(texOf(f, lang), lang)
  return (
    <Card
      padded={false}
      interactive
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index, 10) * 0.035 }}
      className="group flex flex-col"
      mark={toneInk(SUBJECT_TONE[f.subject], dark)}
    >
      <div className="flex items-start gap-2 px-5 pt-4">
        <div className="flex-1 min-w-0">
          <div className="t-headline">{f.name[lang]}</div>
          <div className="t-caption mt-0.5">{f.topic[lang]}</div>
        </div>
        <IconButton label={fav ? t('formulas.unfav') : t('formulas.fav')} size="sm" onClick={onFav} className={cx(fav ? 'text-sun' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}>
          <motion.span animate={{ scale: fav ? [1, 1.35, 1] : 1 }} transition={{ duration: 0.3 }} className="grid place-items-center">
            <Star size={15} fill={fav ? 'currentColor' : 'none'} />
          </motion.span>
        </IconButton>
        <IconButton
          label={t('common.copyLatex')}
          size="sm"
          onClick={() => {
            copy(tex)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          }}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={copied ? 'ok' : 'copy'} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} className="grid place-items-center">
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            </motion.span>
          </AnimatePresence>
        </IconButton>
      </div>
      <div className="mx-5 mt-3 rounded-[14px] bg-sunken px-4 py-3.5 overflow-x-auto overflow-y-hidden text-[16px] selectable flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
        {/* las partes separadas por \qquad se reparten en líneas si no caben */}
        {tex.split('\\qquad').map((part, i) => (
          <Tex key={i} tex={part.trim()} display />
        ))}
      </div>
      <div className="px-5 pt-3 pb-4">
        <p className="t-callout text-text2">{f.when[lang]}</p>
        {f.vars && <p className="t-footnote mt-1.5">{f.vars[lang]}</p>}
      </div>
    </Card>
  )
}

function plainValue(c: Constant, lang: Lang): string {
  const v = c.value.replace(/\\,/g, '').replace(/\{,\}/g, '.')
  const m = /^([\d.]+)\\times10\^\{(-?\d+)\}$/.exec(v)
  const s = m ? `${m[1]}e${m[2]}` : v
  return lang === 'es' ? s.replace('.', ',') : s
}

function Constants({ list, lang }: { list: Constant[]; lang: Lang }) {
  const { t } = useTranslation('tools')
  const copy = useCopy()
  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5 px-1">
        <h2 className="t-title2 text-[20px]">{t('formulas.constants')}</h2>
        <span className="t-caption tabular">{list.length}</span>
      </div>
      <Card padded={false} className="overflow-hidden">
        {list.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 14) * 0.025 }}
            className="group grid grid-cols-[56px_minmax(0,1fr)_auto_36px] @3xl:grid-cols-[64px_minmax(0,1.2fr)_minmax(0,1fr)_120px_36px] items-center gap-3 px-5 py-2.5 border-t-[0.5px] border-line-soft first:border-t-0 hover:bg-fill1"
          >
            <span className="text-[17px] text-accent-text">
              <Tex tex={c.symbol} />
            </span>
            <span className="t-callout text-text2 truncate">
              {c.name[lang]}
              {c.exact && <span className="ml-2 t-caption text-success">{t('formulas.exact')}</span>}
            </span>
            <span className="text-[15px] text-right @3xl:text-left whitespace-nowrap selectable">
              <Tex tex={localizeDecimal(c.value, lang)} />
            </span>
            <span className="hidden @3xl:block t-ui text-text3">{c.unit}</span>
            <IconButton label={t('formulas.copyValue')} size="sm" onClick={() => copy(plainValue(c, lang))} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
              <Copy size={14} />
            </IconButton>
          </motion.div>
        ))}
      </Card>
    </section>
  )
}
