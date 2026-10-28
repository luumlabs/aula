// Guiones que Aula ejecuta en un MUNDO AISLADO de la página (`executeJavaScriptInIsolatedWorld`): comparten el DOM pero ninguno
// de sus objetos JavaScript, así que la página no puede falsear lo que Aula lee ni lo que pulsa. Ideas de
// la app Swift anterior: Sources/BrowserKit/Page/PageScripts.swift (lectura en Markdown, enlaces, muros, contraseñas, localizar).
// Los valores de los campos de formulario NUNCA se leen. Las referencias [e12] viven en el mundo aislado (WeakRef).
import { readFileSync } from 'node:fs'
import { REMEMBER_ME_SELECTORS } from '@engine/platforms'

/** Mundo aislado propio de Aula (constante: el estado de las referencias vive ahí mientras dure el documento). */
export const AULA_WORLD = 7301

const lit = (v: unknown): string => JSON.stringify(v ?? null)

/** Funciones comunes (visibilidad, etiqueta accesible, campos sensibles, estado de las referencias). */
const COMMON = String.raw`
var A = window.__aula || (window.__aula = { refs: new Map(), ids: new WeakMap(), next: 1 });
function flat(s){ return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
function vis(el){
  try { if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; } catch (e) {}
  var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
}
function sensitiveField(el){
  var type = String(el.getAttribute("type") || "text").toLowerCase();
  var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
  var lab = ""; try { if (el.labels && el.labels.length) lab = String(el.labels[0].innerText || ""); } catch (e) {}
  var names = (String(el.getAttribute("name") || "") + " " + String(el.id || "") + " " + String(el.getAttribute("aria-label") || "") + " " +
    String(el.getAttribute("placeholder") || "") + " " + lab).toLowerCase();
  return type === "password" || /(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)/.test(ac) ||
    /(password|passwd|passcode|contrase|senha|passwort|kennwort|mot de passe|pwd|one.?time|verification.?code|security.?code|card.?number|credit.?card|tarjeta de cr[eé]dito|n[uú]mero de tarjeta|c[oó]digo de (seguridad|verificaci|acceso|autenticaci|recuperaci)|(^|[^a-z0-9])(otp|pin|cvv|cvc|csc|cvv2|ssn|iban|2fa|mfa)([^a-z0-9]|$))/.test(names);
}
function isField(el){
  var tag = String(el.tagName || "").toLowerCase(), type = String(el.getAttribute("type") || "").toLowerCase();
  return el.isContentEditable || tag === "textarea" || tag === "select" || (tag === "input" && !/^(button|submit|reset|image)$/.test(type));
}
function label(el){
  if (isField(el)) {
    var lab = ""; try { if (el.labels && el.labels.length) lab = String(el.labels[0].innerText || ""); } catch (e) {}
    var c = [el.getAttribute("aria-label"), el.getAttribute("title"), lab, el.getAttribute("placeholder"), el.getAttribute("name")];
    for (var j = 0; j < c.length; j++) { var t0 = flat(c[j]); if (t0) return t0.slice(0, 200); }
    return "";
  }
  var t = flat(el.innerText);
  if (!t) t = flat(el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt") || (el.tagName === "INPUT" ? el.value : ""));
  if (!t && el.querySelector) { var im = el.querySelector("img[alt]"); if (im) t = flat(im.getAttribute("alt")); }
  return t.slice(0, 200);
}
function roleOf(el){
  var tag = String(el.tagName || "").toLowerCase(), type = String(el.getAttribute("type") || "").toLowerCase(), role = String(el.getAttribute("role") || "").toLowerCase();
  if (role) return role;
  if (tag === "a" || tag === "area") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "input") {
    if (/^(submit|button|reset|image)$/.test(type)) return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "password") return "passwordfield";
    if (type === "search") return "searchfield";
    if (type === "file") return "file";
    return "textfield";
  }
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "combobox";
  return el.isContentEditable ? "textarea" : "button";
}
function dialogOf(el){
  // el diálogo o modal abierto que contiene el control (también a través de shadow DOM): su texto decide el peligro de «Sí/OK»
  var n = el, hops = 0;
  while (n && hops++ < 80) {
    if (n.nodeType === 1) {
      var tg = String(n.tagName || "").toLowerCase(), rl = String(n.getAttribute("role") || "").toLowerCase();
      var cl = typeof n.className === "string" ? n.className : "";
      if (rl === "dialog" || rl === "alertdialog" || n.getAttribute("aria-modal") === "true" || (tg === "dialog" && n.open) ||
          tg === "d2l-dialog" || tg === "d2l-dialog-confirm" || tg === "bb-dialog" ||
          /(^|\s)(modal|modal-dialog|modal-content|ui-dialog|moodle-dialogue|moodle-dialogue-base|ReactModal__Content|bb-modal|d2l-dialog)(\s|$)/.test(cl)) {
        var dt = ""; try { dt = String(n.innerText || n.textContent || ""); } catch (e) {}
        var extra = String(n.getAttribute("title-text") || "") + " " + String(n.getAttribute("text") || "") + " " + String(n.getAttribute("aria-label") || "");
        var lb = n.getAttribute("aria-labelledby"); if (lb) { try { var le = document.getElementById(lb); if (le) extra += " " + String(le.innerText || ""); } catch (e) {} }
        return flat(extra + " " + dt).slice(0, 800);
      }
    }
    n = n.parentNode || n.host || null;
  }
  return "";
}
function describe(el){
  var tag = el.tagName.toLowerCase(), type = String(el.getAttribute("type") || "").toLowerCase();
  var form = el.form || (el.closest ? el.closest("form") : null);
  var anchor = el.closest ? el.closest("a[href],area[href]") : null;
  var href = anchor ? String(anchor.href || "") : "";
  var pwForm = false; try { pwForm = !!(form && form.querySelector('input[type="password"]')); } catch (e) {}
  var target = anchor ? String(anchor.getAttribute("target") || "").toLowerCase() : "";
  return {
    tag: tag, role: roleOf(el), label: label(el), type: type,
    href: /^https?:/i.test(href) ? href.slice(0, 4096) : (/^(mailto|tel|javascript):/i.test(href) ? href.slice(0, 200) : ""),
    submits: (tag === "button" && (type === "" || type === "submit") && !!form) || (tag === "input" && (type === "submit" || type === "image")),
    formAction: form && form.action ? String(form.action).slice(0, 4096) : "",
    formMethod: form ? String(form.method || "get").toLowerCase() : "",
    inPasswordForm: pwForm,
    disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
    newWindow: !!target && !/^(_self|_top|_parent)$/.test(target),
    expanded: el.getAttribute("aria-expanded"),
    sensitive: isField(el) && sensitiveField(el),
    dialogText: dialogOf(el)
  };
}
function refFor(el){
  var r = A.ids.get(el);
  if (!r) { r = "e" + (A.next++); A.ids.set(el, r); A.refs.set(r, new WeakRef(el)); }
  return r;
}
`

