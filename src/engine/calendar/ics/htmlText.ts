// HTML → texto limpio / Markdown ligero (portado de CanvasKit/Text: HTMLEntities, HTMLParser y HTMLText).
// Pensado para el HTML de Canvas, Outlook, Google Calendar o Word en las descripciones de los eventos. Tolerante: nunca
// lanza ni se cuelga con entradas malformadas.

import { mathMLToLatex } from './mathml'

// MARK: - Entidades

const ENTITY_TABLE: Record<string, number> = (() => {
  const raw = `quot:34 amp:38 apos:39 lt:60 gt:62 nbsp:160 iexcl:161 cent:162 pound:163 curren:164 yen:165 brvbar:166 sect:167 uml:168 copy:169
ordf:170 laquo:171 not:172 shy:173 reg:174 macr:175 deg:176 plusmn:177 sup2:178 sup3:179 acute:180 micro:181 para:182 middot:183
cedil:184 sup1:185 ordm:186 raquo:187 frac14:188 frac12:189 frac34:190 iquest:191 Agrave:192 Aacute:193 Acirc:194 Atilde:195
Auml:196 Aring:197 AElig:198 Ccedil:199 Egrave:200 Eacute:201 Ecirc:202 Euml:203 Igrave:204 Iacute:205 Icirc:206 Iuml:207 ETH:208
Ntilde:209 Ograve:210 Oacute:211 Ocirc:212 Otilde:213 Ouml:214 times:215 Oslash:216 Ugrave:217 Uacute:218 Ucirc:219 Uuml:220
Yacute:221 THORN:222 szlig:223 agrave:224 aacute:225 acirc:226 atilde:227 auml:228 aring:229 aelig:230 ccedil:231 egrave:232
eacute:233 ecirc:234 euml:235 igrave:236 iacute:237 icirc:238 iuml:239 eth:240 ntilde:241 ograve:242 oacute:243 ocirc:244
otilde:245 ouml:246 divide:247 oslash:248 ugrave:249 uacute:250 ucirc:251 uuml:252 yacute:253 thorn:254 yuml:255 OElig:338
oelig:339 Scaron:352 scaron:353 Yuml:376 fnof:402 circ:710 tilde:732 Alpha:913 Beta:914 Gamma:915 Delta:916 Epsilon:917 Zeta:918
Eta:919 Theta:920 Iota:921 Kappa:922 Lambda:923 Mu:924 Nu:925 Xi:926 Omicron:927 Pi:928 Rho:929 Sigma:931 Tau:932 Upsilon:933
Phi:934 Chi:935 Psi:936 Omega:937 alpha:945 beta:946 gamma:947 delta:948 epsilon:949 zeta:950 eta:951 theta:952 iota:953 kappa:954
lambda:955 mu:956 nu:957 xi:958 omicron:959 pi:960 rho:961 sigmaf:962 sigma:963 tau:964 upsilon:965 phi:966 chi:967 psi:968
omega:969 thetasym:977 upsih:978 piv:982 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 ndash:8211
mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 bull:8226 hellip:8230
permil:8240 prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476
trade:8482 alefsym:8501 larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659
hArr:8660 forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722
lowast:8727 radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773
asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869
sdot:8901 lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 lang:9001 rang:9002 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830`
  const out: Record<string, number> = {}
  for (const pair of raw.split(/\s+/)) {
    const [k, v] = pair.split(':')
    if (k && v) out[k] = Number(v)
  }
  return out
})()

