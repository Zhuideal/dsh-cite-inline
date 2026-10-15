// Load the real client.js inside a vm shaped like DSH 0.2.0-rc.2 and report the
// concrete DOM the browser would build. This is the ground truth for "did the
// new code actually mount" — independent of whether a browser window is open.
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import assert from 'node:assert/strict'

// Resolved from this script's own location, so the checkout works anywhere.
const CLIENT = new URL('../client.js', import.meta.url)
const source = await readFile(CLIENT, 'utf8')
const BOUNDS = { left: 24, top: 80, right: 320, bottom: 100, width: 296, height: 20 }

class Element extends EventTarget {
  constructor(tagName) {
    super()
    this.tagName = tagName; this.nodeType = 1; this.attributes = new Map(); this.children = []
    this.style = { setProperty() {} }; this.hidden = false; this.parentElement = null
    this.value = ''; this.id = ''; this.type = ''
  }
  set textContent(v) { for (const c of this.children) c.parentElement = null; this.children = []; this.value = v }
  get textContent() { return this.value + this.children.map(c => c.textContent).join('') }
  get isConnected() { return this.tagName === 'document' || (this.parentElement?.isConnected ?? false) }
  setAttribute(n, v) { this.attributes.set(n, v) }
  getAttribute(n) { return this.attributes.get(n) ?? null }
  hasChildNodes() { return this.children.length > 0 }
  getBoundingClientRect() { return BOUNDS }
  append(...cs) { for (const c of cs) { c.remove(); c.parentElement = this } this.children = [...this.children, ...cs] }
  appendChild(c) { this.append(c); return c }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this)
    this.parentElement = null
  }
  contains(e) { return e === this || this.children.some(c => c.contains(e)) }
  matches(s) {
    if (s.startsWith('#')) return this.id === s.slice(1)
    const a = /^\[([^=\]]+)(?:="([^"]*)")?\]$/u.exec(s)
    if (!a) return this.tagName === s
    return this.attributes.has(a[1]) && (a[2] === undefined || this.attributes.get(a[1]) === a[2])
  }
  closest(s) { return this.matches(s) ? this : this.parentElement?.closest(s) ?? null }
  querySelectorAll(s) { return this.children.flatMap(c => [...(c.matches(s) ? [c] : []), ...c.querySelectorAll(s)]) }
  querySelector(s) { return this.querySelectorAll(s)[0] ?? null }
  click() { this.dispatchEvent(new Event('click')) }
  mousedown() { this.dispatchEvent(new Event('mousedown')) }
}

const document = new Element('document')
document.head = new Element('head'); document.body = new Element('body')
document.append(document.head, document.body)
document.createElement = t => new Element(t)
document.getElementById = id => document.querySelector('#' + id)

const reply = new Element('div'); reply.setAttribute('data-chat-flow-kind', 'assistant-step')
document.body.append(reply)

const window = new EventTarget()
window.innerWidth = 1000; window.innerHeight = 700
// Keep a handle so later steps can swap `navigator` (it is read-only on the
// Node global, and this is what the vm realm actually sees).
const sandboxWindow = window
const range = { getBoundingClientRect: () => BOUNDS, cloneRange: () => range }
let selectionText = ''
const selection = {
  anchorNode: reply, focusNode: reply, rangeCount: 0,
  toString: () => selectionText,
  getRangeAt: () => range,
  removeAllRanges: () => { selectionText = ''; selection.rangeCount = 0; document.dispatchEvent(new Event('selectionchange')) },
}
window.getSelection = () => selection

const listeners = new Set()
const snapshot = { draft: '', attachmentIds: [], draftRev: 7, phase: 'plain', occurrences: [], queue: [] }
const calls = []
const editorOffsetOf = i => snapshot.occurrences[i].offset - snapshot.occurrences.slice(0, i).reduce((n, o) => n + o.length - 1, 0)
const input = {
  state: { getSnapshot: () => snapshot, subscribe: l => { listeners.add(l); return () => listeners.delete(l) } },
  insertReference: (ref, span) => {
    calls.push({ kind: 'reference', ref, span })
    snapshot.occurrences = [...snapshot.occurrences, {
      occurrenceId: 'occ1', source: ref.source, ref: ref.ref,
      offset: snapshot.draft.length, length: String(ref.clipboardText).length,
      label: ref.label, clipboardText: ref.clipboardText,
    }]
    snapshot.draft += ref.clipboardText; snapshot.draftRev += 1
    for (const l of listeners) l()
    return true
  },
  insertText: (text, span) => {
    calls.push({ kind: 'text', text, span })
    const i = snapshot.occurrences.findIndex((_o, idx) => editorOffsetOf(idx) === span.start)
    if (i < 0) return false
    snapshot.occurrences = snapshot.occurrences.filter((_o, idx) => idx !== i)
    snapshot.draftRev += 1
    for (const l of listeners) l()
    return true
  },
}

