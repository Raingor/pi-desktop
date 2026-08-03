# Tauri 重写 Prompt 文档

> 基于 pi-web-switch (Electron 版) 的完整代码库分析，生成 Tauri 2.0 重写的详细需求规范。
> 本文档可直接作为 AI 编码助手的输入 prompt，用于从零构建 Tauri 版本。

---

## 一、项目定位

**pi-switch** 是一个 pi coding agent 的桌面管理面板，功能包括：
- 实时配置管理（Providers / Models / Auth / Settings）
- Token 用量与费用统计仪表盘
- 会话浏览与回收站管理
- Hermes 记忆查看（MEMORY.md / USER.md / failures.md）
- 实时 SSE 聊天（调用 pi SDK 的 AgentSession）
- Subagents 定义与运行历史
- 多语言（中/英/日）、明暗主题、界面缩放

数据直接读写 `~/.pi/agent/` 目录——无数据库、无云服务。

---

## 二、技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | **Tauri 2.0**（Rust + WebView2/WebKit） | 替代 Electron，包体积从 ~150MB 降至 ~10MB |
| 前端 | React 19 + TypeScript + Vite 6 + Tailwind CSS v4 | 沿用现有前端技术栈 |
| 状态管理 | Zustand | 沿用 |
| 图表 | Recharts | 沿用 |
| 路由 | React Router v7 | 沿用 |
| 后端逻辑 | Rust（Tauri Commands） | 替代 Node.js 的 pi-reader.ts + chat-api-plugin.ts |
| Chat 通信 | Rust + pi SDK FFI 或子进程 | 替代 agent-session-manager.ts |

---