/** Datos de la página: dirección, título, campo de contraseña, muros (CAPTCHA o desafío). */
export function pageStateScript(): string {
  return String.raw`(function(){
  ${COMMON}
  function q(root, s){ try { return root.querySelector(s); } catch (e) { return null; } }
  function deep(root, s, lvl){
    if (!root || lvl > 6) return null;
    var hit = q(root, s); if (hit) return hit;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return null; }
    for (var i = 0; i < all.length && i < 4000; i++) { var sr = all[i].shadowRoot; if (sr) { hit = deep(sr, s, lvl + 1); if (hit) return hit; } }
    return null;
  }
  var wall = "";
  if (deep(document, '.g-recaptcha,#g-recaptcha,.h-captcha,.cf-turnstile,#captcha,iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],iframe[title*="captcha" i]', 0)) wall = "captcha";
  var txt = ((document.title || "") + " " + (document.body ? (document.body.innerText || "").slice(0, 600) : "")).toLowerCase();
  if (!wall && /(just a moment|verifying you are human|verify you are human|checking your browser|unusual traffic|are you a robot|enable javascript and cookies|verifica que eres humano)/.test(txt)) wall = "challenge";
  var pw = deep(document, 'input[type="password"]', 0);
  return { url: String(location.href), title: flat(document.title).slice(0, 300), hasPassword: !!(pw && vis(pw)), wall: wall,
           htmlHead: document.documentElement ? document.documentElement.outerHTML.slice(0, 120000) : "" };
})()`
}

