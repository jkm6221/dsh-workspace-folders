/**
 * Host half of `dsh-workspace-folders` — attach extra folders to a workspace.
 *
 * The durable state is per workspace: `$DSH_HOME/workspace-folders.json` maps a
 * workspace root (canonical path) to the folders attached to it. Only workspaces
 * registered in `ctx.workspaceRegistry` are addressable — that is what the
 * sidebar lists, and what the workspace context menu opens for. A Session in
 * such a workspace — and only there — resolves the folders as extra writable
 * roots, so `read`/`write`/`edit`/`bash` accept them exactly like the workspace
 * itself. Removing the workspace from the sidebar revokes the grant on the next
 * confined call.
 *
 * The model sees the current workspace's list through a runtime-context note and
 * the `workspace_folders` tool; the human gets one entry in the workspace
 * context menu (the client half) that talks to the small loopback JSON route
 * registered below.
 *
 * @module dsh-workspace-folders
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'

/** Cordis plugin name. */
export const name = 'workspace-folders'

/** The tool registry is the only hard dependency; every other contribution attaches when its service exists. */
export const inject = ['tools']

/** Prefix of the loopback JSON route the client half calls. */
const ROUTE = '/workspace-folders'
/** Every request must carry this header, so a cross-site page cannot post to the route without a CORS preflight. */
const ROUTE_HEADER = 'x-dsh-plugin'
const ROUTE_HEADER_VALUE = 'workspace-folders'
/** Bound on a request body; the route only carries one workspace path. */
const MAX_BODY_BYTES = 64 * 1024
/** State format; version 1 was a single global list and is not migrated. */
const STATE_VERSION = 2

/** The harness home that owns plugin state. */
function homeDirectory() {
  const configured = process.env.DSH_HOME
  return typeof configured === 'string' && configured !== '' ? configured : join(homedir(), '.dsh')
}

