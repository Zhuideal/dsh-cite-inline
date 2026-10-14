/**
 * Host half of dsh-cite-inline.
 *
 * The plugin is a pure browser-side client plugin: its behavior lives entirely
 * in `client.js`, reached through the `dsh.client` declaration in
 * `package.json`. This half only has to exist so the Loader can mount the
 * package as an ordinary entry — the `dsh.client` scan needs a live Loader row
 * to find the bundle that declares it.
 *
 * It also drops a load marker under the DSH home. That file is the only way to
 * answer "did the Host actually mount this plugin?" from outside the app: the
 * browser half is invisible to the filesystem, and the Host side is otherwise a
 * no-op. `@hytime/dsh-thinking-effort` uses the same pattern.
 *
 * @module dsh-cite-inline
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Cordis plugin name; must match the `cordis.patch.yml` insert id. */
export const name = 'dsh-cite-inline'

/** DSH home, matching how the Host resolves it. */
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

/**
 * Record that the Host applied this plugin.
 *
 * Best effort on purpose: a read-only or missing DSH home must never stop the
 * plugin from mounting, because the marker is diagnostics rather than function.
 *
 * @param event - lifecycle event name.
 */
function mark(event) {
  try {
    writeFileSync(
      join(DSH_HOME, 'cite-inline-loaded.json'),
      JSON.stringify({ event, name, at: new Date().toISOString(), pid: process.pid }, void 0, 2),
      'utf8',
    )
  } catch {
    // Diagnostics only; never fail the mount over a marker file.
  }
}

/**
 * Mount the plugin.
 *
 * There is no Host capability to register, no service to provide, and no
 * settings namespace to own: every behavior is DOM-side. Adding Host state here
 * would make a browser feature depend on the Host runtime for no reason.
 */
export function apply() {
  mark('apply')
}

export default { name, apply }