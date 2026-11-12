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
    const NS = 'workspace-folders'
    const HEADER = 'x-dsh-plugin'
    const HEADER_VALUE = 'workspace-folders'
    /** The menu row sits after the shipped "open folder" pair (order 250) and before delete (order 300). */
    const MENU_ORDER = 260
    const ICON_KEY = 'workspace-folders.folder'

    const COPY = {
      zh: {
        menu: '附加文件夹…',
        title: '工作区文件夹',
        subtitle: '只对当前工作区生效，其他工作区看不到这些文件夹。',
        add: '添加文件夹',
        empty: '这个工作区还没有附加文件夹。',
        remove: '移除',
        close: '关闭',
        missing: '已丢失',
        failed: '操作失败',
        loading: '加载中…',
        pickerUnavailable: '当前环境无法打开文件夹选择器。'
      },
      en: {
        menu: 'Attach folders…',
        title: 'Workspace folders',
        subtitle: 'This workspace only; other workspaces do not see these folders.',
        add: 'Add folder',
        empty: 'No extra folders are attached to this workspace yet.',
        remove: 'Remove',
        close: 'Close',
        missing: 'missing',
        failed: 'Action failed',
        loading: 'Loading…',
        pickerUnavailable: 'The folder picker is unavailable here.'
      }
    }

    /** The plugin context captured in `apply`, so components can reach Client services lazily. */
    let pluginContext
    let registeredLocale = false

    function currentCopy() {
      try {
        const id = pluginContext?.get?.('locale')?.getLocale?.()?.id
        return COPY[typeof id === 'string' && id.startsWith('zh') ? 'zh' : 'en'] ?? COPY.zh
      } catch {
        return COPY.zh
      }
    }

    /** Translate one key through the Client locale service, falling back to the bundled dictionary. */
    function t(key) {
      try {
        const bound = pluginContext?.get?.('locale')?.bind?.(NS)
        const value = typeof bound === 'function' ? bound(key) : undefined
        if (typeof value === 'string' && value !== '' && value !== key) return value
      } catch {
        // fall through to the bundled dictionary
      }
      const copy = currentCopy()
      return typeof copy[key] === 'string' ? copy[key] : key
    }

    /** Publish our strings into the Client locale service once the service is reachable. */
    function registerLocale(ctx) {
      if (registeredLocale) return
      const locale = ctx.get('locale')
      if (locale === undefined || typeof locale.register !== 'function') return
      if (!pluginContext) pluginContext = ctx
      for (const [id, dict] of Object.entries(COPY)) {
        try {
          locale.register(NS, id, dict)
        } catch {
          // A namespace mismatch only costs the bundled fallback text.
        }
      }
      registeredLocale = true
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

    // -- dialog request store (one open dialog at a time) -------------------
    let openRequest = null
    const listeners = new Set()
    function publish(next) {
      openRequest = next
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // a broken listener must not block the others
        }
      }
    }
    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
    function useRequest() {
      return React.useSyncExternalStore(subscribe, () => openRequest, () => openRequest)
    }

    const styles = {
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
      workspaceName: { fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      workspacePath: {
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
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true
      }, [
        h('path', { key: 'folder', d: 'M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H6.5L8 4.5H13.5C14.0523 4.5 14.5 4.94772 14.5 5.5V12.5C14.5 13.0523 14.0523 13.5 13.5 13.5H2.5C1.94772 13.5 1.5 13.0523 1.5 12.5V3.5Z' }),
        h('path', { key: 'plus', d: 'M8 7.5V11.5M6 9.5H10' })
      ])
    }

    function FolderDialog({ request, onClose }) {
      const [folders, setFolders] = React.useState([])
      const [missing, setMissing] = React.useState([])
      const [busy, setBusy] = React.useState(true)
      const [error, setError] = React.useState('')
      const workspace = typeof request.path === 'string' ? request.path : ''
      const title = typeof request.title === 'string' && request.title !== '' ? request.title : workspace

      const refresh = React.useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const data = await callRoute('list', { workspace })
          setFolders(Array.isArray(data?.folders) ? data.folders : [])
          setMissing(Array.isArray(data?.missing) ? data.missing : [])
        } catch (failure) {
          setError(`${t('failed')}: ${String(failure?.message ?? failure)}`)
        } finally {
          setBusy(false)
        }
      }, [workspace])

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
          setError(t('pickerUnavailable'))
          return
        }
        let picked
        try {
          picked = await ui.pickDirectory()
        } catch (failure) {
          setError(`${t('failed')}: ${String(failure?.message ?? failure)}`)
          return
        }
        if (typeof picked !== 'string' || picked === '') return
        setBusy(true)
        try {
          await callRoute('add', { workspace, path: picked })
        } catch (failure) {
          setError(`${t('failed')}: ${String(failure?.message ?? failure)}`)
        } finally {
          setBusy(false)
          await refresh()
        }
      }

      const remove = async (folder) => {
        setError('')
        setBusy(true)
        try {
          await callRoute('remove', { workspace, path: folder })
        } catch (failure) {
          setError(`${t('failed')}: ${String(failure?.message ?? failure)}`)
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
        'aria-label': t('title')
      }, [
        h('div', { key: 'header', style: styles.header }, [
          h('span', { key: 'title', style: styles.title }, t('title')),
          h('button', { key: 'close', type: 'button', style: styles.close, 'aria-label': t('close'), onClick: onClose }, '×')
        ]),
        h('div', { key: 'subtitle', style: styles.subtitle }, t('subtitle')),
        h('div', { key: 'workspace', style: styles.workspaceName, title: workspace }, title),
        h('div', { key: 'path', style: styles.workspacePath, title: workspace }, workspace),
        h('div', { key: 'list', style: styles.list },
          folders.length === 0
            ? h('div', { style: styles.empty }, busy ? t('loading') : t('empty'))
            : folders.map((folder) => h('div', { key: folder, style: styles.row }, [
              h('span', { key: 'path', style: styles.path, title: folder }, folder),
              missing.includes(folder) ? h('span', { key: 'missing', style: styles.missing }, t('missing')) : null,
              h('button', {
                key: 'remove',
                type: 'button',
                style: styles.remove,
                disabled: busy,
                onClick: () => {
                  void remove(folder)
                }
              }, t('remove'))
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
        }, t('add'))
      ]))

      if (ReactDOM?.createPortal !== undefined && typeof document !== 'undefined') {
        return ReactDOM.createPortal(dialog, document.body)
      }
      return dialog
    }

    /** A failing dialog must cost only the dialog, never the overlay layer. */
    class OverlayBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        console.error('workspace-folders: dialog failed', error)
      }
      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    function OverlayHost() {
      const request = useRequest()
      if (request === null) return null
      return h(OverlayBoundary, null, h(FolderDialog, {
        key: request.workspaceId ?? request.path,
        request,
        onClose: () => publish(null)
      }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        pluginContext = ctx
        registerLocale(ctx)

        ctx.effect(() => ctx.slots.register({
          name: 'contextMenu.icon',
          key: ICON_KEY
        }, FolderGlyph), 'workspace-folders: menu icon')

        // The context-menu service can land after this module; mount once it exists.
        let attempt = 0
        let timer
        let disposeMenu
        const tryMountMenu = () => {
          timer = undefined
          const menus = ctx.get('contextMenus')
          if (menus !== undefined && typeof menus.register === 'function') {
            disposeMenu = menus.register({
              id: 'workspace-folders.attach',
              target: 'workspace',
              order: MENU_ORDER,
              observe: () => {
                const locale = ctx.get('locale')
                return locale !== undefined && typeof locale.subscribe === 'function' ? [locale] : []
              },
              resolve: (target) => [{
                id: 'attach-folders',
                label: t('menu'),
                icon: { key: ICON_KEY },
                run: () => {
                  publish({
                    workspaceId: target?.workspaceId,
                    path: target?.path,
                    title: target?.displayTitle
                  })
                }
              }]
            })
            return
          }
          attempt += 1
          if (attempt < 50) timer = setTimeout(tryMountMenu, 100)
          else console.warn('workspace-folders: context menu service is unavailable, so the workspace entry cannot appear')
        }
        tryMountMenu()
        ctx.effect(() => () => {
          if (timer !== undefined) clearTimeout(timer)
          try {
            disposeMenu?.()
          } catch {
            // already withdrawn with the service
          }
        }, 'workspace-folders: workspace menu entry')

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'workspace-folders.dialog',
          order: 20
        }, OverlayHost))
      }
    }
  }
})