const registered = []
const ctx = {
  effect: cb => { cb() },
  locale: {
    register: (_ns, dicts) => { ctx.lang = dicts.zh; return () => {} },
    bind: () => (k, p = {}) => (ctx.lang[k] || k).replace(/\{(\w+)\}/u, (_m, n) => p[n]),
    subscribe: () => () => {},
  },
  sessions: {
    list: {
      getSnapshot: () => ({ ids: ['main'], byId: { main: { id: 'main', retainedBy: { mainView: 1 } } }, phase: 'ready' }),
      subscribe: () => () => {},
    },
    scope: id => ({ sessionId: id }),
  },
  conversation: { input: { for: () => input } },
  inputTriggers: { registerSource: s => { registered.push(s); return () => {} } },
}

let dispose
window.__ModuleLoader__ = { load: ({ id, factory }) => { const m = factory(); dispose = m.apply(ctx) } }
runInNewContext(source, {
  window, document, Node: { ELEMENT_NODE: 1 },
  crypto: { randomUUID: () => 'q1' },
  CSS: { supports: () => false }, setTimeout, clearTimeout,
}, { filename: 'client.js' })

const action = document.querySelector('[data-dsh-cite-inline-action]')
const style = document.querySelector('#dsh-cite-inline-style')

console.log('== mount ==')
console.log('style injected        :', !!style)
console.log('action created        :', !!action, '(hidden=' + (action && action.hidden) + ')')

console.log('\n== step 1: select assistant text ==')
selectionText = '单次请求体量巨大。每次请求都带 10-20 万 prompt tokens'; selection.rangeCount = 1
document.dispatchEvent(new Event('selectionchange'))
const kids = action.children.map(c => c.tagName + (c.getAttribute('data-quote-action') ? '[' + c.getAttribute('data-quote-action') + ']="' + c.textContent + '"' : ''))
console.log('action.hidden         :', action.hidden, '(false = toolbar visible)')
console.log('toolbar children      :', kids.join('  '))
console.log('role                  :', action.getAttribute('role'))
const addBtn = action.children.find(c => c.getAttribute('data-quote-action') === 'add')
const copyBtn = action.children.find(c => c.getAttribute('data-quote-action') === 'copy')
console.log('add button            :', addBtn ? '"' + addBtn.textContent + '"' : 'MISSING')
console.log('copy button           :', copyBtn ? '"' + copyBtn.textContent + '"' : 'MISSING')

console.log('\n== step 2: click 添加到对话 ==')
addBtn.click()
const call = calls[0]
console.log('chip inserted         :', call.kind === 'reference')
console.log('chip source           :', call.ref.source)
console.log('chip label            :', call.ref.label)
console.log('chip appearance       :', call.ref.appearance, '(session = chat-bubble icon)')
console.log('chip clipboardText    :', call.ref.clipboardText)
console.log('draft now             :', JSON.stringify(snapshot.draft))

console.log('\n== step 3: what serialize() returns at send time ==')
const wire = await registered[0].codec.serialize('q1')
console.log('serialize() ->')
console.log('  ' + wire)
console.log('  single line        :', !wire.includes('\n'))
// The wire form is ` @"body"`: the leading separator is required by
// projectUserText's `(^|\s)` group, so assert the trimmed token instead.
const token = wire.trim()
console.log('  whole body inside  :', token.startsWith('@"') && token.endsWith('"'))
console.log('  leading separator  :', /^\s/u.test(wire), '(mandatory for the sent-bubble scanner)')

console.log('\n== step 4: retired chrome must be absent ==')
for (const sel of ['[data-dsh-cite-inline-rail]', '[data-dsh-cite-inline-marker]', '[data-dsh-cite-inline-preview]']) {
  console.log('  ' + sel.padEnd(38) + ':', document.querySelector(sel) === null ? 'absent' : 'PRESENT (bug)')
}

console.log('\n== step 4: copy button ==')
let copied = null
// Install the clipboard stub BEFORE the click: copySelection reads navigator at
// click time, not at mount time. `navigator` is an own getter on the Node
// global, so patch the vm realm's window instead of globalThis.
sandboxWindow.navigator = { clipboard: { writeText: t => { copied = t; return Promise.resolve() } } }
// A live selection must still be present, otherwise copySelection falls back to
// the cached selectedText — which is fine here but worth asserting explicitly.
selectionText = '单次请求体量巨大。每次请求都带 10-20 万 prompt tokens'
selection.rangeCount = 1
copyBtn.click()
await new Promise(r => setTimeout(r, 20))
console.log('clipboard got         :', JSON.stringify(copied))
console.log('copy label after      :', JSON.stringify(copyBtn.textContent), '(已复制)')
console.log('same text as selection:', copied === selectionText)

console.log('\n== step 5: chip skin in the injected stylesheet ==')
const css = style.textContent
for (const probe of ['.mxScHa_reference.rtYPxa_chip', '[data-ref-chip]', '--dsw-alias-state-business-tertiary']) {
  console.log('  contains ' + probe.padEnd(42) + ':', css.includes(probe))
}
console.log('  hard-coded #bce3ff                       :', css.includes('#bce3ff'), '(must be false)')

console.log('\n== teardown ==')
dispose?.()
console.log('action removed        :', document.querySelector('[data-dsh-cite-inline-action]') === null)
