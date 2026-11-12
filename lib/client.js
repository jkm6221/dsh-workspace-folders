window.__ModuleLoader__.load({
  id: 'dsh-workspace-folders',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    let ReactDOM
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = undefined
    }

    const ROUTE = '/workspace-folders'
    const HEADER = 'x-dsh-plugin'
    const HEADER_VALUE = 'workspace-folders'

    const COPY = {
      zh: {
        title: '工作区附加文件夹',
        subtitle: '只对当前工作区生效：这些文件夹和本工作区一样可读可写，其他工作区看不到。',
        add: '添加文件夹',
        empty: '还没有附加文件夹。',
        remove: '移除',
        close: '关闭',
        missing: '已丢失',
        button: '附加文件夹',
        failed: '操作失败',
        loading: '加载中…',
        pickerUnavailable: '当前环境无法打开文件夹选择器，请在输入框使用 /folders add <路径>。'
      },
      en: {
        title: 'Workspace folders',
        subtitle: 'This workspace only: the folders are readable and writable here, and other workspaces do not see them.',
        add: 'Add folder',
        empty: 'No extra folders attached yet.',
        remove: 'Remove',
        close: 'Close',
        missing: 'missing',
        button: 'Workspace folders',
        failed: 'Action failed',
        loading: 'Loading…',
        pickerUnavailable: 'The folder picker is unavailable here; use /folders add <path> in the composer.'
      }
    }

    /** The plugin context captured in `apply`, so components can reach Client services lazily. */
    let pluginContext
    /** Read the active locale id from the Client locale service, defaulting to Chinese. */
    function currentCopy() {
      try {
        const id = pluginContext?.get?.('locale')?.getLocale?.()?.id
        return COPY[typeof id === 'string' && id.startsWith('zh') ? 'zh' : 'en'] ?? COPY.zh
      } catch {
        return COPY.zh
      }
    }

    /** POST one JSON payload to the loopback route the Host half registered. */
    async function callRoute(endpoint, payload) {
      if (typeof location === 'undefined') throw new Error('the workspace route needs the browser GUI')
      const url = new URL(`${ROUTE}/${endpoint}`, location.href).toString()
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [HEADER]: HEADER_VALUE },
        body: JSON.stringify(payload ?? {})
      })
      const text = await response.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(text === '' ? `HTTP ${response.status}` : text)
      }
      if (!response.ok || typeof data?.error === 'string') throw new Error(data?.error ?? `HTTP ${response.status}`)
      return data
    }

    const styles = {
      button: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '28px',
        padding: '0 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '1',
        cursor: 'pointer'
      },
      count: {
        minWidth: '16px',
        height: '16px',
        padding: '0 4px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '11px',
        lineHeight: '16px',
        textAlign: 'center'
      },
      backdrop: {
        position: 'fixed',
        inset: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent)',
        zIndex: 60
      },
      panel: {
        width: 'min(520px, calc(100vw - 32px))',
        maxHeight: 'min(70vh, 560px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        borderRadius: '14px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-overlay)',
        boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '13px'
      },
      header: { display: 'flex', alignItems: 'baseline', gap: '8px' },
      title: { fontSize: '14px', fontWeight: 600, flex: '1 1 auto' },
      close: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        fontSize: '16px',
        lineHeight: '16px',
        padding: '2px 6px',
        borderRadius: '6px'
      },
      subtitle: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '1.5' },
      workspace: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        direction: 'ltr'
      },
      list: { display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', minHeight: '40px' },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '7px 9px',
        borderRadius: '9px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)'
      },
      path: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'ltr' },
      remove: {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        borderRadius: '7px',
        padding: '2px 8px',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px'
      },
      add: {
        alignSelf: 'flex-start',
        border: '1px solid var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-brand-primary)',
        background: 'transparent',
        borderRadius: '8px',
        padding: '6px 12px',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px'
      },
      empty: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', padding: '8px 2px' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '1.5' },
      missing: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: '11px' }
    }

    function FolderGlyph() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true
      }, h('path', {
        d: 'M1.5 3.75c0-.41.34-.75.75-.75h3.19c.2 0 .39.08.53.22l1.03 1.03h6.25c.41 0 .75.34.75.75v7.25c0 .41-.34.75-.75.75h-11a.75.75 0 0 1-.75-.75V3.75Z',
        stroke: 'currentColor',
        strokeWidth: 1.2
      }), h('path', { d: 'M8 7.25v4M6 9.25h4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))
    }

    function FolderDialog({ sessionId, onClose }) {
      const copy = currentCopy()
      const [folders, setFolders] = React.useState([])
      const [missing, setMissing] = React.useState([])
      const [workspace, setWorkspace] = React.useState('')
      const [busy, setBusy] = React.useState(true)
      const [error, setError] = React.useState('')

      const refresh = React.useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const data = await callRoute('list', { sessionId })
          setFolders(Array.isArray(data?.folders) ? data.folders : [])
          setMissing(Array.isArray(data?.missing) ? data.missing : [])
          setWorkspace(typeof data?.workspace === 'string' ? data.workspace : '')
        } catch (failure) {
          setError(`${copy.failed}: ${String(failure?.message ?? failure)}`)
        } finally {
          setBusy(false)
        }
      }, [sessionId])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      const add = async () => {
        setError('')
        const ui = pluginContext?.get?.('uiWorkspace')
        if (typeof ui?.pickDirectory !== 'function') {
          setError(copy.pickerUnavailable)
          return
        }
        let picked
        try {
          picked = await ui.pickDirectory()
        } catch (failure) {
          setError(`${copy.failed}: ${String(failure?.message ?? failure)}`)
          return
        }
        if (typeof picked !== 'string' || picked === '') return
        setBusy(true)
        try {
          await callRoute('add', { sessionId, path: picked })
        } catch (failure) {
          setError(`${copy.failed}: ${String(failure?.message ?? failure)}`)
        } finally {
          setBusy(false)
          await refresh()
        }
      }

      const remove = async (folder) => {
        setError('')
        setBusy(true)
        try {
          await callRoute('remove', { sessionId, path: folder })
        } catch (failure) {
          setError(`${copy.failed}: ${String(failure?.message ?? failure)}`)
        } finally {
          setBusy(false)
          await refresh()
        }
      }

      const dialog = h('div', {
        style: styles.backdrop,
        role: 'presentation',
        onClick: (event) => {
          if (event.target === event.currentTarget) onClose()
        }
      }, h('div', {
        style: styles.panel,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': copy.title
      }, [
        h('div', { key: 'header', style: styles.header }, [
          h('span', { key: 'title', style: styles.title }, copy.title),
          h('button', { key: 'close', type: 'button', style: styles.close, 'aria-label': copy.close, onClick: onClose }, '×')
        ]),
        h('div', { key: 'subtitle', style: styles.subtitle }, copy.subtitle),
        workspace === '' ? null : h('div', { key: 'workspace', style: styles.workspace, title: workspace }, workspace),
        h('div', { key: 'list', style: styles.list },
          folders.length === 0
            ? h('div', { style: styles.empty }, busy ? copy.loading : copy.empty)
            : folders.map((folder) => h('div', { key: folder, style: styles.row }, [
              h('span', { key: 'path', style: styles.path, title: folder }, folder),
              missing.includes(folder) ? h('span', { key: 'missing', style: styles.missing }, copy.missing) : null,
              h('button', {
                key: 'remove',
                type: 'button',
                style: styles.remove,
                disabled: busy,
                onClick: () => {
                  void remove(folder)
                }
              }, copy.remove)
            ]))),
        error === '' ? null : h('div', { key: 'error', style: styles.error }, error),
        h('button', {
          key: 'add',
          type: 'button',
          style: styles.add,
          disabled: busy,
          onClick: () => {
            void add()
          }
        }, copy.add)
      ]))

      if (ReactDOM?.createPortal !== undefined && typeof document !== 'undefined') {
        return ReactDOM.createPortal(dialog, document.body)
      }
      return dialog
    }

    function WorkspaceFoldersControl(props) {
      const copy = currentCopy()
      const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : ''
      const [open, setOpen] = React.useState(false)
      const [count, setCount] = React.useState(0)

      React.useEffect(() => {
        if (sessionId === '') return undefined
        let alive = true
        callRoute('list', { sessionId })
          .then((data) => {
            if (alive) setCount(Array.isArray(data?.folders) ? data.folders.length : 0)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [sessionId])

      const close = React.useCallback(() => {
        setOpen(false)
        if (sessionId === '') return
        callRoute('list', { sessionId })
          .then((data) => setCount(Array.isArray(data?.folders) ? data.folders.length : 0))
          .catch(() => {})
      }, [sessionId])

      return h(React.Fragment, null, [
        h('button', {
          key: 'trigger',
          type: 'button',
          title: copy.button,
          'aria-label': copy.button,
          'aria-expanded': open,
          style: styles.button,
          onClick: () => setOpen((value) => !value)
        }, [h(FolderGlyph, { key: 'glyph' }), h('span', { key: 'count', style: styles.count }, String(count))]),
        open ? h(FolderDialog, { key: 'dialog', sessionId, onClose: close }) : null
      ])
    }

    /** A failing control must cost only its own button, never the composer row around it. */
    class ControlBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        console.error('workspace-folders: composer control failed', error)
      }
      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    function GuardedControl(props) {
      return h(ControlBoundary, null, h(WorkspaceFoldersControl, props))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        pluginContext = ctx
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'workspace-folders',
          order: 30
        }, GuardedControl))
      }
    }
  }
})
