# dsh-workspace-folders

给当前工作区**附加多个文件夹**：附加后它们和会话工作区一样可读可写（`read` / `write` / `edit` / `bash` 都认），
模型能在运行时上下文里看到它们，你也能在输入框左侧按钮里增删。

## 能力

- **沙箱授权**：把附加目录接进 `ctx.sandboxPolicy` 的 `additionalWritableRoots`。文件沙箱（`dsh-fs-sandbox`）和
  终端沙箱（`dsh-bash-sandbox`）都从同一个 `resolve()` 读这份白名单，所以两边不会各写各的。目录被删掉时会自动
  跳过授权，不会让后续每次受限调用都报错。
- **模型可见**：一条 `workspace:folders` 运行时上下文，外加 `workspace_folders` 工具（`list` / `add` / `remove`）。
- **人的入口**：
  - 输入框左侧的「附加文件夹」按钮：弹出列表，可用系统文件夹选择器添加、逐条移除。
  - 斜杠命令 `/folders`、`/folders add <路径>`、`/folders remove <路径>`。
- **持久化**：列表存在 `$DSH_HOME/workspace-folders.json`（默认 `~/.dsh/workspace-folders.json`），跨会话、跨重启保留。

## 安装

从 GitHub 安装（推荐）：

```text
dsh plugin add github:jkm6221/dsh-workspace-folders
```

或者把本目录作为 bundle 安装：

```text
plugin_manager action=install_bundle target=<本仓库克隆后的绝对路径>
```

安装后宿主半和客户端半都会热加载；页面若没变化刷新一次 Web GUI。

## 用法

```text
你说：把 ~/work/shared-lib 加进工作区
模型：workspace_folders { action: "add", path: "~/work/shared-lib" }

你输入：/folders add ../design-system
你点击：输入框左侧「附加文件夹」→「添加文件夹」
```

移除同理：`/folders remove ../design-system`，或列表里点「移除」。

## 注意

- 附件列表是**部署级**的：`ctx.sandboxPolicy` 的额外可写根按设计对整个 profile 生效，不按会话隔离。想临时收窄
  权限，请把会话切到 `read-only`，或移除对应目录。
- 只接受已存在的目录；相对路径按会话当前目录解析，`~` 会展开。
- 客户端走的是本机回环上的 `POST /workspace-folders/*`，要求 `x-dsh-plugin: workspace-folders` 头，跨站页面无法
  直接构造这种请求。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主半：存储、沙箱授权、工具、命令、运行时上下文、回环路由 |
| `lib/client.js` | 客户端半：输入框左侧按钮 + 文件夹弹窗 |
| `cordis.patch.yml` | bundle 插入的插件行 |
| `locale/*.json` | 插件管理器里的标题与说明 |
| `icon.svg` | 插件图标 |
