#!/usr/bin/env node
/**
 * Regenerate `client.js` from the vendored upstream base.
 *
 * The port is two behavioral patches plus a namespace rename, so it is kept as a
 * script rather than a hand-edited copy: re-applying it to a newer upstream
 * revision stays a review of the patch list, not a diff of 550 minified-ish lines.
 *
 * Base: choco9527/dsh-add-to-chat commit 51254305e7dbda9304b70ca7e74142dd8b6423bd
 *       ("fix: carry quotes on the upstream reference pipeline") — the last
 *       upstream revision that uses only official DSH APIs.
 *       Vendored verbatim as tools/upstream-client.js (MIT).
 *
 * Usage:
 *   node tools/build-client.cjs              # writes ./client.js
 *   OUT_DIR=/tmp/out node tools/build-client.cjs
 *
 * Exit codes: 0 ok, 1 an anchor is missing/ambiguous or a sanity check failed.
 */
const fs = require('fs')
const path = require('path')

const HERE = __dirname
const SRC = path.join(HERE, 'upstream-client.js')
const OUT_DIR = process.env.OUT_DIR || path.join(HERE, '..')
const OUT = path.join(OUT_DIR, 'client.js')

let code = fs.readFileSync(SRC, 'utf8')

/** Replace `from` with `to`, requiring exactly one occurrence so drift is loud. */
function replaceOnce(from, to, label) {
  const at = code.indexOf(from)
  if (at < 0) throw new Error('anchor not found: ' + label)
  if (code.indexOf(from, at + 1) !== -1) throw new Error('anchor not unique: ' + label)
  code = code.slice(0, at) + to + code.slice(at + from.length)
  console.log('patched: ' + label)
}

// ── patch 0: header ──────────────────────────────────────────────────────────
replaceOnce(
  "// Browser half of dsh-add-to-chat. It uses public browser services only, so\n" +
  "// the package remains an independently installable client plugin.",
  "// Browser half of dsh-cite-inline: select text in an assistant reply, click\n" +
  "// \"Add to chat\", and the selection rides the next submission as one visible\n" +
  "// composer reference chip.\n" +
  "//\n" +
  "// Ported to stock DSH 0.2.0-rc.2 from choco9527/dsh-add-to-chat (MIT). Upstream\n" +
  "// HEAD targets a DSH fork: it needs `conversation.draftContexts` and an assistant\n" +
  "// reply marker `data-dsh-message-role`, and neither exists in stock DSH. This\n" +
  "// port uses only extension points stock DSH actually publishes:\n" +
  "//   - `inputTriggers` reference source (the public `@`-reference pipeline)\n" +
  "//   - `conversation.input.for(scope)` + `insertReference` / `insertText`\n" +
  "//   - `[data-chat-flow-kind=\"assistant-step\"]` for assistant prose rows\n" +
  "//   - `retainedBy.mainView` for the active session\n" +
  "// Trade-off against upstream HEAD: annotations live in the composer as chips\n" +
  "// instead of out-of-band draft contexts, so the composer is not textually clean.\n" +
  "//\n" +
  "// Rebuild with tools/build-client.cjs; verify with tools/port.test.mjs.",
  'header'
)

// ── patch 1: own the namespace ───────────────────────────────────────────────
const before = code
code = code.split('dsh-add-to-chat').join('dsh-cite-inline')
if (code === before) throw new Error('rename of dsh-add-to-chat did nothing')
console.log('renamed: dsh-add-to-chat -> dsh-cite-inline')

replaceOnce(
  "const LOCALE_NS = 'add-to-chat'",
  "const LOCALE_NS = 'cite-inline'",
  'locale namespace'
)

// ── patch 2: assistant reply selector (fork-only attr -> real DOM contract) ───
replaceOnce(
  "const ASSISTANT_REPLY_SELECTOR = '[data-dsh-message-role=\"assistant\"]'",
  "// Assistant prose rows. ui-chat wraps every chat node in a div carrying\n" +
  "// `data-chat-flow-kind` and registers the `assistant-step` node kind, so this\n" +
  "// is the chat surface's real DOM contract. Upstream used the fork-only\n" +
  "// `data-dsh-message-role` attribute, which no stock DSH build emits.\n" +
  "const ASSISTANT_REPLY_SELECTOR = '[data-chat-flow-kind=\"assistant-step\"]'",
  'assistant reply selector'
)

// ── patch 3: session lookup (dropped `current` -> retainedBy.mainView) ───────
replaceOnce(
  "      function currentSessionId() {\n" +
  "        return ctx.sessions.list.getSnapshot().current\n" +
  "      }",
  "      /**\n" +
  "       * The active session id.\n" +
  "       *\n" +
  "       * Legacy catalogs publish it as `current`. DSH 0.2.0-rc.1 dropped that\n" +
  "       * field and marks the session the main view retains through the\n" +
  "       * `retainedBy` counters instead. Only the main view's session is the\n" +
  "       * active one: background subagent sessions carry their own counter.\n" +
  "       */\n" +
  "      function currentSessionId() {\n" +
  "        const list = ctx.sessions.list.getSnapshot()\n" +
  "        if (typeof list.current === 'string' && list.current !== '') return list.current\n" +
  "        return Object.values(list.byId).find(\n" +
  "          session => (session?.retainedBy?.mainView ?? 0) > 0,\n" +
  "        )?.id\n" +
  "      }",
  'current session lookup'
)

