// Functional test for dsh-cite-inline/client.js against a context shaped
// exactly like DSH 0.2.0-rc.2.
//
// Upstream's own tests pass against a harness that fabricates the two fork-only
// extension points (`conversation.draftContexts`, `data-dsh-message-role`). This
// harness deliberately does NOT: it provides only what stock 0.2.0-rc.2
// publishes, so any regression back to a fork-only contract fails here.
//
// Shapes mirrored from the installed bundles:
//   session row  : { id, displayTitle, retainedBy, ... }        (api-session-controller)
//   list snapshot: { ids, byId, phase, projectionsBySession }   (no `current`)
//   input state  : { draft, occurrences, draftRev, phase, ... } (ui-conversation)
//   occurrence   : { occurrenceId, source, ref, offset, length, label, clipboardText }
//   assistant row: [data-chat-flow-kind="assistant-step"]       (ui-chat)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const CLIENT = process.env.CLIENT_JS
if (!CLIENT) throw new Error('CLIENT_JS env var is required')
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
}

/** rc.2 session row: `id` is the row identity and the byId key. */
const row = (id, retainedBy) => ({ id, displayTitle: id, retainedBy: retainedBy ?? {}, running: false, blank: false, updatedAt: 0 })

function boot({ catalog, sessionId, withSession = true }) {
  const document = new Element('document')
  document.head = new Element('head'); document.body = new Element('body')
  document.append(document.head, document.body)
  document.createElement = t => new Element(t)
  document.getElementById = id => document.querySelector('#' + id)

  const reply = new Element('div'); reply.setAttribute('data-chat-flow-kind', 'assistant-step')
  const other = new Element('div'); other.setAttribute('data-chat-flow-kind', 'user')
  const composer = new Element('div'); composer.setAttribute('data-composer-card', '')
  document.body.append(reply, other, composer)

  const window = new EventTarget()
  window.innerWidth = 1000; window.innerHeight = 700
  // A stubbable clipboard: copySelection reads `window.navigator`, so the copy
  // path is testable without a real browser. Defaults to unresolved so tests
  // can install the behaviour they need.
  let clipboardWrite = () => Promise.resolve(false)
  Object.defineProperty(window, 'navigator', {
    configurable: true,
    get: () => ({ clipboard: { writeText: t => clipboardWrite(t) } }),
  })
  const range = { getBoundingClientRect: () => BOUNDS, cloneRange: () => range }
  let selectionText = ''
  const selection = {
    anchorNode: reply, focusNode: reply, rangeCount: 0,
    toString: () => selectionText,
    getRangeAt: () => range,
    removeAllRanges: () => { selectionText = ''; selection.rangeCount = 0; document.dispatchEvent(new Event('selectionchange')) },
  }
  window.getSelection = () => selection

  // Live InputState, mirroring ui-conversation's compose()/occurrence projection.
  const listeners = new Set()
  const snapshot = { draft: '', attachmentIds: [], draftRev: 7, phase: 'plain', occurrences: [], queue: [] }
  const editorOffsetOf = index =>
    snapshot.occurrences[index].offset - snapshot.occurrences.slice(0, index).reduce((n, o) => n + o.length - 1, 0)
  const calls = []
  const publish = () => { for (const l of listeners) l() }
  const input = {
    state: { getSnapshot: () => snapshot, subscribe: l => { listeners.add(l); return () => listeners.delete(l) }, set: () => {} },
    insertReference: (ref, span) => {
      calls.push({ kind: 'reference', ref, span })
      const occ = {
        occurrenceId: 'occ' + (snapshot.occurrences.length + 1),
        source: ref.source, ref: ref.ref,
        offset: snapshot.draft.length,
        length: String(ref.clipboardText).length,
        label: ref.label, clipboardText: ref.clipboardText,
      }
      snapshot.draft += ref.clipboardText
      snapshot.occurrences = [...snapshot.occurrences, occ]
      snapshot.draftRev += 1
      publish()
      return true
    },
    insertText: (text, span) => {
      calls.push({ kind: 'text', text, span })
      const index = snapshot.occurrences.findIndex((_o, i) => editorOffsetOf(i) === span.start)
      if (index < 0) return false
      const [gone] = snapshot.occurrences.slice(index, index + 1)
      snapshot.draft = snapshot.draft.slice(0, gone.offset) + snapshot.draft.slice(gone.offset + gone.length)
      snapshot.occurrences = snapshot.occurrences.filter((_o, i) => i !== index)
      snapshot.draftRev += 1
      publish()
      return true
    },
  }

  const registered = []
  const effects = []
  let dict = {}

  const ctx = {
    effect: cb => { const d = cb(); if (typeof d === 'function') effects.push(d) },
    locale: {
      register: (_ns, dictionaries) => { dict = dictionaries.zh; return () => {} },
      bind: () => (key, params = {}) => dict[key].replace(/\{(\w+)\}/gu, (_m, n) => params[n]),
      subscribe: () => () => {},
    },
    sessions: {
      list: { getSnapshot: () => catalog, subscribe: () => () => {} },
      scope: id => (withSession && id === sessionId ? { sessionId: id } : undefined),
    },
    conversation: { input: { for: scope => (scope === undefined ? undefined : input) } },
    // The real reference pipeline. `draftContexts` is deliberately absent.
    inputTriggers: { registerSource: src => { registered.push(src); return () => {} } },
  }

  let dispose
  window.__ModuleLoader__ = { load: ({ id, factory }) => {
    assert.equal(id, 'dsh-cite-inline', 'bundle must register under its own package id')
    // Stock DSH client bundles are loaded with no `require` in scope; the
    // factory must not depend on one.
    const mod = factory()
    assert.equal(mod.name, 'dsh-cite-inline')
    dispose = mod.apply(ctx)
  } }
  runInNewContext(source, {
    window, document, Node: { ELEMENT_NODE: 1 },
    crypto: { randomUUID: () => 'quote-fixed' },
    CSS: { supports: () => false }, setTimeout, clearTimeout,
  }, { filename: 'client.js' })

  return {
    document, reply, other, registered, calls, snapshot,
    world: { window, document },
    dispose: () => { dispose?.(); for (const e of effects.toReversed()) e() },
    setClipboardWrite: fn => { clipboardWrite = fn },
    publish,
    action: document.querySelector('[data-dsh-cite-inline-action]'),
    select(text, node = reply) {
      node.textContent = text; selectionText = text
      selection.anchorNode = node; selection.focusNode = node
      selection.rangeCount = text ? 1 : 0
      document.dispatchEvent(new Event('selectionchange'))
    },
    button() { return this.action.children.find(c => c.tagName === 'button' && c.getAttribute('data-quote-action') === 'add') },
    copyButton() { return this.action.children.find(c => c.tagName === 'button' && c.getAttribute('data-quote-action') === 'copy') },
  }
}

