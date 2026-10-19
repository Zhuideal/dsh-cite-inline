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
import { homedir } from 'node:os'
import { join } from 'node:path'

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

// Where a DSH desktop install may keep its asar. Nothing here is a literal
// install path: DSH's installer lets the user choose the location (this plugin
// was developed against one on a non-system drive), so a baked-in list of
// guessed folders would pass on the author's machine and SKIP on everyone
// else's — and would publish that machine's layout for no benefit.
//
// Resolution order:
//   1. DSH_ASAR, an explicit override;
//   2. the folders the OS itself reports (LOCALAPPDATA / ProgramFiles / …);
//   3. a bounded scan of the usual install folders on each fixed drive;
//   4. the profile copies newer builds use (see PROFILE_PRIMITIVES below).
const APP_NAMES = ['DeepSeek Harness', 'DSH Desktop']
const ASAR_REL = join('resources', 'app.asar')
// Windows paths are case-insensitive, so `Program Files` also matches
// `program files` — no lowercase duplicates needed.
const DRIVE_FOLDERS = ['Program Files', 'Program Files (x86)', 'Program', 'Programs', 'Apps', '']

function envCandidates() {
  const bases = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env['ProgramFiles(x86)'],
  ].filter(Boolean)
  return bases.flatMap(base => APP_NAMES.map(name => join(base, name, ASAR_REL)))
}

function* driveCandidates() {
  if (process.platform !== 'win32') return
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const drive = String.fromCharCode(code) + ':\\'
    if (!existsSync(drive)) continue
    for (const folder of DRIVE_FOLDERS) {
      for (const name of APP_NAMES) yield join(drive, folder, name, ASAR_REL)
    }
  }
}

// Yields lazily, in resolution order, de-duplicated: a disconnected network
// drive must not be probed at import time when the first candidate already
// answers, so the drive scan only runs after the cheap lookups miss.
function* asarCandidates() {
  const seen = new Set()
  const take = value => {
    if (!value || seen.has(value)) return null
    seen.add(value)
    return value
  }
  const direct = take(process.env.DSH_ASAR)
  if (direct) yield direct
  for (const candidate of envCandidates()) {
    const value = take(candidate)
    if (value) yield value
  }
  for (const candidate of driveCandidates()) {
    const value = take(candidate)
    if (value) yield value
  }
}

// Every path this suite would try, for the SKIP message. Only materialised
// when nothing was found, so the expensive scan never delays a passing run.
const allAsarCandidates = () => [...asarCandidates()]

const PRIMITIVES_REL = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'

// Newer desktop builds keep the client UI packages in the profile's
// node_modules instead of inside app.asar (the asar only carries the host
// half). Fall back to that copy rather than failing the whole suite: the code
// under test — projectUserText — is the same file either way.
//
// Paths are derived from the CURRENT user's home rather than hardcoded: a
// literal `C:/Users/<name>/…` only works on the machine it was written on, and
// leaking someone's account name into a public repo is exactly the kind of
// detail this file must not carry. DSH_HOME is honoured because the Host
// resolves the profile root that way too.
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PRIMITIVES_REL_PATH = 'node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'
const PROFILE_PRIMITIVES = [
  process.env.DSH_PRIMITIVES,
  join(DSH_HOME, 'profiles', PRIMITIVES_REL_PATH),
  join(DSH_HOME, 'profiles', 'desktop', PRIMITIVES_REL_PATH),
].filter(Boolean)

let src
let srcLabel
for (const candidate of asarCandidates()) {
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
    // SKIP, do not fail. ui-primitives is a build-time source this test needs
    // only to lift projectUserText(); on some DSH builds it is compiled into
    // the shell bundle and exists nowhere on disk, so absence says nothing
    // about the plugin being correct. Failing here would report an
    // environment gap as a code defect and make `node --test` red for every
    // contributor on such a build. Point DSH_PRIMITIVES at a real copy to run
    // the assertions.
    console.log(
      'SKIP: DSH ui-primitives source not found, so projectUserText cannot be lifted.\n' +
        '      This is an environment gap, not a failure. Set DSH_PRIMITIVES to\n' +
        '      @deepseek-ai/dsh-client-ui-primitives/lib/index.js to run this suite.\n' +
        '      Tried:\n  ' +
        [...allAsarCandidates(), ...PROFILE_PRIMITIVES].join('\n  '),
    )
    process.exit(0)
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