// ── patch 4: DSH-native chip skin (input box + sent message) ─────────────────
// DSH's own composer renders a reference chip as
//   span.mxScHa_reference.rtYPxa_chip[data-composer-chip]
// with a transparent background and blue text. This port gives the chip the
// light-blue pill the reference product shows, built from DSH's *official*
// theme tokens so both light and dark themes follow the host (and stay
// compatible with dsh-claude-style, which only re-points the same tokens):
//   background = business-tertiary blended toward business-primary
//   text       = label-primary
// The blend is 18% primary: that is the closest point on the token ramp to the
// reference pill (#bce3ff) measured from the light theme — see the note in
// README. The same class pair also covers the chip inside a *sent* user
// message, where projectUserText() re-derives the chip from the `@…` token
// `serialize()` returns (patch 6). Both surfaces are covered by one rule.
replaceOnce(
  "        `@supports not (backdrop-filter: blur(3px)) { [data-${ACTION_ID}] button, [data-${RAIL_ID}] [data-quote-pill] { background: var(--dsw-alias-bg-layer-1, #fff); } }`,\n" +
  "        `@supports (anchor-name: --dsh-cite-inline-anchor) { [data-${PREVIEW_ID}][data-anchored] { top: anchor(bottom); left: anchor(center); transform: translate(-50%, 8px); position-try-fallbacks: flip-block, flip-inline; } }`,\n" +
  "      ].join('\\n')",
  "        `@supports not (backdrop-filter: blur(3px)) { [data-${ACTION_ID}] button, [data-${RAIL_ID}] [data-quote-pill] { background: var(--dsw-alias-bg-layer-1, #fff); } }`,\n" +
  "        `@supports (anchor-name: --dsh-cite-inline-anchor) { [data-${PREVIEW_ID}][data-anchored] { top: anchor(bottom); left: anchor(center); transform: translate(-50%, 8px); position-try-fallbacks: flip-block, flip-inline; } }`,\n" +
  // ---- quote chip skin: composer + sent message ----
  "        `.mxScHa_reference.rtYPxa_chip { background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 82%, var(--dsw-alias-state-business-primary, #4176e6)); border-radius: var(--dsw-radius-sm, 4px); padding: 1px 6px; margin: 0 2px; color: var(--dsw-alias-label-primary, #0f1115); }`,\n" +
  "        `.mxScHa_reference.rtYPxa_chip:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 68%, var(--dsw-alias-state-business-primary, #4176e6)); }`,\n" +
  "        `.mxScHa_reference.rtYPxa_chip .rtYPxa_icon { color: var(--dsw-alias-state-business-primary, #4176e6); }`,\n" +
  // The sent-message chip uses the same token set but its own class pair.
  // `inline-block` (not DSH's `inline`) is the load-bearing part: ellipsis and
  // max-width do nothing on an inline box, and DSH's .refChip deliberately
  // wraps and never truncates. Overriding the display is what turns the chip
  // from "barely-styled label that follows the bubble" into an actual pill.
  "        `[data-ref-chip] { display: inline-block; max-width: 240px; background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 82%, var(--dsw-alias-state-business-primary, #4176e6)); border-radius: var(--dsw-radius-sm, 4px); padding: 1px 6px; margin: 0 2px; color: var(--dsw-alias-label-primary, #0f1115); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }`,\n" +
  "        `[data-ref-chip]:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 68%, var(--dsw-alias-state-business-primary, #4176e6)); }`,\n" +
  // The icon inside a sent-message chip: force flex alignment so the glyph and
  // the label sit on one line inside the nowrap box.
  "        `[data-ref-chip] .refIcon, [data-ref-chip] svg { color: var(--dsw-alias-state-business-primary, #4176e6); flex: none; }`,\n" +
  "      ].join('\\n')",
  'quote chip skin (composer + sent message)'
)

// ── patch 4b: selection toolbar layout ───────────────────────────────────────
// patch 7 turns the single button into a two-action bar, so the container
// needs the reference product's shape: one pill holding icon + label, a
// hairline separator, and a second action — instead of a lone 28px-radius
// blob. Positioning stays viewport-clamped exactly as upstream placed it.
replaceOnce(
  "        `[data-${ACTION_ID}] { display: inline-flex; transform: translate(-50%, -100%); }`,\n" +
  "        `[data-${ACTION_ID}][data-placement=\"below\"] { transform: translateX(-50%); }`,\n" +
  "        `[data-${ACTION_ID}] button, [data-${RAIL_ID}] [data-quote-pill] { position: relative; overflow: hidden; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2, #000) 56%, transparent); border-radius: 28px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 90%, transparent); box-shadow: 0 10px 26px rgb(15 23 42 / 18%), 0 1px 3px rgb(15 23 42 / 16%); color: var(--dsw-alias-label-primary, #17191c); font: inherit; backdrop-filter: blur(2px) saturate(1.12); -webkit-backdrop-filter: blur(2px) saturate(1.12); }`,\n" +
  "        `[data-${ACTION_ID}] button::before, [data-${RAIL_ID}] [data-quote-pill]::before { content: ''; position: absolute; inset: 1px 1px auto; height: 42%; border-radius: inherit; background: linear-gradient(180deg, rgb(255 255 255 / 34%), transparent); pointer-events: none; }`,\n" +
  "        `[data-${ACTION_ID}] button { height: 32px; padding: 0 13px; cursor: pointer; font-size: 13px; }`,\n" +
  "        `[data-${ACTION_ID}] button:hover, [data-${ACTION_ID}] button:focus-visible { background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 94%, transparent); }`,\n" +
  "        `[data-${RAIL_ID}] { display: flex; align-items: center; gap: 4px; }`,\n" +
  "        `[data-${RAIL_ID}] [data-quote-pill] { height: 30px; padding: 0 11px; cursor: pointer; font-size: 13px; }`,",
  "        `[data-${ACTION_ID}] { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2, #000) 12%, transparent); border-radius: var(--dsw-radius-lg, 10px); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 92%, transparent); box-shadow: var(--dsw-elevation-prominent, 0 6px 24px rgb(15 23 42 / 18%)); backdrop-filter: blur(2px) saturate(1.12); -webkit-backdrop-filter: blur(2px) saturate(1.12); transform: translate(-50%, -100%); }`,\n" +
  "        `[data-${ACTION_ID}][data-placement=\"below\"] { transform: translateX(-50%); }`,\n" +
  "        `[data-${ACTION_ID}] button, [data-${RAIL_ID}] [data-quote-pill] { position: relative; overflow: hidden; border: 0; border-radius: var(--dsw-radius-md, 6px); background: transparent; color: var(--dsw-alias-label-primary, #17191c); font: inherit; }`,\n" +
  "        `[data-${ACTION_ID}] button { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; cursor: pointer; font-size: 13px; white-space: nowrap; }`,\n" +
  "        `[data-${ACTION_ID}] button:hover, [data-${ACTION_ID}] button:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgb(15 23 42 / 8%)); }`,\n" +
  "        `[data-${ACTION_ID}] [data-quote-separator] { flex: none; width: 1px; height: 14px; margin: 0 3px; background: var(--dsw-alias-border-l1, rgb(0 0 0 / 14%)); }`,\n" +
  "        `[data-${ACTION_ID}] button[data-quote-action=\"add\"] { color: var(--dsw-alias-state-business-primary, #4176e6); font-weight: 500; }`,\n" +
  "        `[data-${RAIL_ID}] { display: flex; align-items: center; gap: 4px; }`,\n" +
  "        `[data-${RAIL_ID}] [data-quote-pill] { height: 30px; padding: 0 11px; cursor: pointer; font-size: 13px; }`,",
  'selection toolbar layout'
)

// ── patch 5: chip glyph = session icon, not `@` ──────────────────────────────
// The composer's ReferenceChip renders `appearance === undefined ? '@' :
// ReferenceIconRegular{kind: appearance}`. Passing `session` selects the
// chat-bubble artwork (ReferenceIconArtwork case 'session' →
// ChatLinesOutlineArtwork), which is the quote glyph the reference UI shows.
replaceOnce(
  "        const inserted = input.insertReference({\n" +
  "          source: QUOTE_SOURCE,\n" +
  "          ref,\n" +
  "          label: quote.label,\n" +
  "          clipboardText: quote.label,\n" +
  "        }, { start: end, end, draftRev: snapshot.draftRev })",
  "        const inserted = input.insertReference({\n" +
  "          source: QUOTE_SOURCE,\n" +
  "          ref,\n" +
  "          label: quote.label,\n" +
  "          appearance: 'session',\n" +
  "          clipboardText: quote.label,\n" +
  "        }, { start: end, end, draftRev: snapshot.draftRev })",
  'chip appearance: session glyph'
)

