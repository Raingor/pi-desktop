<p align="center">
  <img src="public/pi.svg" width="76" height="76" alt="pi-desktop" />
</p>

<h1 align="center">pi-desktop</h1>

<p align="center">
  <strong>pi coding agent 的 macOS 桌面客户端</strong><br />
  聊天工作台 · 会话与记忆管理 · 提供商与模型配置 · 使用统计 · 菜单栏额度速览
</p>

<p align="center">
  <a href="https://github.com/Raingor/pi-desktop/releases/latest"><img src="https://img.shields.io/badge/下载-macOS%20DMG-0078d4?style=flat-square" alt="下载" /></a>
  <img src="https://img.shields.io/badge/version-0.8.3-blue?style=flat-square" alt="0.8.3" />
  <img src="https://img.shields.io/badge/macOS-11%2B%20·%20Intel%20%2F%20Apple%20Silicon-000?style=flat-square&logo=apple" alt="macOS" />
  <img src="https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron" alt="Electron 43" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT" />
</p>

<p align="center"><strong>🇨🇳 中文</strong> · <a href="README.en.md">🇬🇧 English</a></p>

---

## 下载安装

前往 **[Releases](https://github.com/Raingor/pi-desktop/releases/latest)** 下载对应芯片的安装包：

| 你的 Mac | 下载 |
|---|---|
| Apple Silicon（M1/M2/M3/M4） | `pi-desktop-<version>-arm64.dmg` |
| Intel | `pi-desktop-<version>.dmg` |

打开 DMG，把 **pi-desktop** 拖入「应用程序」即可。

> **首次打开被系统拦截是正常的** —— 应用未做 Apple 开发者签名与公证。
> 右键点击 App → **打开** → 再点一次「打开」；或到「系统设置 → 隐私与安全性」点击「仍要打开」。

**前置条件**：本机已安装并登录 pi CLI。pi-desktop 不内置任何 AI 能力，它读写你本机 `~/.pi/agent/` 的真实配置，并调用你已安装的 `pi` 可执行文件来跑对话。

```bash
npm i -g @earendil-works/pi-coding-agent
pi   # 首次登录，配置提供商
```

## 这是什么

pi-desktop 把 pi CLI 的日常操作搬进原生窗口：**左边是会话列表、右边是对话，配置全部收进一个独立的设置工作台**。

它不是 pi 的替代品，而是同一份配置的另一个入口 —— 所有改动直接写回 `~/.pi/agent/`，你在 pi-desktop 里改的提供商、模型、记忆，回到终端 `pi` 里立刻生效，反之亦然。

- **零后端** —— 不需要数据库、不需要注册、不联网上传任何数据；应用内起一个仅绑定 `127.0.0.1` 的本地 HTTP 服务读写本机文件
- **和 pi 共用会话** —— 桌面端开的对话就是 pi 的 session 文件，终端 `pi --resume` 能直接接上
- **重命名兼容** —— 侧栏改会话名写的是 pi 原生的 `session_info`，CLI 侧看到的名字一致

### 和 pi-web-switch 的关系

pi-desktop 衍生于姊妹项目 **[pi-web-switch](https://github.com/Raingor/pi-web-switch)**（从它的 `codex/web-pi-chat` 分支整体搬迁而来），之后分开演进为两个定位不同的工具：

| | pi-web-switch | pi-desktop（本项目） |
|---|---|---|
| 形态 | 浏览器面板 | 原生 macOS 应用（Electron） |
| 侧重 | 多页并列的配置管理，Chat 只是 8 项导航里的一页 | 聊天优先，主窗口只做对话，配置收进独立工作台 |
| 菜单栏 | 无 | 常驻图标 + 用量浮窗（含 Codex 官方额度） |
| 主题 | 浅色 / 深色 | 15 套整体界面风格 |
| 安装 | `npm:@raingor/pi-web-switch` | DMG / ZIP（未发布到 npm） |

**两边读写同一份 `~/.pi/agent/` 配置，可以并存使用，不冲突。** 想在浏览器里管配置就用 pi-web-switch，想要一个常驻的对话窗口就用 pi-desktop。

## 功能

### 聊天工作台

应用主界面只做一件事：对话。

- **按项目分组的会话列表** —— 自动解码 session 目录名还原真实项目路径，折叠分组，支持在任意项目目录下发起新对话
- **打开会话即恢复模型** —— 从会话历史里读回当时用的提供商/模型/思考等级；模型已不可用时回落到默认值，不会留下误导性的过期选择
- **侧栏重命名** —— 「···」菜单 → 重命名，写入 pi 原生元数据
- **默认工作目录是用户目录** —— 下拉里显示为「默认目录（~）」，不选项目时 prompt 就在 `~` 下跑
- **会话信息面板** —— 消息数、时长、token、成本、项目路径，一键在 Finder 中显示
- **输入 `/` 弹命令面板** —— 列出扩展包命令、提示模板和技能（当前 44 + 6 + 42），支持模糊匹配、↑↓ 选择、Tab/Enter 补全。列表由 pi 自己枚举，因此不会出现只在终端有效的内置命令
- **会话用量面板带「压缩会话」** —— 让 pi 把较早的对话总结成摘要以释放上下文，可填摘要侧重点；会调一次模型，因此先确认再执行，完成后显示 token 前后对比与花费
- **可拖拽侧栏** —— 200–480px 自由调整（默认 264px），宽度持久化
- **沉浸式标题栏** —— 无边框窗口，交通灯按钮融入侧栏；窗口尺寸按你的屏幕工作区自适应

### 右侧工具面板

默认隐藏。点窗口右上角按钮或按 **⌘J** 展开，宽度 280–720px 可拖拽，开合状态、所在标签、宽度都会记住。六个工具：

面板作用的目录跟随聊天页选中的项目 —— 没选时就是默认的用户目录 `~`。

| 工具 | 能做什么 |
|---|---|
| **文件目录** | 浏览当前项目目录树，点开文本文件直接预览（512KB 上限，二进制文件标注不预览）；node_modules / dist 等目录自动隐藏 |
| **审查** | 当前分支的 git 改动清单 + 逐文件 unified diff 着色；未跟踪文件按全新增渲染。只读，不暂存不提交 |
| **SubAgent** | 子代理运行记录（每 4 秒刷新），运行中/成功/失败分色，可以一边对话一边盯子任务 |
| **后台任务** | 终端面板起的每条命令 + 服务端正在跑的 pi 对话，看状态/耗时/退出码，可逐个终止，点任务跳回终端看输出 |
| **浏览器** | 内嵌 `<webview>` 看文档、localhost 预览、API 控制台；前进/后退/刷新，可转交系统浏览器 |
| **终端** | 在项目目录执行命令并流式回显，支持向进程 stdin 送行、Ctrl+C 终止、↑↓ 翻历史 |

> **终端是命令执行器，不是终端模拟器。** 没有 PTY，子进程看到的是管道，所以 `vim`、`top` 这类需要 tty 的交互式程序用不了。这是为了不引入 native 模块（打包产物刻意不含 `node_modules`）而做的取舍 —— 需要完整交互时点右上角「在系统终端打开」。

### 菜单栏速览

常驻菜单栏图标，**单击弹出用量浮窗**：

- 今日 / 近 7 日的 token、成本、请求数 + 迷你折线图 + Top 提供商
- **OpenAI Codex 官方额度** —— 5 小时窗口与每周窗口的剩余百分比、倒计时、准确重置时间
- 右键菜单：打开主窗口 / 刷新用量 / 退出
- 浮窗可见时每 30 秒自动刷新

### 设置工作台

独立于聊天的全屏配置页（`/settings`），左侧七个分区：

| 分区 | 内容 |
|---|---|
| **通用** | 主题、界面风格、缩放与字号、语言、导入/导出配置、pi CLI 设置、技能与命令浏览、扩展包管理 |
| **概览与使用统计** | 今日/7日/30日/自定义区间的 token 与成本、每日成本图、提供商与模型维度统计、缓存命中率、请求明细、USD/CNY 切换、Codex 登录状态与官方额度 |
| **提供商与模型** | 提供商卡片、自定义 OpenAI 兼容提供商（Ollama / vLLM / LM Studio）、API Key 与密钥池、在线拉取模型列表、跨提供商已启用模型总览 |
| **子代理** | 读取 pi 子代理定义与运行历史，可编辑 agent 配置 |
| **模型测速** | 批量实测延迟与可用性，结果持久化，通过率 100% 的模型可一键加入对应提供商 |
| **会话管理** | 全量会话浏览、预览、移入回收站与还原；可一键归档超过 14 天无活动的会话 |
| **记忆** | pi-hermes-memory 的 `MEMORY.md` / `USER.md` / `failures.md` 渲染、条目删除、记忆优化 |

### 15 套界面风格

整个应用的配色通过 `html[data-style]` 令牌切换，点选卡片即时换肤，无需重载。

**pi 原创 9 套**：石墨仪器（默认）· 信号终端 · 赛博霓虹（恒暗）· 像素游戏 · 可爱软糖 · 文雅书卷 · 素雅灰白 · 暖琥珀 · 星紫

**编辑器 / 助手配色 6 套**（取自各家官方或公开色板）：VS Code Dark Modern · Kiro · Claude · Codex · Gemini · Grok（恒暗）

每套风格都支持浅色/深色/跟随系统，切换主题时 Electron 窗口背景同步变化，避免打开瞬间的白闪。

### 多语言

界面支持 **简体中文 / 繁體中文 / English / 日本語**，侧栏底部切换，选择持久化。

## 开发

```bash
git clone https://github.com/Raingor/pi-desktop.git
cd pi-desktop
npm install

npm run electron:dev      # Electron + Vite HMR（推荐）
npm run dev               # 只跑 Web，浏览器访问 http://localhost:5179
npm run verify            # typecheck + lint + test，提交前跑这个
npm test                  # vitest 108 个 + node:test 3 个用例
npm run lint              # eslint
npm run typecheck         # tsc -b
npm run build             # tsc -b && vite build
npm run electron:build    # 打出 release/ 下的 DMG + ZIP（x64 与 arm64）
npm run electron:preview  # 不打包直接跑生产构建
npm run tray:icon         # 重新生成菜单栏模板图标
```

CI（`.github/workflows/verify.yml`）在 macOS runner 上跑 typecheck + lint + test + 三个 bundle 构建，不含签名与 DMG 打包。

**开发与打包运行同一套后端代码**：`server/api-routes.ts` 导出 `createPiApiMiddleware()`，开发时挂在 Vite 中间件上，打包后由 `electron/api-server.ts` 起的本地 HTTP 服务复用 —— 两种模式下前端行为完全一致。

打包产物只含 `dist/` 与 `dist-electron/`，**不打包 `node_modules`** —— 运行时只依赖 Node 内置模块和 Electron，所以 `app.asar` 仅 2MB。

## 项目结构

```
pi-desktop/
├── electron/                    # 桌面外壳
│   ├── main.ts                  # 主进程：窗口、托盘、浮窗、IPC、单实例锁
│   ├── api-server.ts            # 打包后的本地 HTTP 服务（dist/ + /api/pi/*）
│   ├── preload.ts               # contextBridge 白名单
│   ├── popup.html / popup-render.ts   # 菜单栏浮窗
├── server/
│   ├── pi-reader.ts             # 读写 ~/.pi/agent/、解析会话、聚合用量、驱动 pi CLI
│   ├── api-routes.ts            # 60 条 API 的唯一实现
│   ├── workspace-tools.ts       # 工具面板后端：目录树、git diff、后台任务进程表
│   ├── pi-rpc.ts                # pi RPC 模式的单次命令客户端
│   ├── session-compact.ts       # 通过 pi 的 RPC 模式手动压缩会话
│   ├── slash-commands.ts        # “/” 命令注册表（扩展/模板/技能），带缓存
│   ├── local-origin-guard.ts    # Host / Origin / Content-Type 防护
├── src/
│   ├── App.tsx                  # 路由：/ 与 /chat → 聊天，/settings → 设置工作台
│   ├── index.css                # 主题与 15 套风格的 CSS 令牌
│   ├── components/
│   │   ├── chat/                # ChatPage
│   │   ├── layout/              # AppShell、Sidebar、RightPanel
│   │   ├── tools/               # 右侧六个面板（文件/审查/子代理/任务/浏览器/终端）
│   │   ├── settings/            # SettingsWorkspace、SettingsPage、Skills、Commands、PiCli、PackageBrowser
│   │   ├── dashboard/           # 使用统计
│   │   ├── providers/           # 提供商与模型
│   │   ├── speedtest/           # 模型测速
│   │   ├── subagents/           # 子代理
│   │   ├── sessions/            # 会话管理、记忆
│   │   └── ui/                  # StatCard、Badge、Modal、EmptyState
│   ├── store/config-store.ts    # Zustand
│   ├── lib/                     # i18n、workspace 上下文、pi-settings 合并、provider 导入、货币、工具
│   └── data/                    # 内置提供商、模型目录、更新日志
├── pi-package/ + extensions/    # 作为 pi 扩展分发的入口
├── scripts/                     # electron-dev、托盘图标生成
└── build/                       # 应用图标与菜单栏模板图
```

## 数据来源

所有数据来自本机 `~/.pi/agent/`，**没有 mock 数据，没有远程服务**。

| 路径 | 用途 |
|---|---|
| `settings.json` | 默认提供商/模型/思考等级、主题、已启用模型、扩展包、项目信任 |
| `auth.json` | 各提供商 API Key |
| `models.json` | 自定义提供商定义（baseUrl、API 类型、模型、密钥池） |
| `sessions/*.jsonl` | 会话历史：消息、模型、token、成本 |
| `pi-hermes-memory/*.md` | 记忆：MEMORY.md / USER.md / failures.md |
| `hermes-memory-config.json` | 记忆系统配置 |
| `copilot.json` | Copilot 账号配置 |

内置提供商目录不是硬编码的 —— 它直接读你本机 pi 安装里 `@earendil-works/pi-ai` 的 `dist/providers/data/*.json`（当前为 39 个提供商），所以 pi 升级后目录自动跟着更新。

## API

60 条路由（33 GET / 27 POST），全部在 `/api/pi/*` 下，仅监听 `127.0.0.1`。

<details>
<summary>展开完整清单</summary>

**配置**
`GET|POST /settings` · `GET|POST /auth` · `GET|POST /models` · `GET /builtin-providers` · `GET|POST /copilot-config`

**聊天**
`POST /chat` · `POST /chat/stop` · `GET /chat/active` · `GET /chat/default-directory` · `POST /chat/select-directory`

**会话**
`GET /sessions` · `GET /session-history` · `GET /session-info` · `GET /session-preview` · `GET /session-usage` · `POST /session-message` · `POST /session-rename` · `POST /session-compact` · `POST /session/trash` · `POST /session/restore` · `GET /trash`

**用量**
`GET /usage` · `GET /codex-usage-status` · `GET /official-usage-config` · `POST /official-usage-query` · `POST /official-usage-refresh`

**记忆**
`GET /memory` · `GET|POST /memory/config` · `GET /memory/status` · `POST /memory/delete-entry` · `POST /memory/optimize`

**扩展与工具**
`GET /skills` · `GET /commands` · `GET /slash-commands` · `GET /subagents` · `POST /subagents/update-agent` · `GET /packages/search` · `GET /check-updates` · `POST /apply-updates` · `POST /provider-test` · `POST /provider-models` · `POST /model-test`

**工具面板**
`GET /workspace/tree` · `GET /workspace/file` · `GET /workspace/review` · `GET /workspace/diff` · `GET /workspace/tasks` · `GET /workspace/task-output` · `POST /workspace/task-run` · `POST /workspace/task-input` · `POST /workspace/task-stop` · `POST /workspace/tasks-clear`

</details>

## 安全说明

本地服务虽然只绑定 `127.0.0.1`，但仅靠这点挡不住浏览器发起的跨站写请求，因此 `server/local-origin-guard.ts` 对每个 `/api/pi/*` 请求做三重校验：

- 非回环 `Host` 直接拒绝（防 DNS rebinding）
- 跨源 `Origin` 直接拒绝
- POST 非 `application/json` 直接拒绝（挡掉无需预检的表单型 CSRF）

Electron 侧 `contextIsolation: true`、`nodeIntegration: false`，渲染进程只能通过 preload 白名单调用主进程能力。

浏览器面板需要 `webviewTag`，因此主进程在 `will-attach-webview` 里强制剔除 guest 的 preload、关掉 node 集成、拒绝非 http(s) 的 src；guest 开新窗统一转给系统浏览器。

工具面板的文件浏览与预览都做了根目录包含校验 —— `../../.ssh/id_rsa` 这类路径在服务端就被拒，不会因为面板能「浏览项目」而变成任意读文件。

`auth.json` 里的 API Key 会明文返回给应用自身的前端（编辑密钥、测试连接、导出备份都需要），这是设计取舍 —— 该接口只对本应用可达。

## 作为 pi 扩展使用

除了桌面应用，本仓库也能当 pi 扩展装，在 pi 会话里直接起停开发面板。本项目**未发布到 npm**（npm 上的 `pi-desktop` 是另一个同名包），所以用本地路径声明 —— 在 `~/.pi/agent/settings.json` 里指向你 clone 的目录：

```json
{ "packages": ["/absolute/path/to/pi-desktop"] }
```

| 命令 | 说明 |
|---|---|
| `/pi-switch start [port]` | 启动开发面板（默认 `http://localhost:5179`） |
| `/pi-switch stop` | 停止 |
| `/pi-switch status` | 查看运行状态 |
| `/pi-usage` | 终端里直接打印今日 + 近 7 日用量（token / 成本 / 请求 / 迷你折线），不开面板 |

## 已知限制

- **未签名未公证** —— 首次打开需右键绕过 Gatekeeper；有 Apple 开发者账号后可补
- **无自动更新** —— 新版需手动下载覆盖
- **仅 macOS 经过验证** —— `package.json` 里保留了 Windows NSIS 与 Linux AppImage 目标，但未实测
- **依赖本机 pi CLI** —— pi 未安装或未登录时，对话功能不可用
- **`localStorage` 键仍带旧前缀** —— 为避免升级后丢失用户偏好，暂未重命名

## 许可证

MIT

<p align="center">
  <sub>
    <a href="https://github.com/Raingor/pi-desktop">pi-desktop</a> ·
    姊妹项目 <a href="https://github.com/Raingor/pi-web-switch">pi-web-switch</a> ·
    <a href="https://github.com/Raingor">GitHub @Raingor</a> ·
    <a href="https://raingor.github.io/my-blog/">Blog</a> ·
    灵感来自 <a href="https://github.com/farion1231/cc-switch">cc-switch</a>
  </sub>
</p>