/**
 * Estado de una página de la ventana de inicio de sesión: dirección, ¿hay campo de contraseña visible?, principio del HTML
 * y si el DOM YA PINTADO (también dentro de shadow DOM) tiene controles que solo existen con la sesión (menú del usuario,
 * «Cerrar sesión») o un formulario de acceso. Nunca lee el valor de ningún campo.
 */
export function signInStateScript(sel: { signedIn: string[]; signedOut: string[] }, withHTML = true): string {
  return String.raw`(function(IN, OUT, HTML){
  ${COMMON}
  function q(root, s){ try { return root.querySelector(s); } catch (e) { return null; } }
  function deep(root, s, lvl){
    if (!root || lvl > 6) return null;
    var hit = q(root, s); if (hit) return hit;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return null; }
    for (var i = 0; i < all.length && i < 4000; i++) { var sr = all[i].shadowRoot; if (sr) { hit = deep(sr, s, lvl + 1); if (hit) return hit; } }
    return null;
  }
  function any(list){ for (var i = 0; i < list.length; i++) { if (deep(document, list[i], 0)) return true; } return false; }
  var pw = deep(document, 'input[type="password"]', 0);
  return { url: String(location.href), hasPassword: !!(pw && vis(pw)), signedInHint: any(IN), signedOutHint: any(OUT),
           ready: String(document.readyState),
           htmlHead: HTML && document.documentElement ? document.documentElement.outerHTML.slice(0, 120000) : "" };
})(${lit(sel.signedIn)}, ${lit(sel.signedOut)}, ${lit(withHTML)})`
}

/**
 * Lectura completa: Markdown de la zona principal (o de toda la página), títulos, enlaces y controles con referencias [eN].
 * `start`: primer número de referencia que se puede usar (para que no se repitan entre páginas).
 */