// ── patch 6: serialize() as an `@…` token so the sent message renders a chip ──
// Two consumers read what serialize() returns:
//   * the model      — gets this text verbatim as the prompt,
//   * the user bubble — projectUserText() scans the sent text for
//                       `@…` / `@"…"` / `/…` tokens and renders each as a chip.
// So the serialized form must be BOTH readable model text AND a token the
// scanner recognizes. A quoted label satisfies both: `@"…"` is an explicit
// branch of the scanner regex, and it stays human-readable to the model.
// The full quote body is preserved — the model must see everything that was
// quoted, not the truncated label.
replaceOnce(
  "          serialize: async ref => {\n" +
  "            const quote = quotes.get(ref)\n" +
  "            if (quote === undefined) throw new Error('assistant quote is no longer available')\n" +
  "            return `${t('contextLabel')}\\n${quote.text}`\n" +
  "          },",
  "          serialize: async ref => {\n" +
  "            const quote = quotes.get(ref)\n" +
  "            if (quote === undefined) throw new Error('assistant quote is no longer available')\n" +
  "            // The FULL quote body goes inside the quoted token, not after it.\n" +
  "            // projectUserText() turns `@\"…\"` into one chip and renders the\n" +
  "            // quote's own text as that chip's label; anything placed *outside*\n" +
  "            // the quotes becomes an extra plain run — exactly the \"quote spills\n" +
  "            // out under the bubble\" defect this avoids.\n" +
  "            // The chip is truncated to a pill by CSS (inline-block + max-width\n" +
  "            // + ellipsis), while the model still receives the whole passage,\n" +
  "            // because the token text IS the model text.\n" +
  "            // `quote.label` is the same single-line text the composer chip\n" +
  "            // shows, so both surfaces stay in step.\n" +
  "            return `@\"${quote.label}\"`\n" +
  "          },",
  'serialize as an @-quoted token'
)

// ── patch 7: selection toolbar in the reference shape ────────────────────────
// The upstream single floating button becomes the reference product's compact
// top toolbar: an icon + 「添加到对话」, a hairline separator, and 复制.
// The copy action is what makes the pair coherent — quoting and copying are
// the same gesture over the same selection, so they belong on one bar.
// The bar keeps the selection alive (mousedown is neutralised) because both
// actions read `window.getSelection()` at click time.
replaceOnce(
  "    const zh = Object.freeze({\n" +
  "      add: '添加到对话',",
  "    const zh = Object.freeze({\n" +
  "      add: '添加到对话',\n" +
  "      copy: '复制',\n" +
  "      copied: '已复制',\n" +
  "      toolbarLabel: '选中文本操作',",
  'locale zh: toolbar copy'
)
replaceOnce(
  "    const en = Object.freeze({\n" +
  "      add: 'Add to chat',",
  "    const en = Object.freeze({\n" +
  "      add: 'Add to chat',\n" +
  "      copy: 'Copy',\n" +
  "      copied: 'Copied',\n" +
  "      toolbarLabel: 'Selection actions',",
  'locale en: toolbar copy'
)
replaceOnce(
  "      const button = document.createElement('button')\n" +
  "      button.type = 'button'\n" +
  "      button.textContent = t('add')\n" +
  "      action.appendChild(button)\n" +
  "      document.body.appendChild(action)",
  "      action.setAttribute('role', 'toolbar')\n" +
  "      action.setAttribute('aria-label', t('toolbarLabel'))\n" +
  "      const button = document.createElement('button')\n" +
  "      button.type = 'button'\n" +
  "      button.setAttribute('data-quote-action', 'add')\n" +
  "      button.textContent = t('add')\n" +
  "      const separator = document.createElement('span')\n" +
  "      separator.setAttribute('data-quote-separator', '')\n" +
  "      separator.setAttribute('aria-hidden', 'true')\n" +
  "      const copy = document.createElement('button')\n" +
  "      copy.type = 'button'\n" +
  "      copy.setAttribute('data-quote-action', 'copy')\n" +
  "      copy.textContent = t('copy')\n" +
  "      action.append(button, separator, copy)\n" +
  "      document.body.appendChild(action)",
  'selection toolbar: add + separator + copy'
)
replaceOnce(
  "      button.addEventListener('click', addToDraft)\n" +
  "      document.addEventListener('selectionchange', updateAction)",
  "      button.addEventListener('click', addToDraft)\n" +
  "      copy.addEventListener('click', copySelection)\n" +
  "      // Clicking the bar must not collapse the live selection: both actions\n" +
  "      // re-read `window.getSelection()` when they run.\n" +
  "      action.addEventListener('mousedown', event => { event.preventDefault() })\n" +
  "      document.addEventListener('selectionchange', updateAction)",
  'selection toolbar: wire copy + keep selection'
)

// The copy implementation, inserted before the pointerdown handler that
// follows addToDraft. Uses the async clipboard API with an execCommand
// fallback for contexts where it is unavailable.
replaceOnce(
  "      const onPointerDown = event => {\n" +
  "        if (!action.contains(event.target)) hideAction()\n" +
  "      }",
  "      /**\n" +
  "       * Copy the live selection to the clipboard.\n" +
  "       *\n" +
  "       * Reads the selection at click time rather than the cached\n" +
  "       * `selectedText`, because the bar neutralises mousedown precisely so\n" +
  "       * the DOM selection survives until the click lands. Falls back to a\n" +
  "       * detached textarea when the async Clipboard API is refused (a\n" +
  "       * non-secure context, or a denied permission).\n" +
  "       */\n" +
  "      function copySelection() {\n" +
  "        const text = window.getSelection()?.toString() || selectedText\n" +
  "        if (text === '') return\n" +
  "        const done = () => {\n" +
  "          copy.textContent = t('copied')\n" +
  "          setTimeout(() => { copy.textContent = t('copy') }, 1200)\n" +
  "        }\n" +
  "        // `window.navigator` first: the browser-scope object is the reliable\n" +
  "        // one, while `globalThis` depends on how the bundle is evaluated.\n" +
  "        const clipboard = window.navigator?.clipboard ?? globalThis.navigator?.clipboard\n" +
  "        if (clipboard?.writeText !== undefined) {\n" +
  "          clipboard.writeText(text).then(done, () => legacyCopy(text, done))\n" +
  "          return\n" +
  "        }\n" +
  "        legacyCopy(text, done)\n" +
  "      }\n" +
  "\n" +
  "      /** Hidden-textarea copy for runtimes without an async clipboard. */\n" +
  "      function legacyCopy(text, done) {\n" +
  "        const area = document.createElement('textarea')\n" +
  "        area.value = text\n" +
  "        area.setAttribute('readonly', '')\n" +
  "        area.style.position = 'fixed'\n" +
  "        area.style.opacity = '0'\n" +
  "        document.body.appendChild(area)\n" +
  "        area.select()\n" +
  "        try { document.execCommand('copy') } catch { /* refused: still reset the label */ }\n" +
  "        area.remove()\n" +
  "        done()\n" +
  "      }\n" +
  "\n" +
  "      const onPointerDown = event => {\n" +
  "        if (!action.contains(event.target)) hideAction()\n" +
  "      }",
  'selection toolbar: copy implementation'
)