function resolveEntity(name: string): string | null {
  if (name.startsWith('#')) {
    const body = name.slice(1)
    const hex = body.startsWith('x') || body.startsWith('X')
    const digits = hex ? body.slice(1) : body
    if (!(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) return null
    const v = parseInt(digits, hex ? 16 : 10)
    if (!Number.isFinite(v)) return null
    if (v === 0 || (v >= 0xd800 && v <= 0xdfff) || v > 0x10ffff) return '�'
    return String.fromCodePoint(v)
  }
  const code = Object.prototype.hasOwnProperty.call(ENTITY_TABLE, name) ? ENTITY_TABLE[name] : undefined
  return code === undefined ? null : String.fromCodePoint(code)
}

/** Reemplaza las entidades reconocidas (`&amp;`, `&eacute;`, `&#233;`, `&#xE9;`); las desconocidas se dejan. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  const cps = Array.from(s)
  let out = ''
  let i = 0
  while (i < cps.length) {
    const c = cps[i]
    if (c === '&') {
      let j = i + 1
      const limit = Math.min(cps.length, i + 34)
      while (j < limit && cps[j] !== ';' && cps[j] !== '&' && cps[j] !== ' ' && cps[j] !== '<') j++
      if (j < limit && cps[j] === ';' && j > i + 1) {
        const decoded = resolveEntity(cps.slice(i + 1, j).join(''))
        if (decoded !== null) {
          out += decoded
          i = j + 1
          continue
        }
      }
    }
    out += c
    i++
  }
  return out
}

// MARK: - Árbol HTML

export interface HTMLNode {
  /** Etiqueta en minúsculas; '' en los nodos de texto; '#root' en la raíz. */
  tag: string
  attrs: Record<string, string>
  text: string
  children: HTMLNode[]
}

const node = (tag: string, attrs: Record<string, string> = {}, text = ''): HTMLNode => ({ tag, attrs, text, children: [] })

function rawText(n: HTMLNode): string {
  if (n.tag === '') return n.text
  let s = ''
  for (const c of n.children) s += c.tag === 'br' ? '\n' : rawText(c)
  return s
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'command', 'keygen'])
const RAW_SKIP_TAGS = new Set(['script', 'style', 'textarea', 'title'])
const CLOSES_PARAGRAPH = new Set(['p', 'div', 'ul', 'ol', 'dl', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'hr', 'section', 'article',
  'aside', 'header', 'footer', 'nav', 'main', 'form', 'fieldset', 'figure', 'address', 'details', 'center'])
const MAX_DEPTH = 200

const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c)
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'

