/**
 * Host half of `dsh-workspace-folders` — attach extra folders to a workspace.
 *
 * One durable list of folders lives in `$DSH_HOME/workspace-folders.json`.
 * Every resolved workspace-write policy also grants those folders as extra
 * writable roots, which is the only place the file sandbox and the process
 * sandbox both read, so `read`/`write`/`edit`/`bash` accept them exactly like
 * the session workspace. The model sees the same list through a runtime-context
 * note and through the `workspace_folders` tool; the human gets a `/folders`
 * command and the composer control in `./client.js` (which talks to the small
 * loopback JSON route registered below).
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
/** Bound on a request body; the route only carries one path string. */
const MAX_BODY_BYTES = 64 * 1024

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
 * The durable folder list plus its write path. Reads happen synchronously on
 * load so the sandbox grant is correct before the first confined call.
 * @param ctx - plugin context, used for warnings only.
 */
function createStore(ctx) {
  const file = join(homeDirectory(), 'workspace-folders.json')
  let folders = read()

  function read() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.folders) ? parsed.folders : []
      return list.filter((entry) => typeof entry === 'string' && entry !== '')
    } catch (error) {
      if (error?.code !== 'ENOENT') ctx.logger?.warn?.(`workspace-folders: cannot read ${file}: ${String(error)}`)
      return []
    }
  }

  async function persist() {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 1, folders }, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }

  return {
    /** Every stored folder, in attach order. */
    list: () => [...folders],
    /** Stored folders that still exist on disk — the only ones granted to the sandbox. */
    existing: () => folders.filter(isDirectory),
    /** Attach one existing directory; returns the canonical path that was added. */
    async add(target, base) {
      const canonical = canonicalDirectory(toAbsolute(target, base))
      if (folders.includes(canonical)) return { added: undefined, canonical }
      folders = [...folders, canonical]
      await persist()
      return { added: canonical, canonical }
    },
    /** Detach one folder, matching by canonical identity and falling back to the stored spelling. */
    async remove(target, base) {
      const absolute = toAbsolute(target, base)
      let canonical = absolute
      try {
        canonical = realpathSync(absolute)
      } catch {
        // A folder that is already gone still removes by its stored path.
      }
      const index = folders.indexOf(canonical) !== -1 ? folders.indexOf(canonical) : folders.indexOf(absolute)
      if (index === -1) throw new Error(`Not an attached folder: ${target}`)
      folders = folders.filter((_, position) => position !== index)
      await persist()
      return { removed: canonical }
    },
    /** Stored folders whose directory vanished, for display only. */
    missing: () => folders.filter((entry) => !isDirectory(entry)),
    stateFile: file
  }
}

/** Model-facing output for every action. */
function summarize(store, message) {
  const folders = store.list()
  return { folders, missing: store.missing(), message: message ?? (folders.length === 0 ? 'No extra folders are attached to this workspace.' : `${folders.length} extra folder(s) attached to this workspace.`) }
}

/** The `workspace_folders` tool: list / add / remove. */
function registerTool(ctx, store) {
  const baseDirectory = (exec) => {
    if (exec.agent === undefined) return process.cwd()
    const working = ctx.get('workingDirectory')
    if (working === undefined) return process.cwd()
    try {
      return working.get(exec.agent.session)
    } catch {
      return process.cwd()
    }
  }

  ctx.tools.register({
    name: 'workspace_folders',
    description: 'List, add, or remove the extra folders attached to this workspace. An attached folder is writable by the file tools and the shell exactly like the session workspace, and it stays attached across sessions until removed. Use action "list" first when you are unsure what is attached.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'remove'],
          description: 'list the attached folders, add one folder by path, or remove one folder by path.'
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
          folders: {
            type: 'array',
            items: { type: 'string' },
            description: 'Attached folders after the action, in attach order.'
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
        required: ['folders', 'missing', 'message']
      },
      render(_args, value) {
        const lines = [value.message]
        if (value.folders.length > 0) lines.push(...value.folders.map((folder) => `- ${folder}`))
        if (value.missing.length > 0) lines.push(`Missing on disk: ${value.missing.join(', ')}`)
        return [{ type: 'text', text: lines.join('\n') }]
      }
    },
    async execute(args, exec) {
      if (args.action === 'list') return summarize(store)
      const target = typeof args.path === 'string' ? args.path.trim() : ''
      if (target === '') throw new Error(`path is required for action "${args.action}"`)
      const base = baseDirectory(exec)
      if (args.action === 'add') {
        const { added, canonical } = await store.add(target, base)
        return summarize(store, added === undefined
          ? `Already attached: ${canonical}`
          : `Attached ${added}; it is now writable like the session workspace.`)
      }
      const { removed } = await store.remove(target, base)
      return summarize(store, `Removed ${removed}; it is no longer writable.`)
    }
  })
}

/** A short runtime-context note so the model knows these are intentional project folders, not stray writable paths. */
function registerContext(ctx, store) {
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'workspace:folders',
      order: 45,
      text: () => {
        const folders = store.existing()
        if (folders.length === 0) return ''
        return `Workspace extra folders attached by the user: ${JSON.stringify(folders)}. Treat them as additional project roots of this workspace: the file tools and the shell may read and modify them under workspace-write. Use the workspace_folders tool to list, add, or remove them.`
      }
    })
  })
}