// ── patch 8: dispose the copy listener ───────────────────────────────────────
// `action.remove()` detaches the bar but leaves its listeners attached to a
// detached node; an explicit removeEventListener keeps the teardown symmetric
// with `button`'s and satisfies the dispose test.
replaceOnce(
  "      return () => {\n" +
  "        button.removeEventListener('click', addToDraft)\n" +
  "        document.removeEventListener('selectionchange', updateAction)",
  "      return () => {\n" +
  "        button.removeEventListener('click', addToDraft)\n" +
  "        copy.removeEventListener('click', copySelection)\n" +
  "        document.removeEventListener('selectionchange', updateAction)",
  'dispose: copy listener'
)

// ── patch 9: retire the rail, the in-reply markers, and the preview card ─────
// Upstream's design put a floating "N annotations" pill beside the composer, a
// numbered badge next to the quoted passage, and a hover card listing every
// quote. None of that survives contact with the reference design: the chip is
// the whole feature now, and the rail rendered as a stray labelled control
// floating next to the input (its label also leaked the raw i18n key).
//
// `refreshQuoteRail` stays — it is the single place the plugin reconciles its
// `quotes` map against the composer's live occurrences, and five call sites
// depend on that. Only its UI half goes; the reconciliation is what stops a
// deleted chip from leaving a stale quote behind for the codec to trip over.
replaceOnce(
  "      function refreshQuoteRail() {\n" +
  "        const occurrences = quoteOccurrences(currentInput())\n" +
  "        for (const ref of markers.keys()) {\n" +
  "          if (!occurrences.some(occurrence => occurrence.ref === ref)) removeMarker(ref)\n" +
  "        }\n" +
  "        for (const occurrence of occurrences) {\n" +
  "          const quote = quotes.get(occurrence.ref)\n" +
  "          if (quote !== undefined) createMarker(quote, quote.range)\n" +
  "        }\n" +
  "        rail.textContent = ''\n" +
  "        if (occurrences.length === 0) {\n" +
  "          rail.hidden = true\n" +
  "          hidePreviewSoon()\n" +
  "          return\n" +
  "        }\n" +
  "        const card = document.querySelector(CARD_SELECTOR)\n" +
  "        if (card === null) {\n" +
  "          rail.hidden = true\n" +
  "          return\n" +
  "        }\n" +
  "        const pill = document.createElement('button')\n" +
  "        pill.type = 'button'\n" +
  "        pill.setAttribute('data-quote-pill', '')\n" +
  "        const annotationKey = occurrences.length === 1 ? 'annotationOne' : 'annotationMany'\n" +
  "        const manageKey = occurrences.length === 1 ? 'manageOne' : 'manageMany'\n" +
  "        pill.textContent = t(annotationKey, { count: occurrences.length })\n" +
  "        pill.setAttribute('aria-label', t(manageKey, { count: occurrences.length }))\n" +
  "        pill.addEventListener('mouseenter', () => { showPreview(occurrences, pill) })\n" +
  "        pill.addEventListener('mouseleave', hidePreviewSoon)\n" +
  "        pill.addEventListener('focus', () => { showPreview(occurrences, pill) })\n" +
  "        pill.addEventListener('blur', hidePreviewSoon)\n" +
  "        pill.addEventListener('click', () => {\n" +
  "          if (preview.hidden) showPreview(occurrences, pill)\n" +
  "          else hidePreviewSoon()\n" +
  "        })\n" +
  "        const removeAll = document.createElement('button')\n" +
  "        removeAll.type = 'button'\n" +
  "        removeAll.setAttribute('data-quote-remove-all', '')\n" +
  "        removeAll.textContent = '×'\n" +
  "        removeAll.setAttribute('aria-label', t('removeAll'))\n" +
  "        removeAll.addEventListener('click', () => {\n" +
  "          for (const occurrence of occurrences) removeQuote(occurrence.ref)\n" +
  "        })\n" +
  "        rail.append(pill, removeAll)\n" +
  "        const bounds = card.getBoundingClientRect()\n" +
  "        rail.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - 12))}px`\n" +
  "        rail.style.top = `${Math.max(8, bounds.top - 38)}px`\n" +
  "        rail.hidden = false\n" +
  "      }",
  "      /**\n" +
  "       * Reconcile remembered quotes against the composer's live occurrences.\n" +
  "       *\n" +
  "       * The composer owns presence and order; this map only answers \"what text\n" +
  "       * sits behind reference X\" for the codec. Dropping the entries whose chip\n" +
  "       * is gone keeps `serialize()` from throwing on a reference the user\n" +
  "       * already deleted, and keeps a long session from accumulating dead\n" +
  "       * quote bodies.\n" +
  "       */\n" +
  "      function refreshQuoteRail() {\n" +
  "        const live = new Set(quoteOccurrences(currentInput()).map(occurrence => occurrence.ref))\n" +
  "        for (const ref of [...quotes.keys()]) {\n" +
  "          if (!live.has(ref)) quotes.delete(ref)\n" +
  "        }\n" +
  "      }",
  'retire rail UI, keep quote reconciliation'
)

// ── patch 10: drop the now-unreachable marker / preview code ────────────────
// patch 9 removed the only UI that mounted these, so the nodes and the helper
// functions that position them would be dead weight. Removing them also takes
// the raw `@` badge and the second floating panel out of the DOM entirely.
replaceOnce(
  "      const rail = document.createElement('div')\n" +
  "      rail.setAttribute(`data-${RAIL_ID}`, '')\n" +
  "      rail.hidden = true\n" +
  "      document.body.appendChild(rail)\n" +
  "\n" +
  "      const preview = document.createElement('div')\n" +
  "      preview.setAttribute(`data-${PREVIEW_ID}`, '')\n" +
  "      preview.setAttribute('data-quote-preview-list', '')\n" +
  "      preview.hidden = true\n" +
  "      document.body.appendChild(preview)\n",
  "",
  'drop rail + preview nodes'
)
replaceOnce(
  "      const quotes = new Map()\n" +
  "      const markers = new Map()\n" +
  "\n" +
  "      function cancelPreviewHide() {\n" +
  "        if (previewTimer !== null) clearTimeout(previewTimer)\n" +
  "        previewTimer = null\n" +
  "      }\n",
  "      const quotes = new Map()\n",
  'drop markers map + preview timer'
)

