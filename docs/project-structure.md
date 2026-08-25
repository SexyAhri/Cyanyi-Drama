# 项目结构说明

本项目按“模板核心、运行时示例、宿主项目扩展点”划分。迁移到业务项目时，优先保持这些边界不变。

## 顶层目录

```txt
app/          Next.js App Router 页面与 API routes
components/   shadcn/ui 基础组件与 Agent UI 模板组件
docs/         使用、迁移、扩展与后端约定文档
hooks/        可复用前端状态 hook
lib/          Agent 协议、adapter、stream、runtime 示例
public/       静态资源
```

不属于源码结构的生成产物：

```txt
.next/
node_modules/
next-env.d.ts
tsconfig.tsbuildinfo
dev-server*.log
```

这些文件或目录由工具生成，已经通过 `.gitignore` 排除。

## `app`

```txt
app/
  page.tsx
  layout.tsx
  globals.css
  chat/
    page.tsx
    chat-client.tsx
    langgraph/page.tsx
  api/
    chat/route.ts
    models/route.ts
    templates/route.ts
    template-image/route.ts
    agent/
      route.ts
      approve/route.ts
      deny/route.ts
      runs/[runId]/route.ts
```

职责：

- `app/chat/*` 只放示例页面组合逻辑。
- `app/api/chat` 是 AI SDK / OpenAI-compatible 示例边界。
- `app/api/models` 是 Settings 面板测试模型连接的代理接口。
- `app/api/templates` 是图片模板图库的数据代理接口。
- `app/api/template-image` 是外部模板缩略图代理，避免模板图库直接依赖不稳定的远程图片域名。
- `app/api/agent/*` 是 LangGraph HITL 示例边界。
- 不在 `app/chat` 里写通用 UI 逻辑，也不在 `app/api` 里写展示组件逻辑。

## `components/agent`

```txt
components/agent/
  chat.tsx
  chat/
  shell/
  message/
  tool/
  composer/
  input/
  debug/
```

职责：

- `chat.tsx` 是兼容导出入口，方便外部 `import { Chat } from "@/components/agent/chat"`。
- `chat/` 负责聊天容器、默认模型、默认建议、消息映射和 thread hook。
- `shell/` 负责侧边栏、顶栏、设置面板、搜索、归档、帮助、i18n 和 shell 数据。
- `message/` 负责消息列表、消息气泡和 Markdown 展示。
- `tool/` 负责工具卡片、审批按钮和工具展示 registry。
- `composer/` 负责多模态输入区，包含聊天、图片生成、视频生成、比例、分辨率、格式、风格、时长和模板图库。
- `input/` 负责输入区。
- `debug/` 负责开发调试面板。

约束：

- `components/agent` 不能 import AI SDK、LangGraph、OpenAI、MCP 或业务项目模块。
- shell 组件不能塞进 `Chat` 文件里。
- 可复用区域要拆成独立文件。
- 用户可见 shell 文案统一进入 `chat-shell-i18n.ts`。
- `ShellAccountMenu` 的 `onLogout` 只是宿主项目扩展点；模板本身不实现登录、注册或会话认证。
- 图片和视频生成相关参数留在模板 UI 中，但真实服务调用必须通过宿主项目路由或 provider adapter 完成。

## `components/ui`

`components/ui` 是 shadcn/ui 组件和 chatbot kit 相关基础组件集合。业务和模板组件都应优先复用这些组件组合，而不是重新手写一套基础控件。

原则：

- 按 shadcn 组件方式组合 UI。
- 基础 UI 组件保持通用，不带 Agent 业务状态。
- 需要新增基础组件时，先确认 shadcn 是否已有合适组件。

## `hooks`

```txt
hooks/
  use-agent.ts
  use-runtime-connection.ts
  use-auto-scroll.ts
  use-autosize-textarea.ts
  use-audio-recording.ts
  use-copy-to-clipboard.ts
  use-mobile.ts
```

职责：

- `use-agent.ts` 是 Agent UI 的核心状态 hook，负责发送消息、合并事件、审批操作。
- `use-runtime-connection.ts` 只服务模板本地调试，用于 Base URL / API Key / 模型列表。
- 其他 hooks 是通用交互能力。

如果生产业务项目不希望前端保存 Key，可以替换 `use-runtime-connection.ts` 和对应 API route。

## `lib/agent`

```txt
lib/agent/
  adapter.ts
  ai-sdk-adapter.ts
  events.ts
  langgraph-adapter.ts
  langgraph-runtime.ts
  stream.ts
  types.ts
```

职责：

- `types.ts` 定义 `AgentMessage`、`AgentEvent`、Tool call 等协议类型。
- `events.ts` 负责把事件合并为 UI 消息状态。
- `adapter.ts` 定义 runtime adapter 接口。
- `stream.ts` 负责 NDJSON event stream 编解码。
- `ai-sdk-adapter.ts` 和 `langgraph-adapter.ts` 是示例 runtime adapter。
- `langgraph-runtime.ts` 是 LangGraph 示例后端逻辑，不属于 UI 核心。

## 迁移扩展建议

复制到业务项目后，建议新增业务模块目录，例如：

```txt
features/
  image-generation/
  gallery/
  history/
  billing/
```

业务模块可以调用模板组件，但模板组件不要反向 import 业务模块。

图片生成、视频生成、充值、用户系统、new-api 对接等都应该作为宿主项目功能添加，不进入通用模板核心。

如果业务项目要接真实媒体生成服务，建议：

- 在 `features/image-generation` 或 `features/video-generation` 中维护服务商参数映射。
- 将 `composer` metadata 转换为业务 API 请求参数。
- 将生成任务状态转换为 `AgentEvent`。
- 需要更复杂结果展示时，在 `components/agent/tool/tool-registry.tsx` 注册专用 renderer。
