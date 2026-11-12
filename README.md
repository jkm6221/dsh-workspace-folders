# dsh-workspace-folders

给**当前工作区**附加多个文件夹：附加后它们和该工作区一样可读可写（`read` / `write` / `edit` / `bash` 都认），
模型能在运行时上下文里看到它们，你也能在输入框左侧按钮里增删。附加关系**只属于这个工作区**，别的项目看不到也写不了。

## 能力

- **按工作区生效**：附件挂在 `ctx.sandboxPolicy.resolve({ session })` 上，按会话记录的 `header.cwd`（工作区根）取当前工作区自己的那份列表。
  文件沙箱（`dsh-fs-sandbox`）和终端沙箱（`dsh-bash-sandbox`）都从这同一个 `resolve()` 读白名单，所以两边不会各写各的；
  换到另一个工作区的会话拿不到这些目录。目录被删掉时会自动跳过授权，不会让后续每次受限调用都报错。
- **模型可见**：一条 `workspace:folders` 运行时上下文（只列当前工作区的），外加 `workspace_folders` 工具（`list` / `add` / `remove`）。
- **人的入口**：
  - 输入框左侧的「附加文件夹」按钮：弹出当前工作区的列表，可用系统文件夹选择器添加、逐条移除。
  - 斜杠命令 `/folders`、`/folders add <路径>`、`/folders remove <路径>`。
- **持久化**：存在 `$DSH_HOME/workspace-folders.json`（默认 `~/.dsh/workspace-folders.json`），按工作区根分桶，跨会话、跨重启保留。

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

- **只对当前工作区生效**：附加关系按会话的 `header.cwd` 分桶。同一个工作区里的多个会话共享，切到别的项目（另一个工作区）就看不到、
  也写不进去；把会话 `cd` 到别处不改变这个归属。
- **状态格式升级**：0.1.0 的全局列表（`version: 1`）不再读取，升级后请在工作区里重新附加一次；文件会在下次增删时重写成 `version: 2`。
- 只接受已存在的目录；相对路径按会话当前目录解析，`~` 会展开。
- 客户端走的是本机回环上的 `POST /workspace-folders/*`，要求 `x-dsh-plugin: workspace-folders` 头，跨站页面无法
  直接构造这种请求；请求里带当前会话 id，宿主据此定位工作区。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主半：存储、沙箱授权、工具、命令、运行时上下文、回环路由 |
| `lib/client.js` | 客户端半：输入框左侧按钮 + 文件夹弹窗 |
| `cordis.patch.yml` | bundle 插入的插件行 |
| `locale/*.json` | 插件管理器里的标题与说明 |
| `icon.svg` | 插件图标 |