// The preview panel, its positioning, and the in-reply badge helpers: all
// unreachable once patch 9 stopped mounting them.
replaceOnce(
  "      function positionPreview(anchor) {\n" +
  "        const bounds = anchor.getBoundingClientRect()\n" +
  "        const margin = 12\n" +
  "        const gap = 8\n" +
  "        const previewBounds = preview.getBoundingClientRect()\n" +
  "        const left = Math.max(margin, Math.min(bounds.left, window.innerWidth - previewBounds.width - margin))\n" +
  "        const below = bounds.bottom + gap\n" +
  "        const above = bounds.top - previewBounds.height - gap\n" +
  "        const top = below + previewBounds.height <= window.innerHeight - margin || above < margin ? below : above\n" +
  "        preview.style.left = `${left}px`\n" +
  "        preview.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - previewBounds.height - margin))}px`\n" +
  "        preview.style.transform = 'none'\n" +
  "      }\n" +
  "\n" +
  "      function repositionPreview() {\n" +
  "        if (preview.hidden || previewAnchor === null || !previewAnchor.isConnected) return\n" +
  "        positionPreview(previewAnchor)\n" +
  "      }\n" +
  "\n" +
  "      function hidePreviewSoon() {\n" +
  "        cancelPreviewHide()\n" +
  "        previewTimer = setTimeout(() => {\n" +
  "          preview.hidden = true\n" +
  "          preview.textContent = ''\n" +
  "          previewAnchor = null\n" +
  "          previewTimer = null\n" +
  "        }, 80)\n" +
  "      }\n" +
  "\n" +
  "      function showPreview(occurrences, anchor) {\n" +
  "        cancelPreviewHide()\n" +
  "        preview.textContent = ''\n" +
  "        for (const occurrence of occurrences) {\n" +
  "          const quote = quotes.get(occurrence.ref) || {\n" +
  "            ref: occurrence.ref,\n" +
  "            text: occurrence.clipboardText,\n" +
  "            label: occurrence.label,\n" +
  "          }\n" +
  "          const item = document.createElement('div')\n" +
  "          item.setAttribute('data-quote-preview-item', '')\n" +
  "          const text = document.createElement('div')\n" +
  "          text.setAttribute('data-quote-preview-text', '')\n" +
  "          text.textContent = quote.text\n" +
  "          const content = document.createElement('div')\n" +
  "          content.setAttribute('data-quote-preview-content', '')\n" +
  "          const label = document.createElement('div')\n" +
  "          label.setAttribute('data-quote-preview-label', '')\n" +
  "          label.textContent = t('selectedText')\n" +
  "          const remove = document.createElement('button')\n" +
  "          remove.type = 'button'\n" +
  "          remove.textContent = '×'\n" +
  "          remove.setAttribute('data-quote-preview-remove', '')\n" +
  "          remove.setAttribute('aria-label', t('removeReference'))\n" +
  "          remove.addEventListener('click', () => { removeQuote(occurrence.ref) })\n" +
  "          content.append(label, text)\n" +
  "          item.append(content, remove)\n" +
  "          preview.appendChild(item)\n" +
  "        }\n" +
  "        if (!preview.hasChildNodes()) return\n" +
  "        previewAnchor = anchor\n" +
  "        preview.style.visibility = 'hidden'\n" +
  "        preview.hidden = false\n" +
  "        positionPreview(anchor)\n" +
  "        preview.style.visibility = ''\n" +
  "      }\n" +
  "\n" +
  "      preview.addEventListener('mouseenter', cancelPreviewHide)\n" +
  "      preview.addEventListener('mouseleave', hidePreviewSoon)\n" +
  "      preview.addEventListener('focusin', cancelPreviewHide)\n" +
  "      preview.addEventListener('focusout', hidePreviewSoon)\n" +
  "      window.addEventListener('resize', repositionPreview, { passive: true })\n" +
  "      document.addEventListener('scroll', repositionPreview, true)\n" +
  "\n" +
  "      function removeMarker(ref) {\n" +
  "        const marker = markers.get(ref)\n" +
  "        if (marker === undefined) return\n" +
  "        marker.button.remove()\n" +
  "        marker.preview.remove()\n" +
  "        markers.delete(ref)\n" +
  "      }\n" +
  "\n" +
  "      function positionMarker(marker) {\n" +
  "        try {\n" +
  "          const bounds = marker.range.getBoundingClientRect()\n" +
  "          if (bounds.width === 0 && bounds.height === 0) {\n" +
  "            marker.button.hidden = true\n" +
  "            marker.preview.hidden = true\n" +
  "            return\n" +
  "          }\n" +
  "          marker.button.style.left = `${Math.min(window.innerWidth - 28, Math.max(6, bounds.right + 5))}px`\n" +
  "          marker.button.style.top = `${Math.max(6, bounds.top - 3)}px`\n" +
  "          marker.button.hidden = false\n" +
  "          if (!marker.anchored && !marker.preview.hidden) {\n" +
  "            const buttonBounds = marker.button.getBoundingClientRect()\n" +
  "            marker.preview.style.left = `${buttonBounds.left}px`\n" +
  "            marker.preview.style.top = `${buttonBounds.bottom + 8}px`\n" +
  "          }\n" +
  "        } catch {\n" +
  "          marker.button.hidden = true\n" +
  "          marker.preview.hidden = true\n" +
  "        }\n" +
  "      }\n" +
  "\n" +
  "      function createMarker(quote, range) {\n" +
  "        const existing = markers.get(quote.ref)\n" +
  "        if (existing !== undefined) {\n" +
  "          positionMarker(existing)\n" +
  "          return\n" +
  "        }\n" +
  "        if (range === null) return\n" +
  "        const markerButton = document.createElement('button')\n" +
  "        markerButton.type = 'button'\n" +
  "        markerButton.setAttribute(`data-${MARKER_ID}`, '')\n" +
  "        markerButton.textContent = '1'\n" +
  "        markerButton.setAttribute('aria-label', t('addedOne'))\n" +
  "        const markerPreview = document.createElement('div')\n" +
  "        markerPreview.setAttribute(`data-${PREVIEW_ID}`, '')\n" +
  "        markerPreview.textContent = quote.text\n" +
  "        markerPreview.hidden = true\n" +
  "        const anchored = typeof CSS !== 'undefined' && CSS.supports?.('anchor-name: --dsh-cite-inline-anchor') === true\n" +
  "        if (anchored) {\n" +
  "          const anchorName = `--dsh-cite-inline-${quote.ref.replace(/[^a-z0-9-]/giu, '')}`\n" +
  "          markerButton.style.setProperty('anchor-name', anchorName)\n" +
  "          markerPreview.style.setProperty('position-anchor', anchorName)\n" +
  "          markerPreview.setAttribute('data-anchored', '')\n" +
  "        }\n" +
  "        const marker = { button: markerButton, preview: markerPreview, range, anchored }\n" +
  "        markerButton.addEventListener('mouseenter', () => { markerPreview.hidden = false; positionMarker(marker) })\n" +
  "        markerButton.addEventListener('mouseleave', () => { markerPreview.hidden = true })\n" +
  "        markerButton.addEventListener('focus', () => { markerPreview.hidden = false; positionMarker(marker) })\n" +
  "        markerButton.addEventListener('blur', () => { markerPreview.hidden = true })\n" +
  "        markerButton.addEventListener('click', () => { markerPreview.hidden = !markerPreview.hidden; positionMarker(marker) })\n" +
  "        document.body.append(markerButton, markerPreview)\n" +
  "        markers.set(quote.ref, marker)\n" +
  "        positionMarker(marker)\n" +
  "      }\n" +
  "\n",
  "",
  'drop preview + marker helpers'
)