/** `/folders [list | add <path> | remove <path>]` — the human surface. */
function registerCommand(ctx, store) {
  const describe = (store) => {
    const folders = store.list()
    const missing = store.missing()
    if (folders.length === 0) return '工作区还没有附加文件夹。用法：/folders add <路径>'
    const lines = [`工作区附加文件夹（${folders.length}）：`, ...folders.map((folder) => `· ${folder}`)]
    if (missing.length > 0) lines.push(`已丢失：${missing.join(', ')}`)
    return lines.join('\n')
  }

  ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      name: 'folders',
      description: '管理工作区的附加文件夹 / manage extra workspace folders',
      input: { hint: '[list | add <path> | remove <path>]' },
      async handler({ agent, rawInput }) {
        const base = (() => {
          const working = ctx.get('workingDirectory')
          if (working === undefined || agent === undefined) return process.cwd()
          try {
            return working.get(agent.session)
          } catch {
            return process.cwd()
          }
        })()
        const [verb = 'list', ...rest] = rawInput.trim().split(/\s+/)
        const argument = rest.join(' ').trim()
        try {
          if (verb === '' || verb === 'list') return { kind: 'success', text: describe(store) }
          if (verb === 'add') {
            if (argument === '') return { kind: 'error', text: '用法：/folders add <路径>' }
            const { added, canonical } = await store.add(argument, base)
            return { kind: 'success', text: added === undefined ? `已经附加过：${canonical}` : `已附加：${added}\n${describe(store)}` }
          }
          if (verb === 'remove') {
            if (argument === '') return { kind: 'error', text: '用法：/folders remove <路径>' }
            const { removed } = await store.remove(argument, base)
            return { kind: 'success', text: `已移除：${removed}\n${describe(store)}` }
          }
          return { kind: 'error', text: '用法：/folders [list | add <路径> | remove <路径>]' }
        } catch (error) {
          return { kind: 'error', text: String(error?.message ?? error) }
        }
      }
    })
  })
}

/**
 * Extend the shared sandbox policy: `resolve()` reads `additionalWritableRoots`
 * on every confined call, so a getter over the stored list grants the folders
 * without touching the persisted profile configuration. Missing directories are
 * filtered here, so a folder deleted from disk can never make the sandbox throw.
 */
function installPolicyGrant(policy, listExisting) {
  if (policy === null || typeof policy !== 'object' || !Object.hasOwn(policy, 'additionalWritableRoots')) return
  const descriptor = Object.getOwnPropertyDescriptor(policy, 'additionalWritableRoots')
  if (descriptor === undefined) return
  const previousGetter = descriptor.get
  const getter = function additionalWritableRootsWithFolders() {
    const base = previousGetter === undefined ? descriptor.value : previousGetter.call(policy)
    const configured = Array.isArray(base) ? base : []
    const extras = listExisting().filter((folder) => !configured.includes(folder))
    if (extras.length === 0) return previousGetter === undefined ? descriptor.value : configured
    return Object.freeze([...new Set([...configured, ...extras])])
  }
  Object.defineProperty(policy, 'additionalWritableRoots', {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get: getter
  })
  return () => {
    const current = Object.getOwnPropertyDescriptor(policy, 'additionalWritableRoots')
    if (current?.get !== getter) return
    Object.defineProperty(policy, 'additionalWritableRoots', descriptor)
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

/** The loopback JSON route behind the composer control. */
function registerRoute(ctx, store) {
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
            if (endpoint === 'session-url') {
              const connection = ctx.get('connection')
              const server = ctx.get('webServer')
              const origin = server === undefined ? undefined : `${server.protocol}//127.0.0.1:${String(server.port)}`
              if (connection === undefined || origin === undefined) {
                sendJson(response, 503, { error: 'connection is not available' })
                return
              }
              sendJson(response, 200, { url: connection.authenticatedUrl(origin) })
              return
            }
            if (endpoint === 'list') {
              sendJson(response, 200, summarize(store))
              return
            }
            if (endpoint === 'add' || endpoint === 'remove') {
              const target = typeof payload?.path === 'string' ? payload.path.trim() : ''
              if (target === '') {
                sendJson(response, 400, { error: 'path is required' })
                return
              }
              const result = endpoint === 'add'
                ? await store.add(target, process.cwd())
                : await store.remove(target, process.cwd())
              sendJson(response, 200, { ...summarize(store), ...result })
              return
            }
            sendJson(response, 404, { error: 'unknown endpoint' })
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
  registerTool(ctx, store)
  registerContext(ctx, store)
  registerCommand(ctx, store)
  registerRoute(ctx, store)
  ctx.inject(['sandboxPolicy'], (scope) => {
    scope.effect(() => installPolicyGrant(scope.sandboxPolicy, () => store.existing()))
  })
  ctx.logger?.info?.(`workspace-folders: ${store.list().length} extra folder(s) attached (${store.stateFile})`)
}
