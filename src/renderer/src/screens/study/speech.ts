// Leer en voz alta (tarjetas de idiomas, lecciones) con la síntesis de voz del sistema. Se calla al salir.
import { useCallback, useEffect, useState } from 'react'
import type { Block } from '@shared/schema/blocks'

/** Texto plano legible de Markdown con fórmulas (sin $, **, #…). */
export function speakable(md: string): string {
  return md
    .replace(/\$\$?([^$]*)\$\$?/g, (_, tex: string) => tex.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_]/g, ' '))
    .replace(/[*_`#>|]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{\{c\d+::([^}:]*)(::[^}]*)?\}\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lo que se lee de unos bloques (textos, avisos, ejemplos y resúmenes). */
export function blocksSpeech(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'text': return speakable(b.md)
        case 'callout': return speakable([b.title ?? '', b.md].join('. '))
        case 'example': return speakable([b.title ?? '', b.problem, ...b.steps.map((s) => s.md), b.answer ?? ''].join('. '))
        case 'recap': return speakable(b.points.join('. '))
        case 'steps': return speakable(b.steps.map((s) => [s.title ?? '', s.md].join('. ')).join('. '))
        default: return ''
      }
    })
    .filter(Boolean)
    .join('. ')
}

export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window

export function useSpeech(): { speaking: boolean; speak: (text: string, lang?: string) => void; stop: () => void } {
  const [speaking, setSpeaking] = useState(false)
  const stop = useCallback(() => {
    if (!canSpeak()) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])
  const speak = useCallback((text: string, lang?: string) => {
    if (!canSpeak() || !text.trim()) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    if (lang) {
      u.lang = lang
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)))
      if (voice) u.voice = voice
    }
    u.rate = 0.96
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(u)
  }, [])
  useEffect(() => stop, [stop])
  return { speaking, speak, stop }
}