// The remaining references to the retired helpers.
replaceOnce(
  "        if (input.insertText('', { start, end: start + 1, draftRev: snapshot.draftRev }) !== true) return\n" +
  "        quotes.delete(ref)\n" +
  "        removeMarker(ref)\n" +
  "        refreshQuoteRail()\n" +
  "      }",
  "        if (input.insertText('', { start, end: start + 1, draftRev: snapshot.draftRev }) !== true) return\n" +
  "        quotes.delete(ref)\n" +
  "      }",
  'removeQuote: drop marker/rail calls'
)
replaceOnce(
  "        createMarker(quote, selectedRange)\n" +
  "        window.getSelection()?.removeAllRanges()\n" +
  "        hideAction()\n" +
  "        refreshQuoteRail()\n" +
  "      }",
  "        window.getSelection()?.removeAllRanges()\n" +
  "        hideAction()\n" +
  "        refreshQuoteRail()\n" +
  "      }",
  'addToDraft: drop createMarker'
)
replaceOnce(
  "      function refreshLocalizedCopy() {\n" +
  "        button.textContent = t('add')\n" +
  "        cancelPreviewHide()\n" +
  "        preview.hidden = true\n" +
  "        preview.textContent = ''\n" +
  "        previewAnchor = null\n" +
  "        for (const marker of markers.values()) marker.button.setAttribute('aria-label', t('addedOne'))\n" +
  "        refreshQuoteRail()\n" +
  "      }",
  "      function refreshLocalizedCopy() {\n" +
  "        button.textContent = t('add')\n" +
  "        copy.textContent = t('copy')\n" +
  "        action.setAttribute('aria-label', t('toolbarLabel'))\n" +
  "      }",
  'refreshLocalizedCopy: toolbar only'
)
replaceOnce(
  "      const onViewportChange = () => {\n" +
  "        hideAction()\n" +
  "        refreshQuoteRail()\n" +
  "        for (const marker of markers.values()) positionMarker(marker)\n" +
  "      }",
  "      const onViewportChange = () => {\n" +
  "        hideAction()\n" +
  "      }",
  'onViewportChange: drop marker repositioning'
)
replaceOnce(
  "        inputOff?.()\n" +
  "        window.removeEventListener('resize', repositionPreview)\n" +
  "        document.removeEventListener('scroll', repositionPreview, true)\n" +
  "        action.remove()\n" +
  "        rail.remove()\n" +
  "        preview.remove()\n" +
  "        for (const marker of markers.values()) {\n" +
  "          marker.button.remove()\n" +
  "          marker.preview.remove()\n" +
  "        }\n" +
  "      }",
  "        inputOff?.()\n" +
  "        action.remove()\n" +
  "      }",
  'dispose: drop rail/marker/preview teardown'
)