## 三、架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────┐
│              Tauri 2.0 Application              │
│  ┌───────────────────────────────────────────┐  │
│  │         Frontend (React + Vite)           │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────┐ │  │
│  │  │  Pages  │ │ Stores   │ │ Components │ │  │
│  │  │(8 routes│ │(Zustand) │ │  (shared)  │ │  │
│  │  └─────────┘ └──────────┘ └────────────┘ │  │
│  └───────────────────┬───────────────────────┘  │
│                      │ invoke()                 │
│  ┌───────────────────▼───────────────────────┐  │
│  │          Tauri Commands (Rust)            │  │
│  │  ┌─────────────┐  ┌────────────────────┐  │  │
│  │  │  pi_reader   │  │  chat_agent       │  │  │
│  │  │  (文件读写)  │  │  (会话/SSE 管理)  │  │  │
│  │  └─────────────┘  └────────────────────┘  │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 3.2 目录结构（目标）

```
pi-switch-tauri/
├── src/                          # React 前端（从现有 src/ 大部分复用）
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/               # 全部 UI 组件直接复用
│   ├── store/                    # Zustand store（改为 invoke Tauri commands）
│   ├── lib/                      # utils, i18n, currency, config
│   ├── data/                     # builtin-providers, model-catalog
│   ├── hooks/                    # useAgentSession 改为 Tauri SSE
│   └── types/                    # 全部类型定义直接复用
├── src-tauri/                    # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs               # 入口 + Command 注册
│   │   ├── pi_reader/            # ~/.pi/agent/ 文件读写模块
│   │   │   ├── mod.rs
│   │   │   ├── settings.rs       # settings.json 读写
│   │   │   ├── auth.rs           # auth.json 读写
│   │   │   ├── models.rs         # models.json 读写
│   │   │   ├── sessions.rs       # sessions/*.jsonl 解析
│   │   │   ├── usage.rs          # 用量聚合统计
│   │   │   ├── memory.rs         # hermes-memory/*.md 读写
│   │   │   ├── subagents.rs      # agents/chains/run-history
│   │   │   ├── provider_test.rs  # 在线拉取模型/连接测试
│   │   │   └── update_check.rs   # npm registry 版本检查
│   │   ├── chat_agent/           # Chat 会话管理
│   │   │   ├── mod.rs
│   │   │   ├── session.rs        # 会话生命周期
│   │   │   └── sse.rs            # SSE 事件流
│   │   └── utils/                # 通用工具
│   │       ├── mod.rs
│   │       ├── http.rs           # HTTP 请求（含代理检测）
│   │       └── path.rs           # 路径处理
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.ts
```

---

## 四、Rust 后端 Command 清单

### 4.1 Pi 配置 Commands（替代 pi-reader.ts + Vite 中间件）

```rust
// Settings
#[tauri::command] fn pi_settings_get() -> Result<PiSettings, String>
#[tauri::command] fn pi_settings_set(data: PiSettings) -> Result<bool, String>

// Auth
#[tauri::command] fn pi_auth_get() -> Result<PiAuth, String>
#[tauri::command] fn pi_auth_set(data: PiAuth) -> Result<bool, String>

// Models (custom providers)
#[tauri::command] fn pi_models_get() -> Result<PiModelsJson, String>
#[tauri::command] fn pi_models_set(data: PiModelsJson) -> Result<bool, String>

// Built-in provider catalog
#[tauri::command] fn pi_builtin_catalog_get() -> Result<Vec<Provider>, String>

// Usage / Dashboard
#[tauri::command] fn pi_usage_get() -> Result<UsageData, String>
#[tauri::command] fn pi_usage_range_get(range: String, from: String, to: String) -> Result<UsageRangeData, String>

// Sessions
#[tauri::command] fn pi_sessions_list() -> Result<Vec<ProjectGroup>, String>
#[tauri::command] fn pi_session_trash(path: String) -> Result<bool, String>
#[tauri::command] fn pi_session_restore(trash_path: String) -> Result<bool, String>
#[tauri::command] fn pi_session_delete_permanent(path: String) -> Result<bool, String>
#[tauri::command] fn pi_session_preview(path: String) -> Result<SessionPreview, String>
#[tauri::command] fn pi_trash_list() -> Result<Vec<TrashEntry>, String>

// Memory
#[tauri::command] fn pi_memory_get() -> Result<Vec<MemoryFile>, String>
#[tauri::command] fn pi_memory_delete_entry(filename: String, text: String) -> Result<bool, String>

// Subagents
#[tauri::command] fn pi_subagents_get() -> Result<SubagentsData, String>

// Update check
#[tauri::command] fn pi_check_updates() -> Result<UpdateCheckResult, String>
#[tauri::command] fn pi_apply_updates(names: Vec<String>) -> Result<Vec<ApplyUpdateResult>, String>

// Provider / Model online
#[tauri::command] async fn pi_fetch_provider_models(base_url: String, api_key: Option<String>, provider_id: Option<String>) -> Result<FetchedModelsResult, String>
#[tauri::command] async fn pi_test_provider(base_url: String, api_key: Option<String>) -> Result<ProviderTestResult, String>
#[tauri::command] async fn pi_test_model(base_url: String, model_id: String, api_key: Option<String>, api_type: String) -> Result<ProviderTestResult, String>
```

### 4.2 Chat Commands（替代 chat-api-plugin.ts + agent-session-manager.ts）

```rust
// Session lifecycle
#[tauri::command] fn chat_list_sessions() -> Result<Vec<SessionInfo>, String>
#[tauri::command] fn chat_get_session(id: String) -> Result<SessionData, String>
#[tauri::command] fn chat_rename_session(id: String, name: String) -> Result<bool, String>
#[tauri::command] fn chat_delete_session(id: String) -> Result<bool, String>
#[tauri::command] fn chat_auto_name(id: String) -> Result<String, String>

// Agent interaction
#[tauri::command] fn chat_start_session(cwd: String, options: SessionStartOptions) -> Result<StartSessionResult, String>
#[tauri::command] fn chat_send_command(session_id: String, command: Value) -> Result<Value, String>
#[tauri::command] fn chat_get_state(session_id: String) -> Result<AgentState, String>

// SSE events (Tauri Channel / EventStream)
#[tauri::command] fn chat_subscribe_events(session_id: String) -> Result<String, String>  // returns channel id
// Frontend listens via tauri.channel or window.emit

// Models for cwd
#[tauri::command] fn chat_load_models(cwd: String) -> Result<ModelLoadResult, String>

// File system
#[tauri::command] fn fs_read_file(path: String) -> Result<FileContent, String>
#[tauri::command] fn fs_list_dir(path: String) -> Result<Vec<DirEntry>, String>
#[tauri::command] fn fs_validate_dir(path: String) -> Result<String, String>
```

### 4.3 System Commands

```rust
#[tauri::command] fn system_get_home_dir() -> String
#[tauri::command] fn system_get_default_cwd() -> String
```

---

## 五、关键模块实现要求

### 5.1 pi_reader 模块

**数据源**：所有数据读写 `~/.pi/agent/` 目录：

| 文件 | 读写 | 用途 |
|------|------|------|
| `settings.json` | R/W | 默认配置、主题、启用模型 |
| `auth.json` | R/W | Provider API Keys |
| `models.json` | R/W | 自定义 Provider 定义 |
| `sessions/*.jsonl` | R | 会话用量数据 |
| `pi-hermes-memory/*.md` | R/W | 记忆文件 |
| `agents/*.md` | R | Agent 定义（YAML frontmatter） |
| `chains/*.chain.md` | R | Chain 定义 |
| `run-history.jsonl` | R | 运行历史 |
| `npm/package.json` | R | 已安装扩展列表 |

**核心要求**：
- 使用 `serde` / `serde_json` 处理 JSON，`serde_yaml` 处理 frontmatter
- 文件写入前先备份（`.bak`），写入失败时恢复
- 会话 JSONL 解析逻辑：逐行读取 → 按 `type` 字段分类 → 聚合 token/cost
- 用量统计按日期/小时聚合，支持日/周/月/自定义范围筛选
- 内置 Provider 目录优先从本地 pi 安装的 `@earendil-works/pi-ai` 读取，回退到硬编码列表

### 5.2 chat_agent 模块

**核心要求**：
- 管理 pi AgentSession 生命周期（创建/恢复/销毁）
- 使用 `tokio::sync::broadcast` 或 `tauri::channel` 实现 SSE 事件流
- 会话注册表使用 `tokio::sync::Mutex<HashMap<String, SessionHandle>>`
- 支持 `get_state`、`send_command`、`abort`、`compact` 等操作
- 进程退出时自动清理所有活跃会话

**SSE 实现方案**：
```rust
// Rust 端
#[tauri::command]
fn chat_subscribe_events(
    session_id: String,
    window: Window,
) -> Result<(), String> {
    // 使用 window.emit() 向前端推送事件
    // 或使用 tauri::ipc::Channel
}

// 前端端
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<AgentEvent>();
channel.onmessage = (event) => { /* 处理 */ };
await invoke('chat_subscribe_events', { sessionId, channel });
```

### 5.3 HTTP 请求模块

**需要实现的功能**：
- 检测系统代理（环境变量 `http_proxy` / `https_proxy`，macOS `scutil --proxy`）
- 通过 `reqwest` + `proxy` 支持实现代理转发
- 支持超时控制（连接测试 10s，模型测试 15s，OpenRouter 20s）
- 支持 `$ENV_VAR` 格式的 API Key 解析

### 5.4 安全约束

- 会话文件删除/恢复：路径必须在 `~/.pi/agent/sessions/` 或 `~/.pi/agent/.trash/` 内
- 文件读取：路径必须在 `~/.pi/agent/` 或用户 home 目录内
- 外部 HTTP 请求：仅允许 `https://` 协议，目标为已知 API 端点
- CORS：Tauri 无浏览器 CORS 限制，但仍需验证 URL 合法性

---

## 六、前端迁移要点

### 6.1 Store 改造

现有 `config-store.ts` 的 API 调用：
```typescript
// 旧：fetch('/api/pi/settings')
const res = await fetch(`${API_BASE}${path}`);
```

改为 Tauri invoke：
```typescript
// 新：invoke('pi_settings_get')
import { invoke } from '@tauri-apps/api/core';
const data = await invoke<PiSettings>('pi_settings_get');
```

### 6.2 Chat SSE 改造

现有 `useAgentSession.ts` 使用浏览器 `EventSource`：
```typescript
// 旧：new EventSource('/api/chat/agent/{id}/events')
```

改为 Tauri Channel：
```typescript
// 新：
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<AgentEvent>();
await invoke('chat_subscribe_events', { sessionId, channel });
channel.onmessage = (event) => { /* 处理 */ };
```

### 6.3 可直接复用的部分

以下文件/模块无需修改或仅需极小改动即可复用：
- `src/components/` — 全部 UI 组件（与框架无关）
- `src/types/` — 全部类型定义
- `src/data/builtin-providers.ts` — 内置 Provider 数据
- `src/data/model-catalog.ts` — 模型目录
- `src/lib/i18n.tsx` + `translations/` — 国际化
- `src/lib/currency.ts` — 币种切换
- `src/lib/utils.ts` — 格式化工具
- `src/lib/config.ts` — 配置导入/导出
- `src/index.css` — Tailwind + 主题变量
- `src/hooks/useAgentSession.ts` — 需改造 SSE 部分，其余逻辑保留

### 6.4 需要重写的部分

| 文件 | 改动内容 |
|------|---------|
| `src/store/config-store.ts` | fetch → invoke |
| `src/hooks/useAgentSession.ts` | EventSource → Tauri Channel |
| `src/main.tsx` | 移除 `applySavedFontSize/Zoom`（改用 Tauri 窗口配置） |

---

## 七、功能完整性清单

### 7.1 Dashboard 仪表盘
- [ ] Token 用量统计（今日/7天/30天/自定义）
- [ ] 费用图表（按日/按小时）
- [ ] Provider/Model 统计
- [ ] 缓存命中率
- [ ] 请求日志表
- [ ] USD/CNY 币种切换
- [ ] 自动刷新（5s/10s/30s/60s）

### 7.2 Providers & Models
- [ ] 内置 Provider 列表（从 pi 安装目录读取）
- [ ] 自定义 Provider 增删改
- [ ] API Key 管理（$ENV 引用提示）
- [ ] 模型启用/禁用开关
- [ ] 在线拉取模型列表（OpenAI/OpenRouter/Ollama）
- [ ] 连接测试 + 单模型测试 + 批量测试
- [ ] 价格显示（跟随币种）
- [ ] 模型排序/搜索/过滤
- [ ] 内置 Provider baseUrl 覆盖
- [ ] 复制 Provider（携带模型）

### 7.3 Sessions
- [ ] 按项目分组浏览
- [ ] 会话预览（前 20 条消息）
- [ ] 回收站（移入/恢复/永久删除）
- [ ] 搜索/过滤

### 7.4 Memory
- [ ] MEMORY.md / USER.md / failures.md 查看
- [ ] Markdown 渲染
- [ ] 删除单条记忆

### 7.5 Chat
- [ ] 会话列表（按项目分组）
- [ ] SSE 实时消息流
- [ ] 文本 + 图片输入
- [ ] 工具调用展示
- [ ] 模型切换
- [ ] 会话命名/重命名
- [ ] 目录浏览选择 cwd
- [ ] Token 用量展示

### 7.6 Subagents
- [ ] Agent 定义列表（YAML frontmatter 解析）
- [ ] Chain 定义列表
- [ ] 运行历史

### 7.7 Settings
- [ ] 默认 Provider/Model/Thinking Level
- [ ] 主题切换（Light/Dark/System）
- [ ] 界面缩放（50%-200%）
- [ ] 字体大小（12-24px）
- [ ] 包管理（packages 列表）
- [ ] 配置导入/导出
- [ ] 恢复出厂设置
- [ ] 更新检查（pi core + extensions）

### 7.8 系统功能
- [ ] 多语言切换（en/zh-CN/zh-TW/ja）
- [ ] 明暗主题
- [ ] 应用图标
- [ ] 窗口大小/位置记忆

---

## 八、构建与分发

### 8.1 开发模式
```bash
npm run tauri dev    # Tauri dev（Vite + Rust 热重载）
```

### 8.2 生产构建
```bash
npm run tauri build  # 生成平台安装包
```

### 8.3 目标平台
- macOS（`.dmg` / `.app`）— Apple Silicon + Intel
- Windows（`.msi` / `.exe`）
- Linux（`.AppImage` / `.deb`）

### 8.4 构建产物
```
src-tauri/target/release/bundle/
├── dmg/pi-switch_0.4.0_aarch64.dmg
├── msi/pi-switch_0.4.0_x64.msi
├── appimage/pi-switch_0.4.0_amd64.AppImage
└── deb/pi-switch_0.4.0_amd64.deb
```

---

## 九、迁移步骤建议

### Phase 1：脚手架 + 核心读写
1. 初始化 Tauri 2.0 项目（`npm create tauri-app@latest`）
2. 配置 Vite + React + Tailwind
3. 实现 `pi_reader` 全部 Commands
4. 改造 `config-store.ts` 使用 invoke
5. 验证 Dashboard / Sessions / Memory / Settings 功能

### Phase 2：Providers & Models
1. 实现 Provider/Model 在线拉取 + 测试
2. 实现内置 Provider 目录读取
3. 验证 Providers 页面全部功能

### Phase 3：Chat
1. 实现 `chat_agent` 模块
2. 实现 SSE Channel 通信
3. 改造 `useAgentSession.ts`
4. 验证 Chat 页面全部功能

### Phase 4：Subagents + 收尾
1. 实现 Subagents 读取
2. YAML frontmatter 解析
3. 实现更新检查与扩展更新
4. 系统功能（主题/缩放/多语言）

### Phase 5：打包 + 测试
1. 多平台构建验证
2. 安装包签名（macOS notarization / Windows signtool）
3. 端到端功能测试

---

## 十、注意事项

### 10.1 pi SDK 依赖
当前项目依赖 `@earendil-works/pi-coding-agent`（npm 包）。Tauri 版本中：
- **方案 A**：在 Rust 端通过 `std::process::Command` 调用 pi 二进制
- **方案 B**：通过 Node.js 子进程桥接（Tauri 的 `tauri::process::Command`）
- **方案 C**：如果 pi 提供 Rust SDK，直接 FFI 调用

推荐 **方案 B**（Node 子进程），因为 pi SDK 是 Node.js 实现，直接复用成本最低。

### 10.2 文件监听
当前 pi 配置文件变更时，前端需要刷新。Tauri 版本中可使用：
- `tauri::watch::fs::watch` 监听 `~/.pi/agent/` 目录变化
- 通过 `window.emit()` 通知前端刷新

### 10.3 错误处理
- Rust 端使用 `Result<T, String>` 返回错误
- 前端统一错误展示（toast / error boundary）
- 文件操作失败时提供详细错误信息

### 10.4 性能
- 会话 JSONL 解析使用流式读取（`BufReader`），避免大文件 OOM
- 用量统计使用增量聚合，缓存结果
- 内置 Provider 目录读取结果缓存 5 分钟

---

## 十一、Rust 依赖（Cargo.toml）

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "socks"] }
chrono = "0.4"
walkdir = "2"
regex = "1"
glob = "0.3"
uuid = { version = "1", features = ["v4"] }
notify = "6"  # 文件变更监听
dirs = "5"    # 跨平台 home 目录

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

---

## 十二、验收标准

1. **功能对等**：Tauri 版本功能覆盖 Electron 版本 100%
2. **包体积**：macOS `.dmg` < 30MB（Electron 版本 ~150MB）
3. **启动速度**：冷启动 < 2s（Electron 版本 ~5s）
4. **内存占用**：空闲 < 100MB（Electron 版本 ~300MB）
5. **启动后首次数据加载**：< 500ms
6. **多平台**：macOS / Windows / Linux 均可正常安装运行