/** Whether a path is an existing directory; a deleted or replaced grant must not break every confined call. */
function isDirectory(target) {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** Canonical workspace identity, so a symlinked spelling and the registry's realpath compare equal. */
function workspaceKey(root) {
  try {
    return realpathSync(root)
  } catch {
    return resolvePath(root)
  }
}

/** Expand a leading `~` and resolve a relative path against the caller's base directory. */
function toAbsolute(target, base) {
  const trimmed = target.trim()
  const expanded = trimmed === '~'
    ? homedir()
    : trimmed.startsWith('~/')
      ? join(homedir(), trimmed.slice(2))
      : trimmed
  return isAbsolute(expanded) ? resolvePath(expanded) : resolvePath(base, expanded)
}

/** Canonical directory identity; throws when the target is missing or is not a directory. */
function canonicalDirectory(target) {
  let stats
  try {
    stats = statSync(target)
  } catch {
    throw new Error(`Folder does not exist: ${target}`)
  }
  if (!stats.isDirectory()) throw new Error(`Not a folder: ${target}`)
  return realpathSync(target)
}

/**
 * A Session's workspace is the immutable root it was created in. A Session
 * without one (a bare or agentless call) has no attachable workspace.
 * @param session - Session-shaped object carrying the recorded `header.cwd`.
 * @returns the workspace root, or `undefined`.
 */
function workspaceOf(session) {
  const root = session?.header?.cwd
  return typeof root === 'string' && root !== '' ? root : undefined
}

/**
 * The registered workspaces, keyed canonically, or `undefined` when the
 * registry is not mounted. Only these are addressable by the tool, the route,
 * and the sandbox grant.
 * @param ctx - plugin context.
 */
function registeredWorkspaces(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return undefined
  try {
    return registry.list().map((workspace) => ({
      key: workspaceKey(workspace.path),
      title: typeof workspace.title === 'string' ? workspace.title : workspace.path
    }))
  } catch (error) {
    ctx.logger?.warn?.(`workspace-folders: cannot read the workspace registry: ${String(error)}`)
    return undefined
  }
}

/**
 * Per-workspace folder lists plus their write path. Reads happen synchronously
 * on load so a sandbox grant is correct before the first confined call.
 * @param ctx - plugin context, used for warnings only.
 */
function createStore(ctx) {
  const file = join(homeDirectory(), 'workspace-folders.json')
  let workspaces = read()

  function read() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const source = parsed?.version === STATE_VERSION && typeof parsed?.workspaces === 'object' && parsed.workspaces !== null
        ? parsed.workspaces
        : {}
      const result = {}
      for (const [workspace, list] of Object.entries(source)) {
        if (workspace === '' || !Array.isArray(list)) continue
        const folders = [...new Set(list.filter((entry) => typeof entry === 'string' && entry !== ''))]
        if (folders.length > 0) result[workspace] = folders
      }
      return result
    } catch (error) {
      if (error?.code !== 'ENOENT') ctx.logger?.warn?.(`workspace-folders: cannot read ${file}: ${String(error)}`)
      return {}
    }
  }

  async function persist() {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: STATE_VERSION, workspaces }, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }

  const foldersFor = (workspace) => (Array.isArray(workspaces[workspace]) ? [...workspaces[workspace]] : [])

  return {
    /** Every folder attached to one workspace, in attach order. */
    list: foldersFor,
    /** The workspace's folders that still exist on disk — the only ones granted to the sandbox. */
    existing: (workspace) => foldersFor(workspace).filter(isDirectory),
    /** The workspace's folders whose directory vanished, for display only. */
    missing: (workspace) => foldersFor(workspace).filter((folder) => !isDirectory(folder)),
    /** Attach one existing directory to one workspace; returns the canonical path that was added. */
    async add(workspace, target, base) {
      const canonical = canonicalDirectory(toAbsolute(target, base))
      const current = foldersFor(workspace)
      if (current.includes(canonical)) return { added: undefined, canonical }
      workspaces = { ...workspaces, [workspace]: [...current, canonical] }
      await persist()
      return { added: canonical, canonical }
    },
    /** Detach one folder from one workspace, matching by canonical identity then stored spelling. */
    async remove(workspace, target, base) {
      const absolute = toAbsolute(target, base)
      let canonical = absolute
      try {
        canonical = realpathSync(absolute)
      } catch {
        // A folder that is already gone still removes by its stored path.
      }
      const current = foldersFor(workspace)
      const index = current.indexOf(canonical) !== -1 ? current.indexOf(canonical) : current.indexOf(absolute)
      if (index === -1) throw new Error(`Not an attached folder of this workspace: ${target}`)
      const next = current.filter((_, position) => position !== index)
      const updated = { ...workspaces }
      if (next.length === 0) delete updated[workspace]
      else updated[workspace] = next
      workspaces = updated
      await persist()
      return { removed: canonical }
    },
    /**
     * Drop records of workspaces that left the sidebar registry. Runs before a
     * mutation only: a registry that is momentarily empty must never wipe state.
     * @param registered - canonical keys of the registered workspaces.
     * @returns whether anything was removed.
     */
    prune(registered) {
      const kept = {}
      let changed = false
      for (const [workspace, folders] of Object.entries(workspaces)) {
        if (registered.has(workspace)) kept[workspace] = folders
        else changed = true
      }
      if (changed) workspaces = kept
      return changed
    },
    /** Workspace roots that currently carry folders, for the load log only. */
    workspaceCount: () => Object.keys(workspaces).length,
    stateFile: file
  }
}

/** Model-facing output for every action, scoped to one workspace. */
function summarize(store, workspace, message) {
  const folders = store.list(workspace)
  return {
    workspace,
    folders,
    missing: store.missing(workspace),
    message: message ?? (folders.length === 0
      ? `No extra folders are attached to workspace ${workspace}.`
      : `${folders.length} extra folder(s) attached to workspace ${workspace}.`)
  }
}

