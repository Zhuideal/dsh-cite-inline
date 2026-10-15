// Browser half of dsh-cite-inline: select text in an assistant reply, click
// "Add to chat", and the selection rides the next submission as one visible
// composer reference chip.
//
// Ported to stock DSH 0.2.0-rc.2 from choco9527/dsh-cite-inline (MIT). Upstream
// HEAD targets a DSH fork: it needs `conversation.draftContexts` and an assistant
// reply marker `data-dsh-message-role`, and neither exists in stock DSH. This
// port uses only extension points stock DSH actually publishes:
//   - `inputTriggers` reference source (the public `@`-reference pipeline)
//   - `conversation.input.for(scope)` + `insertReference` / `insertText`
//   - `[data-chat-flow-kind="assistant-step"]` for assistant prose rows
//   - `retainedBy.mainView` for the active session
// Trade-off against upstream HEAD: annotations live in the composer as chips
// instead of out-of-band draft contexts, so the composer is not textually clean.
//
// Rebuild with tools/build-client.cjs; verify with tools/port.test.mjs.
window.__ModuleLoader__.load({
  id: 'dsh-cite-inline',
  factory: require => {
    'use strict'

    const STYLE_ID = 'dsh-cite-inline-style'
    const ACTION_ID = 'dsh-cite-inline-action'
    const PLUGIN_ID = 'dsh-cite-inline'
    const LOCALE_NS = 'cite-inline'
    // Reference-source identity. The composer routes every chip this plugin
    // inserts back to the codec below by this name, so it doubles as the
    // filter that separates our occurrences from other sources' chips.
    const QUOTE_SOURCE = 'dsh-cite-inline-quote'
    // Stock roster slot for one row in a session's sidebar menu. The workspace
    // browser renders every registrant; the parent slot supplies the
    // `useMenuOpenState` hook, so a row gets menu-close without owning the menu.
    const SESSION_MENU_SLOT = 'sidebar.workspaces.session.menu.item'
    // Assistant prose rows. ui-chat wraps every chat node in a div carrying
// `data-chat-flow-kind` and registers the `assistant-step` node kind, so this
// is the chat surface's real DOM contract. Upstream used the fork-only
// `data-dsh-message-role` attribute, which no stock DSH build emits.
const ASSISTANT_REPLY_SELECTOR = '[data-chat-flow-kind="assistant-step"]'
    const CARD_SELECTOR = '[data-composer-card]'
    const zh = Object.freeze({
      add: '添加到对话',
      copy: '复制',
      copied: '已复制',
      toolbarLabel: '选中文本操作',
      menuCopySessionId: '复制会话 ID',
      menuCopied: '会话 ID 已复制',
      selectedText: '所选文本：',
      removeReference: '删除引用',
      addedOne: '已添加 1 条引用',
      annotationOne: '1 条注释',
      annotationMany: '{count} 条注释',
      manageOne: '管理 1 条注释',
      manageMany: '管理 {count} 条注释',
      removeAll: '删除全部引用',
      emptyQuote: '助手引用',
      quotePrefix: '引用：{text}',
      contextLabel: '引用助手回复：',
    })
    const en = Object.freeze({
      add: 'Add to chat',
      copy: 'Copy',
      copied: 'Copied',
      toolbarLabel: 'Selection actions',
      menuCopySessionId: 'Copy session ID',
      menuCopied: 'Session ID copied',
      selectedText: 'Selected text:',
      removeReference: 'Remove reference',
      addedOne: '1 reference added',
      annotationOne: '1 annotation',
      annotationMany: '{count} annotations',
      manageOne: 'Manage 1 annotation',
      manageMany: 'Manage {count} annotations',
      removeAll: 'Remove all references',
      emptyQuote: 'Assistant quote',
      quotePrefix: 'Quote: {text}',
      contextLabel: 'Quoted assistant reply:',
    })

    function installStyle() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        `[data-${ACTION_ID}] { position: fixed; z-index: 1; }`,
        `[data-${ACTION_ID}][hidden] { display: none !important; }`,
        `[data-${ACTION_ID}] { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2, #000) 12%, transparent); border-radius: var(--dsw-radius-lg, 10px); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 92%, transparent); box-shadow: var(--dsw-elevation-prominent, 0 6px 24px rgb(15 23 42 / 18%)); backdrop-filter: blur(2px) saturate(1.12); -webkit-backdrop-filter: blur(2px) saturate(1.12); transform: translate(-50%, -100%); }`,
        `[data-${ACTION_ID}][data-placement="below"] { transform: translateX(-50%); }`,
        `[data-${ACTION_ID}] button { position: relative; overflow: hidden; border: 0; border-radius: var(--dsw-radius-md, 6px); background: transparent; color: var(--dsw-alias-label-primary, #17191c); font: inherit; }`,
        `[data-${ACTION_ID}] button { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; cursor: pointer; font-size: 13px; white-space: nowrap; }`,
        `[data-${ACTION_ID}] button:hover, [data-${ACTION_ID}] button:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgb(15 23 42 / 8%)); }`,
        `[data-${ACTION_ID}] [data-quote-separator] { flex: none; width: 1px; height: 14px; margin: 0 3px; background: var(--dsw-alias-border-l1, rgb(0 0 0 / 14%)); }`,
        `[data-${ACTION_ID}] button[data-quote-action="add"] { color: var(--dsw-alias-state-business-primary, #4176e6); font-weight: 500; }`,
        `@supports not (backdrop-filter: blur(3px)) { [data-${ACTION_ID}] button { background: var(--dsw-alias-bg-layer-1, #fff); } }`,
        `.mxScHa_reference.rtYPxa_chip { background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 82%, var(--dsw-alias-state-business-primary, #4176e6)); border-radius: var(--dsw-radius-sm, 4px); padding: 1px 6px; margin: 0 2px; color: var(--dsw-alias-label-primary, #0f1115); }`,
        `.mxScHa_reference.rtYPxa_chip:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 68%, var(--dsw-alias-state-business-primary, #4176e6)); }`,
        `.mxScHa_reference.rtYPxa_chip .rtYPxa_icon { color: var(--dsw-alias-state-business-primary, #4176e6); }`,
        `[data-ref-chip] { display: inline-block; max-width: 240px; background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 82%, var(--dsw-alias-state-business-primary, #4176e6)); border-radius: var(--dsw-radius-sm, 4px); padding: 1px 6px; margin: 0 2px; color: var(--dsw-alias-label-primary, #0f1115); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }`,
        `[data-ref-chip]:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-tertiary, #e4edfd) 68%, var(--dsw-alias-state-business-primary, #4176e6)); }`,
        `[data-ref-chip] .refIcon, [data-ref-chip] svg { color: var(--dsw-alias-state-business-primary, #4176e6); flex: none; }`,
      ].join('\n')
      document.head.appendChild(style)
    }

    function assistantReply(node) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
      return element?.closest(ASSISTANT_REPLY_SELECTOR)
    }

    function isAssistantSelection(selection) {
      const anchor = assistantReply(selection.anchorNode)
      return anchor !== undefined && anchor !== null && anchor === assistantReply(selection.focusNode)
    }

    /**
     * Collapse a quote to the single line a chip label requires.
     *
     * Three substitutions, all forced by how a sent bubble re-derives the
     * chip from plain text (`projectUserText` in ui-primitives):
     *
     *  - whitespace, newlines included, folds to one space. The token regex
     *    is `@"[^"\n]+"`, so a newline inside the quotes would split the
     *    token and the chip would silently degrade to plain, spilled text.
     *  - a double quote inside the body closes the token early and spills the
     *    remainder as a plain run, so it becomes a typographic quotation mark
     *    (same meaning, no delimiter collision).
     *  - a slash makes the renderer treat the label as a file path and keep
     *    only the last segment, silently dropping the rest of the quote, so
     *    it becomes a look-alike division slash. A backslash does exactly the
     *    same: displayLabel splits on `[\\/]`, so a Windows path in the
     *    selection (`C:\\Users\\...`) would otherwise collapse the chip to the
     *    text after its final backslash. Both separators are normalized.
     *
     * Length is deliberately NOT trimmed here — the chip's ellipsis owns that,
     * and truncating would also shorten what the model reads.
     *
     * @param text - the raw selection.
     * @param t - locale-bound translator, for the empty-selection fallback.
     * @returns one line, or the localized placeholder when nothing was selected.
     */
    function compactLabel(text, t) {
      const line = text
        .replace(/\s+/gu, ' ')
        .replace(/"/gu, '\u201d')
        .replace(/[\\/]/gu, '\u2215')
        .trim()
      return line === '' ? t('emptyQuote') : line
    }

    function referenceId() {
      return globalThis.crypto?.randomUUID?.() || `quote-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }

    /**
     * Caret offset of the draft end in *editor* coordinates.
     *
     * `state.draft` is the clipboard projection, where each chip contributes
     * its whole `clipboardText`; the editor counts every chip as one
     * placeholder character. Collapsing that difference gives the span the
     * editor accepts for an append.
     */
    function detectEnd(snapshot) {
      return snapshot.draft.length - snapshot.occurrences.reduce(
        (size, occurrence) => size + occurrence.length - 1,
        0,
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-cite-inline: locale')
      const t = ctx.locale.bind(LOCALE_NS)
      installStyle()
      const action = document.createElement('div')
      action.setAttribute(`data-${ACTION_ID}`, '')
      action.hidden = true
      action.setAttribute('role', 'toolbar')
      action.setAttribute('aria-label', t('toolbarLabel'))
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('data-quote-action', 'add')
      button.textContent = t('add')
      const separator = document.createElement('span')
      separator.setAttribute('data-quote-separator', '')
      separator.setAttribute('aria-hidden', 'true')
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.setAttribute('data-quote-action', 'copy')
      copy.textContent = t('copy')
      action.append(button, separator, copy)
      document.body.appendChild(action)


      let selectedText = ''
      let selectedRange = null
      let observedInput = null
      let inputOff = null
      // Quote bodies keyed by reference id. The composer owns *where* each
      // reference sits and how many there are; this map only remembers the
      // text behind one, which the codec needs to answer with at send time.
      const quotes = new Map()

      function hideAction() {
        action.hidden = true
        selectedText = ''
        selectedRange = null
      }

      function updateAction() {
        const selection = window.getSelection()
        const text = selection?.toString().trim() || ''
        if (!selection || !text || !isAssistantSelection(selection) || selection.rangeCount === 0) {
          hideAction()
          return
        }
        const bounds = selection.getRangeAt(0).getBoundingClientRect()
        if (bounds.width === 0 && bounds.height === 0) {
          hideAction()
          return
        }
        selectedText = text
        selectedRange = selection.getRangeAt(0).cloneRange()
        const left = Math.max(68, Math.min(bounds.left + bounds.width / 2, window.innerWidth - 68))
        const above = bounds.top - 8
        action.style.left = `${left}px`
        action.style.top = `${above >= 44 ? above : bounds.bottom + 8}px`
        action.setAttribute('data-placement', above >= 44 ? 'above' : 'below')
        action.hidden = false
      }

      /**
       * The active session id.
       *
       * Legacy catalogs publish it as `current`. DSH 0.2.0-rc.1 dropped that
       * field and marks the session the main view retains through the
       * `retainedBy` counters instead. Only the main view's session is the
       * active one: background subagent sessions carry their own counter.
       */
      function currentSessionId() {
        const list = ctx.sessions.list.getSnapshot()
        if (typeof list.current === 'string' && list.current !== '') return list.current
        return Object.values(list.byId).find(
          session => (session?.retainedBy?.mainView ?? 0) > 0,
        )?.id
      }

      /**
       * The composer input facade of the selected session, or undefined when
       * no session is selected. Session-addressed on every call: a facade
       * captured across a session switch would edit the wrong composer.
       */
      function currentInput() {
        const sessionId = currentSessionId()
        const scope = sessionId === undefined ? undefined : ctx.sessions.scope(sessionId)
        return scope === undefined ? undefined : ctx.conversation.input.for(scope)
      }

      /** This plugin's chips in the live draft, in document order. */
      function quoteOccurrences(input) {
        return input?.state.getSnapshot().occurrences.filter(
          occurrence => occurrence.source === QUOTE_SOURCE,
        ) || []
      }

      /**
       * Delete one chip by replacing its single editor placeholder character
       * with nothing. Offsets arrive in clipboard coordinates, so preceding
       * chips are collapsed back to one character each first.
       */
      function removeQuote(ref) {
        const input = currentInput()
        const snapshot = input?.state.getSnapshot()
        if (snapshot === undefined) return
        const index = snapshot.occurrences.findIndex(
          occurrence => occurrence.source === QUOTE_SOURCE && occurrence.ref === ref,
        )
        if (index < 0) return
        let start = snapshot.occurrences[index].offset
        for (const earlier of snapshot.occurrences.slice(0, index)) start -= earlier.length - 1
        if (input.insertText('', { start, end: start + 1, draftRev: snapshot.draftRev }) !== true) return
        quotes.delete(ref)
      }

      /**
       * Reconcile remembered quotes against the composer's live occurrences.
       *
       * The composer owns presence and order; this map only answers "what text
       * sits behind reference X" for the codec. Dropping the entries whose chip
       * is gone keeps `serialize()` from throwing on a reference the user
       * already deleted, and keeps a long session from accumulating dead
       * quote bodies.
       */
      function refreshQuoteRail() {
        const live = new Set(quoteOccurrences(currentInput()).map(occurrence => occurrence.ref))
        for (const ref of [...quotes.keys()]) {
          if (!live.has(ref)) quotes.delete(ref)
        }
      }

      function refreshLocalizedCopy() {
        button.textContent = t('add')
        copy.textContent = t('copy')
        action.setAttribute('aria-label', t('toolbarLabel'))
      }

      /**
       * Append the selection to the composer as one visible reference chip.
       *
       * The chip is the single source of truth for presence and order: the
       * editor deletes it whole on Backspace, and the codec below expands it
       * to model text at send time. The quote body is only remembered so the
       * codec can answer, and it is dropped again if the editor refuses the
       * span (a stale revision, or a phase that rejects edits).
       */
      function addToDraft() {
        const input = currentInput()
        if (input === undefined || selectedText === '') return
        const snapshot = input.state.getSnapshot()
        const ref = referenceId()
        const quote = { ref, text: selectedText, label: compactLabel(selectedText, t), range: selectedRange }
        quotes.set(ref, quote)
        const end = detectEnd(snapshot)
        const inserted = input.insertReference({
          source: QUOTE_SOURCE,
          ref,
          label: quote.label,
          appearance: 'session',
          clipboardText: quote.label,
        }, { start: end, end, draftRev: snapshot.draftRev })
        if (inserted !== true) {
          quotes.delete(ref)
          return
        }
        window.getSelection()?.removeAllRanges()
        hideAction()
        refreshQuoteRail()
      }

      /**
       * Copy the live selection to the clipboard.
       *
       * Reads the selection at click time rather than the cached
       * `selectedText`, because the bar neutralises mousedown precisely so
       * the DOM selection survives until the click lands. Falls back to a
       * detached textarea when the async Clipboard API is refused (a
       * non-secure context, or a denied permission).
       */
      function copySelection() {
        const text = window.getSelection()?.toString() || selectedText
        if (text === '') return
        const done = () => {
          copy.textContent = t('copied')
          setTimeout(() => { copy.textContent = t('copy') }, 1200)
        }
        // `window.navigator` first: the browser-scope object is the reliable
        // one, while `globalThis` depends on how the bundle is evaluated.
        const clipboard = window.navigator?.clipboard ?? globalThis.navigator?.clipboard
        if (clipboard?.writeText !== undefined) {
          clipboard.writeText(text).then(done, () => legacyCopy(text, done))
          return
        }
        legacyCopy(text, done)
      }

      /** Hidden-textarea copy for runtimes without an async clipboard. */
      function legacyCopy(text, done) {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        try { document.execCommand('copy') } catch { /* refused: still reset the label */ }
        area.remove()
        done()
      }

      const onPointerDown = event => {
        if (!action.contains(event.target)) hideAction()
      }
      const onKeyDown = event => {
        if (event.key === 'Escape') hideAction()
      }
      const onViewportChange = () => {
        hideAction()
      }

      /**
       * Follow the selected session's input state. The rail is a projection of
       * that state, so the subscription has to move with the session rather
       * than the plugin holding its own copy of what is in the draft.
       */
      function observeCurrentInput() {
        const input = currentInput()
        if (input === observedInput) return
        inputOff?.()
        observedInput = input
        inputOff = input?.state.subscribe(refreshQuoteRail) || null
        refreshQuoteRail()
      }
      /**
       * Reference source owning this plugin's chips.
       *
       * It never contributes menu candidates: the '@' menu is not how a quote
       * is created, the selection toolbar is. Registration exists so the
       * composer can route a chip back here at send time, which `codec`
       * answers — `serialize` produces the model text and `clipboardText`
       * the copy/persistence projection.
       */
      const source = {
        trigger: '@',
        name: QUOTE_SOURCE,
        candidates: async () => [],
        onPick: () => undefined,
        codec: {
          clipboardText: ref => quotes.get(ref)?.label || '',
          serialize: async ref => {
            const quote = quotes.get(ref)
            if (quote === undefined) throw new Error('assistant quote is no longer available')
            // The FULL quote body goes inside the quoted token, not after it.
            // projectUserText() turns `@"…"` into one chip and renders the
            // quote's own text as that chip's label; anything placed *outside*
            // the quotes becomes an extra plain run — exactly the "quote spills
            // out under the bubble" defect this avoids.
            // The chip is truncated to a pill by CSS (inline-block + max-width
            // + ellipsis), while the model still receives the whole passage,
            // because the token text IS the model text.
            // `quote.label` is the same single-line text the composer chip
            // shows, so both surfaces stay in step.
            // The LEADING SPACE is load-bearing. The scanner regex is
            // /(^|\s)(...|@"[^"\n]+"|...)/gu, and that `(^|\s)` group is
            // mandatory: a token glued straight onto the preceding character
            // is never recognised, and the whole quote then spills as plain
            // text with its literal `@"` and closing `"` visible. A chip
            // inserted immediately after a word has no separator of its own,
            // so emit one. `\s` also covers the message-start case.
            return ` @"${quote.label}"`
          },
        },
      }
      ctx.effect(() => ctx.inputTriggers.registerSource(source), 'dsh-cite-inline: quote serializer')
      button.addEventListener('click', addToDraft)
      copy.addEventListener('click', copySelection)
      // Clicking the bar must not collapse the live selection: both actions
      // re-read `window.getSelection()` when they run.
      action.addEventListener('mousedown', event => { event.preventDefault() })
      document.addEventListener('selectionchange', updateAction)
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('resize', onViewportChange)
      window.addEventListener('scroll', onViewportChange, true)
      const sessionsOff = ctx.sessions.list.subscribe(observeCurrentInput)
      const localeOff = ctx.locale.subscribe(refreshLocalizedCopy)
      // ── sidebar session-menu row: copy the session's native id ───────────
      // Rides stock DSH's public roster slot. The workspace browser renders
      // every registrant into each session's ⋯ menu, the parent slot injects
      // `useMenuOpenState` (how a row closes that menu), and MenuItemButton
      // supplies the official row material — label, icon column, hover, dark
      // theme — so this plugin owns no menu CSS at all.
      //
      // Guarded end to end on purpose. A menu row is a convenience: it must
      // never break the composer feature, and above all it must never let
      // apply() throw. A throwing client entry is exactly what drives DSH into
      // its boot-failure recovery, whose "disable all plugins" path rewrites
      // package.json's bundles down to the two core entries and loses the
      // whole profile.
      try {
        const slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined
        if (slots !== undefined && typeof slots.inject === 'function' && typeof slots.register === 'function' && typeof require === 'function') {
          const React = require('react')
          const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
          const writeClipboard = primitives.writeClipboard
          const MenuItemButton = primitives.MenuItemButton
          const IconCopy = primitives.IconCopyOutlineRegular
          if (typeof writeClipboard === 'function' && MenuItemButton !== undefined && IconCopy !== undefined) {
            const CopySessionIdRow = props => {
              const [copied, setCopied] = React.useState(false)
              const t = typeof props.t === 'function' ? props.t : key => key
              // The parent slot owns the menu; this hook is the only way to
              // close it, and it is absent outside the sidebar's roster.
              const hooks = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : undefined
              const setMenuOpen = Array.isArray(hooks) ? hooks[1] : undefined
              const closeMenu = () => { if (typeof setMenuOpen === 'function') setMenuOpen(false) }
              // Hold the menu open briefly so the confirmation is readable,
              // then close — the same shape the official rename row uses.
              React.useEffect(() => {
                if (!copied) return undefined
                const timer = setTimeout(closeMenu, 900)
                return () => { clearTimeout(timer) }
              }, [copied])
              const onSelect = () => {
                if (copied) return
                const settle = ok => { if (ok === true) setCopied(true); else closeMenu() }
                let result
                try {
                  result = writeClipboard(String(props.sessionId))
                } catch (error) {
                  console.warn('[dsh-cite-inline] copy session id failed:', error)
                  closeMenu()
                  return
                }
                if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
                  result.then(settle, closeMenu)
                  return
                }
                settle(result)
              }
              return React.createElement(MenuItemButton, {
                icon: React.createElement(IconCopy, {}),
                onSelect,
              }, t(copied ? 'menuCopied' : 'menuCopySessionId'))
            }
            ctx.effect(() => slots.inject(SESSION_MENU_SLOT, () => slots.register({
              name: SESSION_MENU_SLOT,
              id: 'dsh-cite-inline-copy-session-id',
              order: 250,
              locale: LOCALE_NS,
              inject: () => ({}),
            }, CopySessionIdRow)), 'dsh-cite-inline: session menu row')
          }
        }
      } catch (error) {
        console.warn('[dsh-cite-inline] session menu row unavailable:', error)
      }
      observeCurrentInput()

      return () => {
        button.removeEventListener('click', addToDraft)
        copy.removeEventListener('click', copySelection)
        document.removeEventListener('selectionchange', updateAction)
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', onViewportChange)
        window.removeEventListener('scroll', onViewportChange, true)
        sessionsOff()
        localeOff()
        inputOff?.()
        action.remove()
      }
    }

    return {
      name: PLUGIN_ID,
      inject: ['sessions', 'conversation', 'inputTriggers', 'locale'],
      apply,
    }
  },
})