/** Analizador tolerante: etiquetas sin cerrar, atributos sin comillas, comentarios, CDATA, `<script>`/`<style>`, `<` suelto. */
export function parseHTML(html: string): HTMLNode {
  const n = html.length
  const lowerHTML = html.toLowerCase()
  const root = node('#root')
  const stack: HTMLNode[] = [root]
  let i = 0
  let textStart = 0
  const top = () => stack[stack.length - 1]

  const appendRaw = (decoded: string) => {
    if (!decoded) return
    const last = top().children[top().children.length - 1]
    if (last && last.tag === '') last.text += decoded
    else top().children.push(node('', {}, decoded))
  }
  const flushText = (end: number) => {
    if (end > textStart) appendRaw(decodeEntities(html.slice(textStart, end)))
  }
  const closeUntil = (targets: Set<string>, boundaries: Set<string>) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag
      if (targets.has(t)) { stack.length = k; return }
      if (boundaries.has(t)) return
    }
  }
  const open = (tag: string, attrs: Record<string, string>, selfClosing: boolean) => {
    switch (tag) {
      case 'li': closeUntil(new Set(['li']), new Set(['ul', 'ol'])); break
      case 'dt': case 'dd': closeUntil(new Set(['dt', 'dd']), new Set(['dl'])); break
      case 'td': case 'th': closeUntil(new Set(['td', 'th']), new Set(['tr', 'table'])); break
      case 'tr': closeUntil(new Set(['tr']), new Set(['table', 'thead', 'tbody', 'tfoot'])); break
      case 'thead': case 'tbody': case 'tfoot': closeUntil(new Set(['thead', 'tbody', 'tfoot']), new Set(['table'])); break
    }
    if (CLOSES_PARAGRAPH.has(tag)) while (stack.length > 1 && top().tag === 'p') stack.pop()
    const nd = node(tag, attrs)
    top().children.push(nd)
    if (VOID_TAGS.has(tag) || selfClosing) return
    if (stack.length < MAX_DEPTH) stack.push(nd)
  }
  const close = (tag: string) => {
    if (tag === 'br') { open('br', {}, true); return }
    if (VOID_TAGS.has(tag)) return
    const bounded = new Set(['td', 'th', 'tr', 'li', 'dd', 'dt', 'p'])
    const boundaries = bounded.has(tag) ? new Set(['table', 'ul', 'ol', 'dl']) : new Set<string>()
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag
      if (t === tag) { stack.length = k; return }
      if (boundaries.has(t)) return
    }
  }

  while (i < n) {
    if (html[i] !== '<') { i++; continue }
    if (i + 1 >= n) break
    const next = html[i + 1]
    if (next === '!' || next === '?') {
      flushText(i)
      if (next === '!' && html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4)
        i = end < 0 ? n : end + 3
      } else if (next === '!' && lowerHTML.startsWith('<![cdata[', i)) {
        const start = i + 9
        const end = html.indexOf(']]>', start)
        if (end >= 0) { appendRaw(html.slice(start, end)); i = end + 3 } else i = n
      } else {
        const end = html.indexOf('>', i + 2)
        i = end < 0 ? n : end + 1
      }
      textStart = i
      continue
    }
    if (next === '/') {
      if (!isLetter(html[i + 2])) { i++; continue }
      flushText(i)
      let j = i + 2
      const nameStart = j
      while (j < n && !isSpace(html[j]) && html[j] !== '>' && html[j] !== '/') j++
      const name = lowerHTML.slice(nameStart, j)
      while (j < n && html[j] !== '>') j++
      i = Math.min(n, j + 1)
      textStart = i
      close(name)
      continue
    }
    if (!isLetter(next)) { i++; continue }
    flushText(i)
    let j = i + 1
    const nameStart = j
    while (j < n && !isSpace(html[j]) && html[j] !== '>' && html[j] !== '/') j++
    const name = lowerHTML.slice(nameStart, j)
    const attrs: Record<string, string> = {}
    let selfClosing = false
    let terminated = false
    while (j < n) {
      while (j < n && isSpace(html[j])) j++
      if (j >= n) break
      const c = html[j]
      if (c === '>') { j++; terminated = true; break }
      if (c === '/') {
        if (html[j + 1] === '>') { selfClosing = true; j += 2; terminated = true; break }
        j++
        continue
      }
      const aStart = j
      while (j < n && !isSpace(html[j]) && html[j] !== '=' && html[j] !== '>' && html[j] !== '/') j++
      if (j === aStart) { j++; continue }
      const aName = lowerHTML.slice(aStart, j)
      while (j < n && isSpace(html[j])) j++
      let value = ''
      if (html[j] === '=') {
        j++
        while (j < n && isSpace(html[j])) j++
        if (html[j] === '"' || html[j] === "'") {
          const q = html[j]
          j++
          const vStart = j
          while (j < n && html[j] !== q) j++
          value = html.slice(vStart, Math.min(j, n))
          if (j < n) j++
        } else {
          const vStart = j
          while (j < n && !isSpace(html[j]) && html[j] !== '>') j++
          value = html.slice(vStart, j)
        }
      }
      if (!(aName in attrs)) attrs[aName] = decodeEntities(value)
    }
    if (!terminated) { i = n; textStart = n; break }
    i = j
    textStart = i
    if (RAW_SKIP_TAGS.has(name) && !selfClosing) {
      const end = lowerHTML.indexOf(`</${name}`, i)
      const gt = end >= 0 ? html.indexOf('>', end) : -1
      i = gt >= 0 ? gt + 1 : n
      textStart = i
      continue
    }
    open(name, attrs, selfClosing)
  }
  flushText(n)
  return root
}

// MARK: - Render

const MAX_INPUT = 4_000_000

/** ¿Parece contener etiquetas HTML? (`<p>`, `</div>`, `<br/>`, `<a href=…>`) */
export function looksLikeHTML(text: string): boolean {
  if (!text.includes('<')) return false
  for (let i = 0; i + 1 < text.length; i++) {
    if (text[i] !== '<') continue
    let j = i + 1
    if (text[j] === '/' || text[j] === '!') j++
    if (isLetter(text[j])) {
      const limit = Math.min(text.length, j + 300)
      let k = j
      while (k < limit && text[k] !== '>' && text[k] !== '<') k++
      if (k < limit && text[k] === '>') return true
    }
  }
  return false
}