/** The `workspace_folders` tool: list / add / remove for the calling Session's workspace. */
function registerTool(ctx, store, grantable) {
  const requireWorkspace = (session) => {
    const root = workspaceOf(session)
    if (root === undefined) throw new Error('workspace_folders needs a Session created in a workspace directory')
    const workspace = workspaceKey(root)
    if (!grantable(workspace)) {
      throw new Error(`This Session's directory (${root}) is not a workspace in the sidebar. Add it as a workspace first, then attach folders from the workspace's context menu.`)
    }
    return workspace
  }
  const baseDirectory = (agent) => {
    const working = ctx.get('workingDirectory')
    if (working === undefined || agent === undefined) return process.cwd()
    try {
      return working.get(agent.session)
    } catch {
      return process.cwd()
    }
  }

  ctx.tools.register({
    name: 'workspace_folders',
    description: 'List, add, or remove the extra folders attached to the calling Session\'s workspace. The attachment belongs to that workspace only: Sessions in other workspaces do not get it. An attached folder is writable by the file tools and the shell exactly like the workspace itself. Use action "list" first when you are unsure what is attached.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'remove'],
          description: 'list the folders attached to this workspace, add one folder by path, or remove one folder by path.'
        },
        path: {
          type: 'string',
          description: 'Existing folder to add, or an attached folder to remove. Absolute, ~-prefixed, or relative to the session directory. Required for add and remove.'
        }
      },
      required: ['action']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspace: {
            type: 'string',
            description: 'Workspace root the reported folders belong to.'
          },
          folders: {
            type: 'array',
            items: { type: 'string' },
            description: 'Folders attached to that workspace after the action, in attach order.'
          },
          missing: {
            type: 'array',
            items: { type: 'string' },
            description: 'Attached folders whose directory no longer exists; they grant nothing until restored.'
          },
          message: {
            type: 'string',
            description: 'One-line outcome.'
          }
        },
        required: ['workspace', 'folders', 'missing', 'message']
      },
      render(_args, value) {
        const lines = [value.message]
        if (value.folders.length > 0) lines.push(...value.folders.map((folder) => `- ${folder}`))
        if (value.missing.length > 0) lines.push(`Missing on disk: ${value.missing.join(', ')}`)
        return [{ type: 'text', text: lines.join('\n') }]
      }
    },
    async execute(args, exec) {
      const workspace = requireWorkspace(exec.agent?.session)
      if (args.action === 'list') return summarize(store, workspace)
      const target = typeof args.path === 'string' ? args.path.trim() : ''
      if (target === '') throw new Error(`path is required for action "${args.action}"`)
      const base = baseDirectory(exec.agent)
      const registered = registeredWorkspaces(ctx)
      if (registered !== undefined) store.prune(new Set(registered.map((entry) => entry.key)))
      if (args.action === 'add') {
        const { added, canonical } = await store.add(workspace, target, base)
        return summarize(store, workspace, added === undefined
          ? `Already attached to this workspace: ${canonical}`
          : `Attached ${added} to this workspace; it is now writable like the workspace itself, and only here.`)
      }
      const { removed } = await store.remove(workspace, target, base)
      return summarize(store, workspace, `Removed ${removed} from this workspace; it is no longer writable.`)
    }
  })
}

/** A runtime-context note listing the current Session's own folders. */
function registerContext(ctx, store, grantable) {
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'workspace:folders',
      order: 45,
      text: (context) => {
        const root = workspaceOf(context.agent?.session)
        if (root === undefined) return ''
        const workspace = workspaceKey(root)
        if (!grantable(workspace)) return ''
        const folders = store.existing(workspace)
        if (folders.length === 0) return ''
        return `Extra folders attached by the user to this workspace (${workspace}): ${JSON.stringify(folders)}. They are additional project roots of this workspace only: the file tools and the shell may read and modify them under workspace-write, and Sessions in other workspaces do not see them. Use the workspace_folders tool to list, add, or remove them.`
      }
    })
  })
}