// ── patch 11: strip the dead rail / preview / marker CSS ───────────────────
// Their elements no longer exist, so the rules are unreachable. The toolbar and
// chip rules are all that remain, which makes the stylesheet readable again.
replaceOnce(
  "        `[data-${ACTION_ID}], [data-${RAIL_ID}], [data-${PREVIEW_ID}], [data-${MARKER_ID}] { position: fixed; z-index: 1; }`,\n" +
  "        `[data-${ACTION_ID}][hidden], [data-${RAIL_ID}][hidden], [data-${PREVIEW_ID}][hidden], [data-${MARKER_ID}][hidden] { display: none !important; }`,\n",
  "        `[data-${ACTION_ID}] { position: fixed; z-index: 1; }`,\n" +
  "        `[data-${ACTION_ID}][hidden] { display: none !important; }`,\n",
  'css: scope fixed positioning to the toolbar'
)
replaceOnce(
  "        `[data-${ACTION_ID}] button, [data-${RAIL_ID}] [data-quote-pill] { position: relative; overflow: hidden; border: 0; border-radius: var(--dsw-radius-md, 6px); background: transparent; color: var(--dsw-alias-label-primary, #17191c); font: inherit; }`,",
  "        `[data-${ACTION_ID}] button { position: relative; overflow: hidden; border: 0; border-radius: var(--dsw-radius-md, 6px); background: transparent; color: var(--dsw-alias-label-primary, #17191c); font: inherit; }`,",
  'css: toolbar button base'
)
replaceOnce(
  "        `[data-${RAIL_ID}] { display: flex; align-items: center; gap: 4px; }`,\n" +
  "        `[data-${RAIL_ID}] [data-quote-pill] { height: 30px; padding: 0 11px; cursor: pointer; font-size: 13px; }`,\n" +
  "        `[data-${RAIL_ID}] [data-quote-remove-all] { width: 30px; height: 30px; margin-left: -6px; border: 0; border-radius: 50%; cursor: pointer; background: transparent; color: var(--dsw-alias-label-primary, #17191c); font: 18px/1 system-ui, sans-serif; }`,\n" +
  "        `[data-${PREVIEW_ID}] { box-sizing: border-box; width: min(420px, calc(100vw - 24px)); border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 14%)); border-radius: 14px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 12px 30px rgb(15 23 42 / 18%), 0 1px 4px rgb(15 23 42 / 12%); color: var(--dsw-alias-label-primary, #17191c); font: 12px/1.45 system-ui, sans-serif; }`,\n" +
  "        `[data-${PREVIEW_ID}][data-quote-preview-list] { counter-reset: dsh-cite-inline-quote; }`,\n" +
  "        `[data-${PREVIEW_ID}] [data-quote-preview-item] { display: grid; grid-template-columns: 28px minmax(0, 1fr) 20px; column-gap: 8px; padding: 14px; }`,\n" +
  "        `[data-${PREVIEW_ID}] [data-quote-preview-item] + [data-quote-preview-item] { border-top: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%)); }`,\n" +
  "        `[data-${PREVIEW_ID}][data-quote-preview-list] [data-quote-preview-item]::before { grid-column: 1; counter-increment: dsh-cite-inline-quote; content: counter(dsh-cite-inline-quote) '.'; color: var(--dsw-alias-label-tertiary, #8b9199); font-size: 12px; line-height: 1.5; }`,\n" +
  "        `[data-${PREVIEW_ID}] [data-quote-preview-content] { grid-column: 2; min-width: 0; }`,\n" +
  "        `[data-${PREVIEW_ID}] [data-quote-preview-label] { margin-bottom: 2px; color: var(--dsw-alias-label-tertiary, #8b9199); font-size: 12px; }`,\n" +
  "        `[data-${PREVIEW_ID}] [data-quote-preview-text] { max-height: 104px; overflow: auto; color: var(--dsw-alias-label-primary, #17191c); font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }`,\n" +
  "        `[data-${PREVIEW_ID}] [data-quote-preview-remove] { grid-column: 3; align-self: start; width: 20px; height: 20px; border: 0; border-radius: 50%; cursor: pointer; background: transparent; color: var(--dsw-alias-label-tertiary, #8b9199); font-size: 15px; line-height: 1; opacity: .58; }`,\n" +
  "        `[data-${PREVIEW_ID}] [data-quote-preview-remove]:hover, [data-${PREVIEW_ID}] [data-quote-preview-remove]:focus-visible { background: rgb(15 23 42 / 8%); color: var(--dsw-alias-label-primary, #17191c); opacity: 1; }`,\n" +
  "        `[data-${MARKER_ID}] { display: grid; width: 22px; height: 22px; place-items: center; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary, #1677ff) 28%, transparent); border-radius: 50%; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-state-business-primary, #1677ff); box-shadow: 0 4px 12px rgb(15 23 42 / 14%); cursor: pointer; font: 11px/1 system-ui, sans-serif; }`,\n" +
  "        `@supports not (backdrop-filter: blur(3px)) { [data-${ACTION_ID}] button, [data-${RAIL_ID}] [data-quote-pill] { background: var(--dsw-alias-bg-layer-1, #fff); } }`,\n" +
  "        `@supports (anchor-name: --dsh-cite-inline-anchor) { [data-${PREVIEW_ID}][data-anchored] { top: anchor(bottom); left: anchor(center); transform: translate(-50%, 8px); position-try-fallbacks: flip-block, flip-inline; } }`,\n",
  "        `@supports not (backdrop-filter: blur(3px)) { [data-${ACTION_ID}] button { background: var(--dsw-alias-bg-layer-1, #fff); } }`,\n",
  'css: drop rail/preview/marker rules'
)
replaceOnce(
  "    const RAIL_ID = 'dsh-cite-inline-rail'\n" +
  "    const PREVIEW_ID = 'dsh-cite-inline-preview'\n" +
  "    const MARKER_ID = 'dsh-cite-inline-marker'\n",
  "",
  'drop unused element ids'
)
replaceOnce(
  "      let previewTimer = null\n" +
  "      let previewAnchor = null\n",
  "",
  'drop preview state vars'
)

// ── patch 12: one single-line label, shared by the chip and the wire ────────
// `compactLabel` used to truncate to 28 characters and prepend a 「引用：」
// prefix. Both were wrong for the reference shape: the prefix is not in the
// design, and the manual truncation fought the CSS ellipsis (DSH caps the
// composer chip at 240px and ellipsises; the sent chip does the same now).
//
// What the label MUST still do is collapse to one line. `projectUserText`'s
// token regex is `@"[^"\n]+"` — a newline inside the quotes breaks the token in
// two, so a multi-paragraph selection would stop rendering as a chip at all.
replaceOnce(
  "    function compactLabel(text, t) {\n" +
  "      const firstLine = text.trim().replace(/\\s+/gu, ' ').slice(0, 28)\n" +
  "      return firstLine === '' ? t('emptyQuote') : t('quotePrefix', { text: firstLine })\n" +
  "    }",
  "    /**\n" +
  "     * Collapse a quote to the single line a chip label requires.\n" +
  "     *\n" +
  "     * Three substitutions, all forced by how a sent bubble re-derives the\n" +
  "     * chip from plain text (`projectUserText` in ui-primitives):\n" +
  "     *\n" +
  "     *  - whitespace, newlines included, folds to one space. The token regex\n" +
  "     *    is `@\"[^\"\\n]+\"`, so a newline inside the quotes would split the\n" +
  "     *    token and the chip would silently degrade to plain, spilled text.\n" +
  "     *  - a double quote inside the body closes the token early and spills the\n" +
  "     *    remainder as a plain run, so it becomes a typographic quotation mark\n" +
  "     *    (same meaning, no delimiter collision).\n" +
  "     *  - a slash makes the renderer treat the label as a file path and keep\n" +
  "     *    only the last segment, silently dropping the rest of the quote, so\n" +
  "     *    it becomes a look-alike division slash.\n" +
  "     *\n" +
  "     * Length is deliberately NOT trimmed here — the chip's ellipsis owns that,\n" +
  "     * and truncating would also shorten what the model reads.\n" +
  "     *\n" +
  "     * @param text - the raw selection.\n" +
  "     * @param t - locale-bound translator, for the empty-selection fallback.\n" +
  "     * @returns one line, or the localized placeholder when nothing was selected.\n" +
  "     */\n" +
  "    function compactLabel(text, t) {\n" +
  "      const line = text\n" +
  "        .replace(/\\s+/gu, ' ')\n" +
  "        .replace(/\"/gu, '\\u201d')\n" +
  "        .replace(/\\//gu, '\\u2215')\n" +
  "        .trim()\n" +
  "      return line === '' ? t('emptyQuote') : line\n" +
  "    }",
  'label: neutralize quote-breaking characters'
)

// ── patch 13: sidebar session-menu row — copy the native session id ──────────
// Stock DSH publishes the roster slot `sidebar.workspaces.session.menu.item`:
// the workspace browser renders every registrant into each session's ⋯ menu,
// the parent slot injects `useMenuOpenState` (the hook a row uses to close the
// menu it lives in), and rendering through the official MenuItemButton gives the
// row the same material as rename / fork / archive — hover and dark theme
// included — with no CSS of our own. No core patch is involved.
replaceOnce(
  "    const QUOTE_SOURCE = 'dsh-cite-inline-quote'",
  "    const QUOTE_SOURCE = 'dsh-cite-inline-quote'\n" +
  "    // Stock roster slot for one row in a session's sidebar menu. The workspace\n" +
  "    // browser renders every registrant; the parent slot supplies the\n" +
  "    // `useMenuOpenState` hook, so a row gets menu-close without owning the menu.\n" +
  "    const SESSION_MENU_SLOT = 'sidebar.workspaces.session.menu.item'",
  'session menu slot constant'
)