/** HTML → Markdown ligero (títulos, listas, enlaces, tablas, negritas…). Sin etiquetas: texto normalizado. */
export function htmlToMarkdown(html: string): string {
  return render(html, false)
}

/** HTML → texto sin marcas (los enlaces como `texto (url)`). */
export function htmlToPlainText(html: string): string {
  return render(html, true)
}

function render(input: string, plain: boolean): string {
  const html = input.length > MAX_INPUT ? input.slice(0, MAX_INPUT) : input
  if (!looksLikeHTML(html)) return finalize(decodeEntities(html).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/ /g, ' '))
  const r = new MarkdownRenderer(plain)
  return finalize(r.container(parseHTML(html), 0))
}

/** Limpieza final: sin caracteres de control, sin espacios al final de línea, como mucho una línea en blanco seguida. */
export function finalize(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  const out: string[] = []
  let inFence = false
  let blank = 0
  for (const rawLine of text.split('\n')) {
    const isFence = rawLine.startsWith('```')
    if (isFence) inFence = !inFence
    const line = inFence && !isFence ? rawLine : rawLine.replace(/[ \t]+$/, '')
    if (line === '' && !inFence) {
      blank++
      if (blank > 1) continue
    } else blank = 0
    out.push(line)
  }
  return out.join('\n').trim()
}

const SKIPPED = new Set(['script', 'style', 'iframe', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'object', 'embed', 'svg', 'canvas',
  'select', 'option', 'datalist', 'button', 'input', 'textarea', 'audio', 'video', 'source', 'track', 'map', 'area', 'applet'])
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure', 'figcaption', 'address', 'blockquote',
  'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'hr', 'form', 'fieldset', 'details', 'summary', 'center', 'body', 'html', 'legend', 'menu', 'dir'])
const IGNORABLE_CLASSES = ['file_download_btn', 'file_preview_link', 'screenreader-only', 'ui-helper-hidden-accessible']

/** Colapsa espacios (incluye NBSP) y quita invisibles. */
export function collapse(s: string): string {
  let out = ''
  let lastSpace = false
  for (const ch of s) {
    const v = ch.codePointAt(0) as number
    if (v === 0x20 || v === 0x09 || v === 0x0a || v === 0x0d || v === 0x0c || v === 0xa0 || (v >= 0x2002 && v <= 0x200a) || v === 0x202f || v === 0x205f || v === 0x3000) {
      if (!lastSpace) { out += ' '; lastSpace = true }
    } else if (v === 0x200b || v === 0xfeff || v === 0xad) {
      continue
    } else {
      out += ch
      lastSpace = false
    }
  }
  return out
}

const flatten = (s: string) => collapse(s.replace(/\n/g, ' ')).replace(/^[ \t]+|[ \t]+$/g, '')
const trimSpaces = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, '')

function cleanInline(s: string): string {
  if (!s) return ''
  const lines = s.split('\n').map((l) => trimSpaces(collapse(l)))
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const out: string[] = []
  let blank = false
  for (const l of lines) {
    if (l === '') { if (!blank) out.push(l); blank = true } else { out.push(l); blank = false }
  }
  return out.join('\n')
}

class MarkdownRenderer {
  constructor(private readonly plain: boolean) {}

  container(nd: HTMLNode, depth: number): string {
    if (depth > 120) return flatten(rawText(nd))
    let out = ''
    let run = ''
    const flush = () => {
      const p = cleanInline(run)
      run = ''
      if (p) out += p + '\n\n'
    }
    for (const child of nd.children) {
      if (child.tag === '') { run += collapse(child.text); continue }
      if (this.isIgnored(child)) continue
      if (child.tag === 'br') { run += '\n'; continue }
      if (BLOCK_TAGS.has(child.tag)) {
        flush()
        const b = this.block(child, depth + 1)
        if (b) out += b + '\n\n'
      } else {
        run += this.inline(child, depth + 1)
      }
    }
    flush()
    return out.trim()
  }