/**
 * Extend the shared sandbox policy per call: `resolve({ session })` is what the
 * file sandbox and the process sandbox both consume, so wrapping it grants the
 * calling Session's own workspace folders — and only while that workspace is
 * still registered in the sidebar. A deleted workspace revokes the grant on the
 * next confined call; a folder that vanished from disk is filtered out too.
 * @param policy - the mounted `sandboxPolicy` service.
 * @param foldersFor - existing folders for one canonical workspace key.
 */
function installPolicyGrant(policy, foldersFor) {
  if (policy === null || typeof policy !== 'object' || typeof policy.resolve !== 'function') return
  const original = policy.resolve
  const ownDescriptor = Object.getOwnPropertyDescriptor(policy, 'resolve')
  const resolve = function resolveWithWorkspaceFolders(request = {}) {
    const resolved = original.call(this, request)
    const root = workspaceOf(request?.session)
    if (root === undefined) return resolved
    const configured = resolved.additionalWritableRoots ?? []
    const extras = foldersFor(workspaceKey(root)).filter((folder) => !configured.includes(folder))
    if (extras.length === 0) return resolved
    return { ...resolved, additionalWritableRoots: Object.freeze([...configured, ...extras]) }
  }
  policy.resolve = resolve
  return () => {
    if (policy.resolve !== resolve) return
    if (ownDescriptor !== undefined) Object.defineProperty(policy, 'resolve', ownDescriptor)
    else delete policy.resolve
  }
}

/** Read one bounded JSON body from a node request. */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('request body is not JSON'))
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  response.end(body)
}

/** The loopback JSON route behind the workspace context menu entry. */
function registerRoute(ctx, store, grantable) {
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: (request, response) => {
        void (async () => {
          if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'POST only' })
            return
          }
          if (request.headers[ROUTE_HEADER] !== ROUTE_HEADER_VALUE) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
          const endpoint = pathname.slice(ROUTE.length + 1)
          let payload
          try {
            payload = await readJsonBody(request)
          } catch (error) {
            sendJson(response, 400, { error: String(error?.message ?? error) })
            return
          }
          try {
            if (endpoint !== 'list' && endpoint !== 'add' && endpoint !== 'remove') {
              sendJson(response, 404, { error: 'unknown endpoint' })
              return
            }
            if (typeof payload?.workspace !== 'string' || payload.workspace === '') {
              sendJson(response, 400, { error: 'workspace is required' })
              return
            }
            const workspace = workspaceKey(payload.workspace)
            if (!grantable(workspace)) {
              sendJson(response, 409, { error: 'not a workspace in the sidebar' })
              return
            }
            if (endpoint === 'list') {
              sendJson(response, 200, summarize(store, workspace))
              return
            }
            const target = typeof payload?.path === 'string' ? payload.path.trim() : ''
            if (target === '') {
              sendJson(response, 400, { error: 'path is required' })
              return
            }
            const result = endpoint === 'add'
              ? await store.add(workspace, target, workspace)
              : await store.remove(workspace, target, workspace)
            sendJson(response, 200, { ...summarize(store, workspace), ...result })
          } catch (error) {
            sendJson(response, 400, { error: String(error?.message ?? error) })
          }
        })()
      }
    }))
  })
}

/**
 * Register every contribution of the bundle.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  const store = createStore(ctx)

  /** Whether a canonical workspace key is a workspace the sidebar still lists. */
  const grantable = (workspace) => {
    const registered = registeredWorkspaces(ctx)
    if (registered === undefined) return false
    return registered.some((entry) => entry.key === workspace)
  }

  registerTool(ctx, store, grantable)
  registerContext(ctx, store, grantable)
  registerRoute(ctx, store, grantable)
  ctx.inject(['sandboxPolicy'], (scope) => {
    scope.effect(() => installPolicyGrant(scope.sandboxPolicy, (workspace) => (grantable(workspace) ? store.existing(workspace) : [])))
  })
  ctx.logger?.info?.(`workspace-folders: ${store.workspaceCount()} workspace(s) carry attached folders (${store.stateFile})`)
}