export function snapshotScript(opts: { start: number; budget?: number; maxElements?: number; full?: boolean }): string {
  return String.raw`(function(START, BUDGET, MAXEL, FULL){
  ${COMMON}
  if (A.next < START) A.next = START;
  var MAIN_SEL = 'main,[role=main],#region-main,#content.ic-Layout-contentMain,.ic-Layout-contentMain,#content,.d2l-page-main,#page-content,.Mrphs-pagebody,article';
  var root = null;
  if (!FULL) { try { var m = document.querySelector(MAIN_SEL); if (m && vis(m) && flat(m.innerText).length > 200) root = m; } catch (e) {} }
  if (!root) root = document.body;
  var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,TEMPLATE:1,SVG:1,CANVAS:1,VIDEO:1,AUDIO:1,OBJECT:1,EMBED:1,MAP:1,HEAD:1,INPUT:1,TEXTAREA:1,SELECT:1,OPTION:1};
  var BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|UL|OL|TABLE|TR|FORM|NAV|ASIDE|BLOCKQUOTE|DL|DD|DT|FIGURE|FIGCAPTION|DETAILS|SUMMARY|FIELDSET|CAPTION|THEAD|TBODY|TFOOT)$/;
  var FENCE = String.fromCharCode(96, 96, 96);
  function contents(el){ try { return getComputedStyle(el).display === "contents"; } catch (e) { return false; } }
  function shown(el){ try { if (el.checkVisibility && !el.checkVisibility()) return contents(el); } catch (e) {} return true; }
  var out = [], budget = BUDGET, truncated = false, ORIGIN = ""; try { ORIGIN = String(location.origin || ""); } catch (e) {}
  function push(s){ if (budget > 0) { out.push(s); budget -= s.length; } else truncated = true; }
  function each(list, d){ if (!list) return; for (var i = 0; i < list.length && budget > 0; i++) walk(list[i], d); }
  function sameOriginDoc(f){ var doc = null; try { doc = f.contentDocument; } catch (e) { return null; } if (!doc || !ORIGIN || ORIGIN === "null") return null; try { if (String(doc.location.origin) !== ORIGIN) return null; } catch (e) { return null; } return doc; }
  var frames = 0;
  function walk(n, d){
    if (d > 80 || budget <= 0) return;
    if (n.nodeType === 3) { var t = n.textContent.replace(/\s+/g, " "); if (t.trim()) push(t); return; }
    if (n.nodeType === 11) { each(n.childNodes, d + 1); return; }
    if (n.nodeType !== 1) return;
    var tag = n.tagName;
    if (SKIP[tag]) return;
    if (n.getAttribute("aria-hidden") === "true") return;
    if (tag === "SLOT") { var as = []; try { as = n.assignedNodes({ flatten: true }) || []; } catch (e) {} each(as.length ? as : n.childNodes, d + 1); return; }
    if (!shown(n)) return;
    if (tag === "IFRAME" || tag === "FRAME") { var doc = sameOriginDoc(n); if (doc && doc.body && frames < 20) { frames++; push("\n"); walk(doc.body, d + 1); push("\n"); } return; }
    if (/^H[1-6]$/.test(tag)) { var h = flat(n.innerText); if (h) push("\n\n" + "######".slice(0, +tag.charAt(1)) + " " + h + "\n"); return; }
    if (tag === "A") {
      var t2 = flat(n.innerText), href = String(n.href || "");
      if (!t2) { var im = n.querySelector("img[alt]"); if (im) t2 = flat(im.getAttribute("alt")); }
      if (t2) push(/^https?:/i.test(href) ? ("[" + t2.replace(/[\[\]]/g, "") + "](" + href + ")") : t2);
      return;
    }
    if (tag === "BUTTON") { var bl = label(n); if (bl && vis(n)) push(" [button " + refFor(n) + ": " + bl.replace(/[\[\]]/g, "") + "] "); return; }
    if (tag === "BR") { push("\n"); return; }
    if (tag === "HR") { push("\n---\n"); return; }
    if (tag === "IMG") { var a = flat(n.getAttribute("alt")); if (a) push("![img: " + a + "]"); return; }
    if (tag === "PRE") { push("\n" + FENCE + "\n" + (n.innerText || "") + "\n" + FENCE + "\n"); return; }
    if (tag === "LI") push("\n- ");
    if (tag === "TD" || tag === "TH") push(" | ");
    var b = BLOCK.test(tag);
    if (b) push("\n");
    if (n.shadowRoot) walk(n.shadowRoot, d + 1); else each(n.childNodes, d + 1);
    if (b) push("\n");
  }
  if (root) walk(root, 0);
  var md = out.join(" ").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  var headings = [];
  try { var hs = document.querySelectorAll("h1,h2,h3,h4"); for (var i = 0; i < hs.length && headings.length < 120; i++) { if (!vis(hs[i])) continue; var ht = flat(hs[i].innerText); if (ht) headings.push({ level: +hs[i].tagName.charAt(1), text: ht.slice(0, 200) }); } } catch (e) {}

  var links = [], seen = {};
  try {
    var as2 = document.querySelectorAll("a[href],area[href]");
    for (var k = 0; k < as2.length && links.length < 1500; k++) {
      var el = as2[k], raw = String(el.getAttribute("href") || ""), hr = String(el.href || "");
      if (!/^https?:/i.test(hr) || raw.charAt(0) === "#") continue;
      var lt = label(el); var key = hr + "\u0000" + lt; if (seen[key]) continue; seen[key] = 1;
      links.push({ ref: refFor(el), text: lt.slice(0, 300), url: hr.slice(0, 4096), visible: vis(el) });
    }
  } catch (e) {}

  var elements = [];
  try {
    var SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=treeitem],[role=option],[onclick],[contenteditable=true]';
    var cands = document.querySelectorAll(SEL);
    for (var c = 0; c < cands.length && elements.length < MAXEL; c++) {
      var e2 = cands[c]; if (!vis(e2)) continue;
      var dsc = describe(e2);
      if (!dsc.label && dsc.role !== "textfield" && dsc.role !== "textarea") continue;
      dsc.ref = refFor(e2);
      elements.push(dsc);
    }
  } catch (e) {}

  var pw = false; try { var p = document.querySelector('input[type="password"]'); pw = !!(p && vis(p)); } catch (e) {}
  return { url: String(location.href), title: flat(document.title).slice(0, 300), markdown: md, truncated: truncated, headings: headings,
           links: links, elements: elements, hasPassword: pw, nextRef: A.next, usedMain: root !== document.body };
})(${lit(opts.start)}, ${lit(opts.budget ?? 400_000)}, ${lit(opts.maxElements ?? 400)}, ${lit(!!opts.full)})`
}