  private isIgnored(nd: HTMLNode): boolean {
    if (nd.tag === '') return false
    if (SKIPPED.has(nd.tag)) return true
    if ('hidden' in nd.attrs) return true
    if (nd.attrs['aria-hidden']?.toLowerCase() === 'true') return true
    const style = nd.attrs.style?.toLowerCase().replace(/ /g, '')
    if (style && (style.includes('display:none') || style.includes('visibility:hidden'))) return true
    const cls = nd.attrs.class
    if (cls) for (const bad of IGNORABLE_CLASSES) if (cls.includes(bad)) return true
    return false
  }

  private block(nd: HTMLNode, depth: number): string {
    switch (nd.tag) {
      case 'p': case 'caption': case 'legend': case 'figcaption': case 'summary': case 'dt': {
        const t = cleanInline(this.inlineChildren(nd, depth))
        return nd.tag === 'dt' && !this.plain && t ? `**${t}**` : t
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const t = flatten(this.inlineChildren(nd, depth))
        if (!t) return ''
        return this.plain ? t : '#'.repeat(Number(nd.tag[1]) || 1) + ' ' + t
      }
      case 'hr': return this.plain ? '' : '---'
      case 'blockquote': {
        const inner = this.container(nd, depth)
        if (!inner || this.plain) return inner
        return inner.split('\n').map((l) => (l === '' ? '>' : '> ' + l)).join('\n')
      }
      case 'pre': return this.codeBlock(nd)
      case 'ul': case 'menu': case 'dir': return this.list(nd, false, depth)
      case 'ol': return this.list(nd, true, depth)
      case 'li': {
        const body = this.container(nd, depth).replace(/\n\n/g, '\n')
        return body ? '- ' + body : ''
      }
      case 'dd': {
        const body = this.container(nd, depth).replace(/\n\n/g, '\n')
        return body ? (this.plain ? body : ': ' + body) : ''
      }
      case 'table': return this.table(nd, depth)
      default: return this.container(nd, depth)
    }
  }

  private codeBlock(nd: HTMLNode): string {
    let code = rawText(nd).replace(/\r\n/g, '\n').replace(/ /g, ' ')
    code = code.replace(/^\n+/, '').replace(/\n+$/, '')
    if (!code) return ''
    if (this.plain) return code
    let lang = ''
    const classes = [nd.attrs.class, ...nd.children.filter((c) => c.tag === 'code').map((c) => c.attrs.class)]
    for (const c of classes) if (c) for (const token of c.split(' ')) if (token.startsWith('language-')) lang = token.slice(9)
    return '```' + lang + '\n' + code + '\n```'
  }

  private list(nd: HTMLNode, ordered: boolean, depth: number): string {
    const lines: string[] = []
    let index = parseInt(nd.attrs.start ?? '', 10)
    if (!Number.isFinite(index)) index = 1
    for (const child of nd.children) {
      if (child.tag === '') {
        const t = trimSpaces(collapse(child.text))
        if (t) lines.push(t)
        continue
      }
      if (this.isIgnored(child)) continue
      if (child.tag === 'li') {
        const body = this.container(child, depth + 1).replace(/\n\n/g, '\n')
        if (!body) continue
        const marker = ordered ? `${index}. ` : '- '
        index++
        const pad = ' '.repeat(marker.length)
        body.split('\n').forEach((part, k) => lines.push(k === 0 ? marker + part : part === '' ? '' : pad + part))
      } else if (child.tag === 'ul' || child.tag === 'ol') {
        for (const l of this.list(child, child.tag === 'ol', depth + 1).split('\n')) if (l) lines.push('  ' + l)
      } else {
        const body = BLOCK_TAGS.has(child.tag) ? this.block(child, depth + 1) : cleanInline(this.inline(child, depth + 1))
        if (body) lines.push(body.replace(/\n\n/g, '\n'))
      }
    }
    return lines.join('\n')
  }