const results = []
const queue = []
// A sync body runs at the call site, so a block's `h.dispose()` still lands
// after every check in that block. An async body (the codec awaits its
// serialize) is deferred to the drain at the end; it only reads harness state
// that is already settled, which is why deferral is safe there.
const check = (name, fn) => {
  let out
  try { out = fn() } catch (e) { results.push(['FAIL', name + ' :: ' + e.message]); return }
  if (out instanceof Promise) {
    queue.push(async () => {
      try { await out; results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' :: ' + e.message]) }
    })
    return
  }
  results.push(['PASS', name])
}

// Stock rc.2 catalog: no `current`; retention is per source.
const RC2 = {
  ids: ['main', 'background'],
  byId: { main: row('main', { mainView: 1 }), background: row('background', { subagentView: 1 }) },
  phase: 'ready', projectionsBySession: {},
}

// 1. boot + contract
{
  const h = boot({ catalog: RC2, sessionId: 'main' })
  check('apply() boots against an rc.2 context with no draftContexts', () => {
    assert.ok(h.action, 'action element created')
    assert.equal(h.action.hidden, true, 'starts hidden')
  })
  check('registers an @ reference source for the codec path', () => {
    assert.equal(h.registered.length, 1)
    assert.equal(h.registered[0].trigger, '@')
    assert.equal(h.registered[0].name, 'dsh-cite-inline-quote')
    assert.equal(typeof h.registered[0].codec.serialize, 'function')
    assert.deepEqual(h.registered[0].candidates, h.registered[0].candidates)
  })
  check('resolves the active session from retainedBy.mainView (no `current`)', () => {
    h.select('hello world')
    assert.equal(h.action.hidden, false, 'selection in an assistant-step reveals the action')
  })
  check('clicking Add to chat inserts one reference chip', () => {
    h.button().click()
    assert.equal(h.calls.length, 1, 'exactly one composer mutation')
    const [call] = h.calls
    assert.equal(call.kind, 'reference')
    assert.equal(call.ref.source, 'dsh-cite-inline-quote')
    assert.equal(call.ref.label, 'hello world')
    assert.equal(call.ref.clipboardText, 'hello world')
    // The glyph must be the session (chat-bubble) icon, not the `@` marker:
    // appearance undefined renders the plain marker branch.
    assert.equal(call.ref.appearance, 'session')
    // The span object is created inside the vm realm, so compare fields rather
    // than identity (deepEqual is realm-sensitive on prototypes).
    assert.equal(call.span.start, 0)
    assert.equal(call.span.end, 0)
    assert.equal(call.span.draftRev, 7)
  })
  check('codec serializes the chip to one @-quoted token carrying the whole body', async () => {
    const text = await h.registered[0].codec.serialize('quote-fixed')
    // projectUserText() maps `@"…"` to exactly one chip whose label is the
    // token's inner text. Keeping the body INSIDE the quotes is what stops the
    // quote from spilling out under the bubble as a second plain run.
    //
    // The leading space is part of the contract, not cosmetic: the scanner's
    // `(^|\s)` group is mandatory, so a token glued onto the preceding
    // character is not recognised at all. Assert it against the real regex
    // rather than by string equality, so the test states the actual contract.
    assert.equal(text, ' @"hello world"')
    assert.equal(text.split('\n').length, 1, 'a newline would split the token in two')
    assert.ok(/^\s/u.test(text), 'a separator must precede the token')
  })
  check('the serialized token is recognised by projectUserText\'s scanner', async () => {
    // Verbatim from ui-primitives lib/index.js:6724.
    const SCANNER = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu
    const token = await h.registered[0].codec.serialize('quote-fixed')
    // Model text is a chip preceded by whatever the user typed before it: the
    // worst case is a chip appended directly after a word, with no separator
    // of its own. That is the shape that used to spill.
    for (const wire of [`东西${token}`, `word${token}`, token]) {
      SCANNER.lastIndex = 0
      const hits = [...wire.matchAll(SCANNER)].filter(m => m[2].startsWith('@"'))
      assert.equal(hits.length, 1, `exactly one chip for: ${JSON.stringify(wire)}`)
      assert.equal(hits[0][2], '"hello world"'.replace(/^/, '@'), 'token text is intact')
    }
  })
  check('codec clipboardText matches the chip label for copy/persistence', () => {
    assert.equal(h.registered[0].codec.clipboardText('quote-fixed'), 'hello world')
  })
  check('a multi-line selection collapses to one line for the chip label', () => {
    // The wire regex is `@"[^"\n]+"`: a newline inside the quotes splits the
    // token, and the chip would degrade to plain text. Verify the label folds.
    h.select('first line\nsecond\tline   third')
    h.button().click()
    const call = h.calls.at(-1)
    assert.equal(call.ref.label, 'first line second line third')
    assert.ok(!call.ref.label.includes('\n'), 'label must be single-line')
  })
  check('a backslash in the selection cannot truncate the chip label', () => {
    // displayLabel splits the label on [\\/] and keeps the LAST segment, so an
    // unnormalized Windows path collapses the chip to the text after its final
    // backslash. Both separators must be neutralized.
    h.select('C:\\Users\\<user>\\node_modules\\dsh-quote-to-chat is the target')
    h.button().click()
    const label = h.calls.at(-1).ref.label
    assert.ok(!label.includes('\\'), 'no backslash may survive into the label')
    assert.ok(label.startsWith('C:'), 'the label must keep the whole passage')
    assert.ok(label.includes('dsh-quote-to-chat is the target'), 'the tail must survive')
  })
  check('the toolbar exposes add + copy and neutralises mousedown', () => {
    const buttons = h.action.children.filter(c => c.tagName === 'button')
    assert.equal(buttons.length, 2, 'add and copy')
    assert.equal(buttons[0].getAttribute('data-quote-action'), 'add')
    assert.equal(buttons[1].getAttribute('data-quote-action'), 'copy')
    assert.equal(buttons[1].textContent, '复制', 'copy is localized to zh')
    assert.equal(h.action.getAttribute('role'), 'toolbar')
  })
  check('copy writes the live selection through the clipboard', async () => {
    let copied = null
    h.setClipboardWrite(t => { copied = t; return Promise.resolve(true) })
    h.select('copy me please')
    h.copyButton().click()
    await new Promise(r => setTimeout(r, 0))
    assert.equal(copied, 'copy me please', 'clipboard received the selection verbatim')
    assert.equal(h.copyButton().textContent, '已复制', 'label confirms the copy')
  })
  check('the injected stylesheet skins both composer and sent-message chips', () => {
    const style = h.document.querySelector('#dsh-cite-inline-style')
    assert.ok(style, 'style element exists')
    const css = style.textContent
    assert.ok(css.includes('.mxScHa_reference.rtYPxa_chip'), 'composer chip skin')
    assert.ok(css.includes('[data-ref-chip]'), 'sent-message chip skin')
    // Official theme tokens only — no hard-coded product palette.
    assert.ok(css.includes('--dsw-alias-state-business-tertiary'))
    assert.ok(css.includes('--dsw-alias-state-business-primary'))
    assert.ok(!/#bce3ff/.test(css), 'no hard-coded screenshot palette')
  })
  check('no rail, marker, or preview chrome is mounted', () => {
    // The retired design put a floating pill, a numbered badge in the reply,
    // and a hover card on screen. Only the toolbar and the composer chip remain.
    for (const sel of [
      '[data-dsh-cite-inline-rail]',
      '[data-dsh-cite-inline-marker]',
      '[data-dsh-cite-inline-preview]',
    ]) {
      assert.equal(h.document.querySelector(sel), null, sel + ' must not exist')
    }
    const css = h.document.querySelector('#dsh-cite-inline-style').textContent
    assert.ok(!css.includes('quote-preview'), 'preview CSS must be stripped too')
    assert.ok(!css.includes('quote-pill'), 'rail CSS must be stripped too')
  })
  check('deleting the chip drops the remembered quote', () => {
    // The chip was inserted earlier in this block; remove it the way the editor
    // would and confirm the codec no longer claims to know the reference.
    const ref = h.registered[0] && h.calls.find(c => c.kind === 'reference').ref.ref
    h.snapshot.occurrences = []
    h.snapshot.draft = ''
    h.publish()
    return Promise.resolve().then(async () => {
      await assert.rejects(() => h.registered[0].codec.serialize(ref), /no longer available/)
    })
  })
  h.dispose()
}

// 2. non-assistant selections
{
  const h = boot({ catalog: RC2, sessionId: 'main' })
  check('a selection in a non-assistant row offers no action', () => {
    h.select('user text', h.other)
    assert.equal(h.action.hidden, true)
  })
  h.dispose()
}

// 3. legacy catalog, for profiles that still publish `current`
{
  const h = boot({ catalog: { ids: ['legacy'], byId: { legacy: row('legacy', {}) }, phase: 'ready', current: 'legacy' }, sessionId: 'legacy' })
  check('legacy catalog with a `current` field still resolves', () => {
    h.select('legacy text')
    assert.equal(h.action.hidden, false)
    h.button().click()
    assert.equal(h.calls.length, 1)
  })
  h.dispose()
}

// 4. no retained session
{
  const h = boot({ catalog: { ids: [], byId: {}, phase: 'ready' }, sessionId: undefined, withSession: false })
  check('without a retained session nothing is inserted', () => {
    h.select('orphan text')
    h.button().click()
    assert.equal(h.calls.length, 0)
  })
  h.dispose()
}

// 5. subagent-only catalog must not be mistaken for the active session
{
  const h = boot({ catalog: { ids: ['background'], byId: { background: row('background', { subagentView: 1 }) }, phase: 'ready' }, sessionId: undefined, withSession: false })
  check('a subagent-only catalog yields no active session', () => {
    h.select('background text')
    h.button().click()
    assert.equal(h.calls.length, 0)
  })
  h.dispose()
}

// 6. teardown
{
  const h = boot({ catalog: RC2, sessionId: 'main' })
  check('dispose removes the injected chrome', () => {
    h.dispose()
    assert.equal(h.document.querySelector('[data-dsh-cite-inline-action]'), null)
    assert.equal(h.document.querySelector('[data-dsh-cite-inline-rail]'), null)
  })
}

// 7. no duplicate "copy session ID" menu row
// DSH 0.2.1 ships that row itself (ui-workspace `SessionIdMenuItem`, the last
// built-in item of a session's ⋯ menu). Registering a second row into
// `sidebar.workspaces.session.menu.item` would show two identically-labelled
// entries, so this plugin must not touch that slot at all.
{
  check('does not register a duplicate copy-session-id menu row', () => {
    assert.ok(!source.includes('sidebar.workspaces.session.menu.item'), 'session menu slot is untouched')
    assert.ok(!source.includes('menuCopySessionId'), 'no menu-row label')
    assert.ok(!source.includes('menuCopied'), 'no menu-row copied state')
    assert.ok(!source.includes('CopySessionId'), 'no menu-row component')
  })
  check('the client factory takes no `require` (stock loader passes none)', () => {
    assert.ok(source.includes('factory: () => {'), 'factory signature stays zero-arg')
    assert.ok(!/\brequire\(/.test(source), 'no module-loader require in the bundle')
  })
}

for (const run of queue) await run()

const failed = results.filter(([s]) => s === 'FAIL')
for (const [status, name] of results) console.log((status === 'PASS' ? 'ok   ' : 'FAIL ') + name)
console.log('\n' + results.length + ' checks, ' + failed.length + ' failed')
if (failed.length > 0) process.exit(1)