/** Prepara el clic de una referencia: comprueba que sigue siendo lo mismo, la centra y da sus coordenadas. */
export function locateRefScript(ref: string, expected: { label: string; href: string; submits: boolean; formAction: string } | null): string {
  return String.raw`(function(REF, EXPECTED){
  ${COMMON}
  var w = A.refs.get(REF); var el = w ? w.deref() : null;
  if (!el || !el.isConnected) return { ok: false, err: "gone" };
  var d = describe(el);
  if (EXPECTED) { if (d.label !== EXPECTED.label || d.href !== EXPECTED.href || d.submits !== EXPECTED.submits || d.formAction !== EXPECTED.formAction) return { ok: false, err: "changed", now: d }; }
  if (d.disabled) return { ok: false, err: "disabled" };
  try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
  if (!vis(el)) return { ok: false, err: "not_visible" };
  var r = el.getBoundingClientRect(); var x = r.left + r.width / 2, y = r.top + r.height / 2;
  var hit = document.elementFromPoint(x, y);
  return { ok: true, x: Math.round(x), y: Math.round(y), covered: !!(hit && hit !== el && !el.contains(hit) && !hit.contains(el)), desc: d };
})(${lit(ref)}, ${lit(expected)})`
}

/** Clic desde el DOM (cuando otro elemento tapa el objetivo). */
export function domClickScript(ref: string): string {
  return String.raw`(function(REF){
  ${COMMON}
  var w = A.refs.get(REF); var el = w ? w.deref() : null;
  if (!el || !el.isConnected) return { ok: false, err: "gone" };
  try { el.click(); return { ok: true }; } catch (e) { return { ok: false, err: "click_failed" }; }
})(${lit(ref)})`
}

/** Desplaza la página (o lleva una referencia a la vista). */
export function scrollScript(arg: { ref?: string; direction?: 'down' | 'up' | 'top' | 'bottom'; amount?: number }): string {
  return String.raw`(function(ARG){
  ${COMMON}
  if (ARG.ref) { var w = A.refs.get(ARG.ref); var el = w ? w.deref() : null; if (!el) return { ok: false, err: "gone" }; try { el.scrollIntoView({ block: "center" }); } catch (e) {} return { ok: true, y: window.scrollY }; }
  var h = window.innerHeight || 800, amt = ARG.amount || 0.85;
  if (ARG.direction === "top") window.scrollTo(0, 0);
  else if (ARG.direction === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
  else window.scrollBy(0, (ARG.direction === "up" ? -1 : 1) * h * amt);
  return { ok: true, y: window.scrollY, height: document.documentElement.scrollHeight, viewport: h };
})(${lit(arg)})`
}

/** ¿Aparece ya un texto en la página? (para esperar a que cargue algo concreto) */
export function hasTextScript(text: string): string {
  return String.raw`(function(T){ var b = document.body ? String(document.body.innerText || "") : ""; return b.toLowerCase().indexOf(String(T).toLowerCase()) >= 0; })(${lit(text)})`
}

/**
 * Ventana de inicio de sesión: marca las casillas «Recordarme» / «Mantener la sesión iniciada» (nunca escribe ni pulsa nada;
 * el estudiante puede desmarcarlas). Devuelve cuántas marcó.
 */