  private table(nd: HTMLNode, depth: number): string {
    const rows: string[][] = []
    let headerRows = 0
    const captions: string[] = []
    const collect = (n: HTMLNode) => {
      for (const c of n.children) {
        if (c.tag === '' || this.isIgnored(c)) continue
        if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collect(c)
        else if (c.tag === 'caption') {
          const t = flatten(this.inlineChildren(c, depth + 1))
          if (t) captions.push(t)
        } else if (c.tag === 'tr') {
          const cells: string[] = []
          let allTh = true, any = false
          for (const cell of c.children) {
            if (cell.tag !== 'td' && cell.tag !== 'th') continue
            if (this.isIgnored(cell)) continue
            any = true
            if (cell.tag !== 'th') allTh = false
            cells.push(flatten(this.container(cell, depth + 2)).replace(/\|/g, '\\|'))
            const span = Math.min(20, Math.max(1, parseInt(cell.attrs.colspan ?? '', 10) || 1))
            for (let k = 1; k < span; k++) cells.push('')
          }
          if (any) {
            rows.push(cells)
            if (allTh && rows.length === headerRows + 1) headerRows++
          }
        }
      }
    }
    collect(nd)
    const parts: string[] = []
    if (captions[0]) parts.push(captions[0])
    if (rows.length === 0) return parts.join('\n\n')
    if (rows.length === 1 && rows[0].length === 1) {
      const content = nd.children.filter((tr) => tr.tag !== '' && tr.tag !== 'caption').map((tr) => this.container(tr, depth + 1))
      const inner = content.join('\n\n').trim()
      return [...parts, ...(inner ? [inner] : [])].join('\n\n')
    }
    const columns = Math.max(...rows.map((r) => r.length))
    const padded = rows.map((r) => [...r, ...new Array<string>(columns - r.length).fill('')])
    if (this.plain) {
      parts.push(padded.map((r) => r.join(' | ')).join('\n'))
      return parts.join('\n\n')
    }
    const md = ['| ' + padded[0].join(' | ') + ' |', '|' + new Array<string>(columns).fill(' --- ').join('|') + '|']
    for (const r of padded.slice(1)) md.push('| ' + r.join(' | ') + ' |')
    parts.push(md.join('\n'))
    return parts.join('\n\n')
  }

  private inlineChildren(nd: HTMLNode, depth: number): string {
    if (depth > 150) return collapse(rawText(nd))
    let s = ''
    for (const child of nd.children) {
      if (child.tag === '') s += collapse(child.text)
      else if (!this.isIgnored(child)) s += this.inline(child, depth + 1)
    }
    return s
  }

  private inline(nd: HTMLNode, depth: number): string {
    if (this.isIgnored(nd)) return ''
    switch (nd.tag) {
      case 'br': return '\n'
      case 'b': case 'strong': return this.wrap(this.inlineChildren(nd, depth), '**')
      case 'i': case 'em': case 'cite': case 'dfn': case 'var': return this.wrap(this.inlineChildren(nd, depth), '*')
      case 's': case 'strike': case 'del': return this.wrap(this.inlineChildren(nd, depth), '~~')
      case 'code': case 'kbd': case 'samp': case 'tt': {
        const inner = flatten(rawText(nd))
        if (!inner) return ''
        if (this.plain) return inner
        const fence = inner.includes('`') ? '``' : '`'
        return fence + inner + fence
      }
      case 'a': return this.link(nd, depth)
      case 'img': return this.image(nd)
      case 'sup': return this.script(this.inlineChildren(nd, depth), '^')
      case 'sub': return this.script(this.inlineChildren(nd, depth), '_')
      case 'math': {
        const tex = mathLatex(nd)
        return tex ? '$' + tex + '$' : ''
      }
      default:
        if (BLOCK_TAGS.has(nd.tag)) return ' ' + flatten(this.block(nd, depth)) + ' '
        return this.inlineChildren(nd, depth)
    }
  }