// The factory must receive the module loader's require to reach React and the
// official primitives. Every shipped client bundle is written this way; the
// authority comes from the loader, not from `dsh.client.inject` (which stays
// empty here on purpose — declaring a package the loader cannot serve as a
// client entry is its own boot hazard).
replaceOnce(
  "  factory: () => {\n" +
  "    'use strict'",
  "  factory: require => {\n" +
  "    'use strict'",
  'factory takes require'
)

// Menu-row copy for the row's two states.
replaceOnce(
  "      toolbarLabel: '选中文本操作',",
  "      toolbarLabel: '选中文本操作',\n" +
  "      menuCopySessionId: '复制会话 ID',\n" +
  "      menuCopied: '会话 ID 已复制',",
  'locale zh: session menu row'
)
replaceOnce(
  "      toolbarLabel: 'Selection actions',",
  "      toolbarLabel: 'Selection actions',\n" +
  "      menuCopySessionId: 'Copy session ID',\n" +
  "      menuCopied: 'Session ID copied',",
  'locale en: session menu row'
)

// The registration itself, placed with the other apply()-time wiring.
replaceOnce(
  "      const sessionsOff = ctx.sessions.list.subscribe(observeCurrentInput)\n" +
  "      const localeOff = ctx.locale.subscribe(refreshLocalizedCopy)\n",
  "      const sessionsOff = ctx.sessions.list.subscribe(observeCurrentInput)\n" +
  "      const localeOff = ctx.locale.subscribe(refreshLocalizedCopy)\n" +
  "      // ── sidebar session-menu row: copy the session's native id ───────────\n" +
  "      // Rides stock DSH's public roster slot. The workspace browser renders\n" +
  "      // every registrant into each session's ⋯ menu, the parent slot injects\n" +
  "      // `useMenuOpenState` (how a row closes that menu), and MenuItemButton\n" +
  "      // supplies the official row material — label, icon column, hover, dark\n" +
  "      // theme — so this plugin owns no menu CSS at all.\n" +
  "      //\n" +
  "      // Guarded end to end on purpose. A menu row is a convenience: it must\n" +
  "      // never break the composer feature, and above all it must never let\n" +
  "      // apply() throw. A throwing client entry is exactly what drives DSH into\n" +
  "      // its boot-failure recovery, whose \"disable all plugins\" path rewrites\n" +
  "      // package.json's bundles down to the two core entries and loses the\n" +
  "      // whole profile.\n" +
  "      try {\n" +
  "        const slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined\n" +
  "        if (slots !== undefined && typeof slots.inject === 'function' && typeof slots.register === 'function' && typeof require === 'function') {\n" +
  "          const React = require('react')\n" +
  "          const primitives = require('@deepseek-ai/dsh-client-ui-primitives')\n" +
  "          const writeClipboard = primitives.writeClipboard\n" +
  "          const MenuItemButton = primitives.MenuItemButton\n" +
  "          const IconCopy = primitives.IconCopyOutlineRegular\n" +
  "          if (typeof writeClipboard === 'function' && MenuItemButton !== undefined && IconCopy !== undefined) {\n" +
  "            const CopySessionIdRow = props => {\n" +
  "              const [copied, setCopied] = React.useState(false)\n" +
  "              const t = typeof props.t === 'function' ? props.t : key => key\n" +
  "              // The parent slot owns the menu; this hook is the only way to\n" +
  "              // close it, and it is absent outside the sidebar's roster.\n" +
  "              const hooks = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : undefined\n" +
  "              const setMenuOpen = Array.isArray(hooks) ? hooks[1] : undefined\n" +
  "              const closeMenu = () => { if (typeof setMenuOpen === 'function') setMenuOpen(false) }\n" +
  "              // Hold the menu open briefly so the confirmation is readable,\n" +
  "              // then close — the same shape the official rename row uses.\n" +
  "              React.useEffect(() => {\n" +
  "                if (!copied) return undefined\n" +
  "                const timer = setTimeout(closeMenu, 900)\n" +
  "                return () => { clearTimeout(timer) }\n" +
  "              }, [copied])\n" +
  "              const onSelect = () => {\n" +
  "                if (copied) return\n" +
  "                const settle = ok => { if (ok === true) setCopied(true); else closeMenu() }\n" +
  "                let result\n" +
  "                try {\n" +
  "                  result = writeClipboard(String(props.sessionId))\n" +
  "                } catch (error) {\n" +
  "                  console.warn('[dsh-cite-inline] copy session id failed:', error)\n" +
  "                  closeMenu()\n" +
  "                  return\n" +
  "                }\n" +
  "                if (result !== null && typeof result === 'object' && typeof result.then === 'function') {\n" +
  "                  result.then(settle, closeMenu)\n" +
  "                  return\n" +
  "                }\n" +
  "                settle(result)\n" +
  "              }\n" +
  "              return React.createElement(MenuItemButton, {\n" +
  "                icon: React.createElement(IconCopy, {}),\n" +
  "                onSelect,\n" +
  "              }, t(copied ? 'menuCopied' : 'menuCopySessionId'))\n" +
  "            }\n" +
  "            ctx.effect(() => slots.inject(SESSION_MENU_SLOT, () => slots.register({\n" +
  "              name: SESSION_MENU_SLOT,\n" +
  "              id: 'dsh-cite-inline-copy-session-id',\n" +
  "              order: 250,\n" +
  "              locale: LOCALE_NS,\n" +
  "              inject: () => ({}),\n" +
  "            }, CopySessionIdRow)), 'dsh-cite-inline: session menu row')\n" +
  "          }\n" +
  "        }\n" +
  "      } catch (error) {\n" +
  "        console.warn('[dsh-cite-inline] session menu row unavailable:', error)\n" +
  "      }\n",
  'session menu row registration'
)

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT, code, 'utf8')
console.log('\nwrote ' + OUT + ' (' + Buffer.byteLength(code, 'utf8') + ' bytes)')

// ── sanity: no fork-only contract may survive in executable code ─────────────
// Comments name the removed contract on purpose, so strip them before checking.
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/\/\/.*$/, ''))
  .join('\n')

const problems = []
if (codeOnly.includes('dsh-add-to-chat')) problems.push('upstream identifier survived')
if (codeOnly.includes('data-dsh-message-role')) problems.push('fork-only role marker survived')
if (codeOnly.includes('draftContexts')) problems.push('fork-only draftContexts survived')
if (codeOnly.includes('getSnapshot().current')) problems.push('legacy .current lookup survived')
if (!codeOnly.includes('data-chat-flow-kind')) problems.push('flow-kind selector missing')
if (!codeOnly.includes('retainedBy')) problems.push('retainedBy fallback missing')
if (problems.length > 0) {
  console.error('\nSANITY FAILED:\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log('sanity: clean (no fork-only contract; both ports present)')