export function rememberMeScript(): string {
  return String.raw`(function(SELS){
  ${COMMON}
  var n = 0, done = [];
  function tick(el){
    if (!el || el.checked || el.disabled || done.indexOf(el) >= 0 || !vis(el)) return;
    el.checked = true; done.push(el);
    try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
    n++;
  }
  for (var i = 0; i < SELS.length; i++) { var els = []; try { els = document.querySelectorAll(SELS[i]); } catch (e) {} for (var j = 0; j < els.length; j++) tick(els[j]); }
  var boxes = document.querySelectorAll('input[type=checkbox]');
  for (var k = 0; k < boxes.length; k++) {
    var b = boxes[k], lab = "";
    try { if (b.labels && b.labels.length) lab = String(b.labels[0].innerText || ""); } catch (e) {}
    var s = lab.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    if (!s || /(nombre de usuario|username|user name|usuario)$/.test(s)) continue;
    if (/(remember me|keep me (signed|logged) in|stay signed in|recordarme|recuerdame|mantener (la )?sesion|mantenerme conectad|no cerrar sesion|seguir conectad|lembrar de mim|se souvenir de moi|angemeldet bleiben|ricordami)/.test(s)) tick(b);
  }
  return n;
})(${lit(REMEMBER_ME_SELECTORS)})`
}

/** Aviso de «Sesión iniciada» dentro de la ventana de inicio de sesión (antes de cerrarla sola): papel cálido y ladrillo. */
export function successBannerScript(title: string, detail = ''): string {
  return String.raw`(function(T, D){
  try {
    var d = document.createElement("div");
    d.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(43,37,34,.38);font:500 15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#201e1a;opacity:0;transition:opacity .18s ease-out");
    var c = document.createElement("div");
    c.setAttribute("style", "padding:22px 28px;border-radius:20px;background:#fcfaf5;box-shadow:0 18px 50px rgba(43,37,34,.28);display:flex;gap:14px;align-items:center;max-width:440px;transform:translateY(6px) scale(.98);transition:transform .22s cubic-bezier(.2,.8,.2,1)");
    var k = document.createElement("div");
    k.setAttribute("style", "flex:none;width:36px;height:36px;border-radius:12px;background:#b4502f;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700");
    k.textContent = "✓";
    var t = document.createElement("div");
    var h = document.createElement("div"); h.setAttribute("style", "font:600 19px/1.3 Georgia,'Times New Roman',serif"); h.textContent = T;
    t.appendChild(h);
    if (D) { var p = document.createElement("div"); p.setAttribute("style", "margin-top:3px;color:#585550"); p.textContent = D; t.appendChild(p); }
    c.appendChild(k); c.appendChild(t); d.appendChild(c); (document.body || document.documentElement).appendChild(d);
    requestAnimationFrame(function(){ d.style.opacity = "1"; c.style.transform = "none"; });
    return true;
  } catch (e) { return false; }
})(${lit(title)}, ${lit(detail)})`
}

let readabilitySource: string | null | undefined

/** Código de Readability (Mozilla) para cargarlo en el mundo aislado; null si no está disponible. */
export function readabilityScript(): string | null {
  if (readabilitySource !== undefined) return readabilitySource
  try {
    const file = require.resolve('@mozilla/readability/Readability.js')
    readabilitySource = readFileSync(file, 'utf8') + '\n;typeof Readability === "function"'
  } catch {
    readabilitySource = null
  }
  return readabilitySource
}

/** Artículo según Readability (HTML del contenido: se pasa a Markdown en el proceso principal). */
export function readabilityParseScript(): string {
  return String.raw`(function(){
  if (typeof Readability !== "function") return null;
  try {
    var doc = document.cloneNode(true);
    var art = new Readability(doc, { charThreshold: 300, keepClasses: false }).parse();
    if (!art) return null;
    return { title: String(art.title || ""), html: String(art.content || "").slice(0, 2000000), text: String(art.textContent || "").length, byline: String(art.byline || ""), excerpt: String(art.excerpt || "") };
  } catch (e) { return null; }
})()`
}