  private wrap(inner: string, marker: string): string {
    if (this.plain) return inner
    const core = inner.trim()
    if (!core) return inner.includes(' ') || inner.includes('\n') ? ' ' : ''
    const lead = /^\s*/.exec(inner)?.[0] ?? ''
    const trail = /\s*$/.exec(inner)?.[0] ?? ''
    const already = marker === '*'
      ? core.length > 2 && core.startsWith('*') && !core.startsWith('**') && core.endsWith('*') && !core.endsWith('**')
      : core.length > marker.length * 2 && core.startsWith(marker) && core.endsWith(marker)
    if (already) return inner
    return lead + marker + core + marker + trail
  }

  private script(inner: string, marker: string): string {
    const t = flatten(inner)
    if (!t) return ''
    if (['st', 'nd', 'rd', 'th', 'o', 'a', 'º', 'ª'].includes(t.toLowerCase())) return t
    const chars = Array.from(t)
    const simple = chars.length === 1 || (chars.length <= 3 && chars.every((c) => /[\p{L}\p{N}]/u.test(c)))
    return simple ? marker + t : marker + '(' + t + ')'
  }

  private resolve(raw: string | undefined): string | null {
    const href = raw?.trim()
    if (!href) return null
    const lower = href.toLowerCase()
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:') || lower.startsWith('blob:')) return null
    if (href.startsWith('#')) return null
    return href
  }

  private escapeURL(url: string): string {
    return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
  }

  private link(nd: HTMLNode, depth: number): string {
    const inner = this.inlineChildren(nd, depth)
    const text = flatten(inner)
    const lead = /^\s/.test(inner) ? ' ' : ''
    const trail = /\s$/.test(inner) && text ? ' ' : ''
    const href = this.resolve(nd.attrs.href)
    if (!href) return inner
    if (!text) {
      const t = nd.attrs.title
      if (t && !this.plain) return `[${t}](${this.escapeURL(href)})`
      return href
    }
    if (text === href || text === href.replace('mailto:', '')) return lead + href + trail
    if (this.plain) return lead + text + ' (' + href + ')' + trail
    return lead + '[' + text + '](' + this.escapeURL(href) + ')' + trail
  }

  private image(nd: HTMLNode): string {
    const a = nd.attrs
    const cls = (a.class ?? '').toLowerCase()
    const eq = a['data-equation-content']?.trim()
    if (eq) return '$' + eq + '$'
    const alt = (a.alt ?? '').trim()
    if (alt.toLowerCase().startsWith('latex:')) {
      const tex = alt.slice(6).trim()
      if (tex) return '$' + tex + '$'
    }
    if (cls.includes('equation_image')) {
      const title = a.title?.trim()
      if (title) return '$' + title + '$'
      const tex = latexFromEquationSrc(a.src ?? '')
      if (tex) return '$' + tex + '$'
    }
    const rawSrc = a.src?.trim()
    if (!rawSrc) return alt
    const lowerSrc = rawSrc.toLowerCase()
    if (lowerSrc.startsWith('data:') || lowerSrc.includes('/images/svg-icons/') || lowerSrc.includes('/images/emoji') || cls.includes('emoji') || 'data-emoji' in a) return alt
    if (this.plain) return alt
    const src = this.resolve(rawSrc)
    if (!src) return alt
    return `![${alt.replace(/\n/g, ' ')}](${this.escapeURL(src)})`
  }
}

/** `/equation_images/%255Csin%2528x%2529?scale=1` → `\sin(x)` (el LaTeX viene codificado dos veces). */
export function latexFromEquationSrc(src: string): string | null {
  const at = src.indexOf('/equation_images/')
  if (at < 0) return null
  let tail = src.slice(at + '/equation_images/'.length)
  const q = tail.indexOf('?')
  if (q >= 0) tail = tail.slice(0, q)
  const dec = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
  const t = dec(dec(tail)).trim()
  return t || null
}

/** MathML → LaTeX (ver `mathml.ts`), en una sola línea. */
function mathLatex(nd: HTMLNode): string {
  return flatten(mathMLToLatex(nd))
}
