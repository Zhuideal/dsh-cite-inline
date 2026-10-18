// End-to-end: take what codec.serialize() now produces and run it through the
// REAL projectUserText() lifted from DSH's ui-primitives bundle. Asserts the
// user-visible outcome: exactly one chip, and NO leftover plain text.
//
// The bundle is read straight out of the installed asar (with a tiny inline
// reader) instead of a cached extract, so this test has no scratch-directory
// dependency and cannot silently go stale against a different DSH build.
import { readFile } from 'node:fs/promises'
import { existsSync, openSync, readSync, closeSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

/** asar header layout: [0] pickle size, [1] header-aligned, [2] json aligned, [3] json size. */
function readFromAsar(asarPath, relPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const head = Buffer.allocUnsafe(16)
    readSync(fd, head, 0, 16, 0)
    const jsonSize = head.readUInt32LE(12)
    const jsonBuf = Buffer.allocUnsafe(jsonSize)
    readSync(fd, jsonBuf, 0, jsonSize, 16)
    const header = JSON.parse(jsonBuf.toString('utf8'))
    const parts = relPath.replace(/^\//, '').split('/')
    let node = header
    for (const part of parts) {
      node = node?.files?.[part]
      if (node === undefined) throw new Error('not in asar: ' + relPath)
    }
    const size = Number(node.size)
    const buf = Buffer.allocUnsafe(size)
    readSync(fd, buf, 0, size, 16 + jsonSize + Number(node.offset))
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

const ASAR_CANDIDATES = [
  process.env.DSH_ASAR,
  'D:/Program/DeepSeek Harness/resources/app.asar',
  'D:/Program/DSH Desktop/resources/app.asar',
  'C:/Program Files/DeepSeek Harness/resources/app.asar',
  'E:/program files/DeepSeek Harness/resources/app.asar',
].filter(Boolean)

const PRIMITIVES_REL = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'

// Newer desktop builds keep the client UI packages in the profile's
// node_modules instead of inside app.asar (the asar only carries the host
// half). Fall back to that copy rather than failing the whole suite: the code
// under test — projectUserText — is the same file either way.
const PROFILE_PRIMITIVES = [
  process.env.DSH_PRIMITIVES,
  'C:/Users/<user>/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js',
  'C:/Users/<user>/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js',
].filter(Boolean)

let src
let srcLabel
for (const candidate of ASAR_CANDIDATES) {
  if (!existsSync(candidate)) continue
  try {
    src = readFromAsar(candidate, PRIMITIVES_REL)
    srcLabel = candidate
    break
  } catch {
    // asar present but without the client packages — try the next source.
  }
}
if (src === undefined) {
  const profile = PROFILE_PRIMITIVES.find(p => existsSync(p))
  if (profile === undefined) {
    throw new Error(
      'DSH ui-primitives not found. Set DSH_ASAR (app.asar) or DSH_PRIMITIVES (lib/index.js). Tried:\n  ' +
        [...ASAR_CANDIDATES, ...PROFILE_PRIMITIVES].join('\n  '),
    )
  }
  src = await readFile(profile, 'utf8')
  srcLabel = profile
}
const m = /function projectUserText\b[\s\S]*?\n}\n/m.exec(src)
if (!m) throw new Error('could not lift projectUserText from ' + srcLabel)
console.log('projectUserText lifted from: ' + srcLabel)

const lifted = [
  'const SESSION_WIRE_RE = /@\\[([^\\]\\n]+)\\]\\(dsh-session:[^)\\s]+\\)/gu;',
  'const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？]+$/u;',
  m[0],
].join('\n')

const sandbox = {
  console,
  jsx: (tag, props) => ({ tag, props }),
  jsxs: (tag, props) => ({ tag, props }),
  Fragment: 'Fragment',
  clsx: (...a) => a.filter(Boolean).join(' '),
  css$22: { plainRun: 'p', refChip: 'r', refIcon: 'i', slashChip: 's' },
  markdownCss: { fileMention: 'mf' },
  ReferenceIconRegular: 'ReferenceIconRegular',
}
const module_ = { exports: {} }
sandbox.module = module_
runInNewContext(lifted + '\nmodule.exports = { projectUserText }', sandbox, { filename: 'lift.js' })
const projectUserText = module_.exports.projectUserText

const render = n => {
  if (n === null || n === undefined) return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(render).join('')
  return render(n.props?.children)
}

// The plugin's own label normalizer, lifted from the built bundle so this test
// exercises the real code path rather than a copy of it.
// CLIENT_JS lets a caller point at an alternative build (used to prove this
// test actually fails when the serialize() separator is removed).
const clientPath = process.env.CLIENT_JS || new URL('../client.js', import.meta.url)
const clientSrc = await readFile(clientPath, 'utf8')
const lm = /function compactLabel\(text, t\) \{[\s\S]*?\n    \}/.exec(clientSrc)
if (!lm) throw new Error('could not lift compactLabel from client.js')
const lab = { exports: {} }
runInNewContext(lm[0] + '\nmodule.exports = compactLabel', { module: lab, console }, { filename: 'label.js' })
const compactLabel = lab.exports
const t = key => (key === 'emptyQuote' ? '助手引用' : key)

// The wire form must also come from the bundle, not from a literal here:
// a hardcoded `' @"' + body + '"'` would keep passing even if serialize()
// dropped its leading separator — exactly the regression this test exists for.
const sm = /return `([^`]*)\$\{quote\.label\}([^`]*)`/.exec(clientSrc)
if (!sm) throw new Error('could not lift the serialize() template from client.js')
const wireFor = label => sm[1] + label + sm[2]

const CASES = {
  'short quote': '单次请求体量巨大。',
  'long quote (the real one)': '单次请求体量巨大。每次请求都带 10–20 万 prompt tokens（agent 把全量上下文重发一遍）。哪怕调用次数不多，token 速率也直接爆表。',
  'quote containing an ASCII quote char': 'he said "hello" to me',
  'quote containing a slash': 'see src/client/foo.ts for details',
  'multi-line selection': 'first line\nsecond line\n\nthird',
}

let failures = 0

// Each quote is checked in the shape that actually reaches the bubble: the
// serialized token appended straight after whatever the user had already typed.
// That is the failing case from the screenshots — a chip inserted immediately
// after a word, with no separator of its own. The scanner's `(^|\s)` group is
// mandatory, so the token must carry its own leading separator.
const PREFIXES = {
  'at message start': '',
  'after a CJK word (the reported bug)': '删掉这个重复的东西',
  'after an ASCII word': 'word',
  'after a full-width comma': '内容，',
  'after a newline': '前一段\n',
}

for (const [name, raw] of Object.entries(CASES)) {
  // Exactly what the plugin does: normalize, then wrap as the sent token.
  const body = compactLabel(raw, t)
  // Mirror serialize(): the leading separator is part of the wire form, and it
  // is lifted from the bundle so a regression in serialize() fails this test.
  const token = wireFor(body)

  for (const [prefixName, prefix] of Object.entries(PREFIXES)) {
    const wire = prefix + token
    const out = projectUserText(wire, [], [], 'skill', undefined)

    const flat = []
    const walk = n => {
      if (n === null || n === undefined) return
      if (Array.isArray(n)) { n.forEach(walk); return }
      if (n.tag !== undefined) flat.push(n)
      if (n.props?.children) walk(n.props.children)
    }
    walk(out)

    const chips = flat.filter(n => n.props?.['data-chip'] !== undefined || n.props?.['data-ref-chip'] !== undefined)
    // Only the plain runs that come AFTER the prefix count as spill.
    const visiblePlain = flat
      .filter(n => n.props?.className === 'p')
      .map(render)
      .filter(t => t.trim() !== '' && !prefix.includes(t.trim()) && t.trim() !== prefix.trim())

    const chipText = chips.map(render).join('')
    // The chip must show the normalized body verbatim, and nothing may spill.
    const ok = chips.length === 1 && visiblePlain.length === 0 && chipText === body
    if (!ok) failures += 1

    console.log((ok ? 'ok   ' : 'FAIL ') + name + ' — ' + prefixName)
    console.log('       raw   =' + JSON.stringify(raw).slice(0, 100))
    console.log('       label =' + JSON.stringify(body).slice(0, 100))
    console.log('       chips=' + chips.length + '  leftover plain runs=' + visiblePlain.length)
    console.log('       chip kind=' + (chips[0]?.props?.['data-ref-chip'] ?? '-') + '  chip text=' + JSON.stringify(chipText).slice(0, 90))
    if (visiblePlain.length > 0) console.log('       SPILLED: ' + JSON.stringify(visiblePlain.join('')).slice(0, 120))
    if (chipText !== body) console.log('       MISMATCH: chip text differs from the normalized label')
  }
}

console.log('\n' + (failures === 0 ? 'all rendered as a single chip, nothing spilled' : failures + ' case(s) failed'))
process.exit(failures === 0 ? 0 : 1)
