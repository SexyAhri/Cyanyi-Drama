# Agent UI Template 开发计划与约束

这份文档是当前项目的主线说明。项目定位已经收口为通用 Agent UI 模板，不再内置登录、注册、后台模型管理、充值或业务产品逻辑。

## 1. 项目定位

本项目用于沉淀一套可复用的 Agent Chat UI 基座，后续可以复制到其他项目中继续扩展，例如迁移 `C:\Users\Administrator\Desktop\HomeCode\cyanyi-ai-image`。

核心目标：

- 提供稳定的 ChatGPT 风格侧边栏、顶栏、会话区和输入区。
- 提供统一的 `AgentMessage` / `AgentEvent` 协议。
- 支持普通聊天、流式输出、工具调用、工具状态、HITL 审批。
- 支持通用多模态 composer，包括聊天、图片生成、视频生成、模板提示词和媒体参数。
- 通过 adapter 接入不同运行时，UI 不直接绑定 AI SDK、LangGraph、OpenAI-compatible 服务或业务后端。
- 保持模板轻量，业务项目复制后再添加自己的功能模块。

非目标：

- 不做完整账号体系。
- 不做注册、登录、充值、套餐或用户额度。
- 不做 admin 后台。
- 不做服务端模型配置管理平台。
- 不把 `cyanyi-ai-image` 的图片、视频、收藏、支付等业务逻辑写进模板。

## 2. 当前技术栈

| 层级 | 技术 | 说明 |
| --- | --- | --- |
| 框架 | Next.js 16 App Router | 使用当前项目要求的 Next 16 |
| UI | shadcn/ui + Tailwind CSS 4 | 所有通用控件优先用 shadcn 组件组合 |
| 图标 | lucide-react | 按钮和工具入口优先使用图标 |
| 聊天运行时示例 | Vercel AI SDK | `/api/chat` 示例 |
| OpenAI-compatible 接入 | `@ai-sdk/openai-compatible` | Settings 面板输入 Base URL / API Key 后测试连接和请求模型 |
| HITL 示例 | LangGraph | `/chat/langgraph` 示例 |
| 多模态工具示例 | Mock AgentEvent | 图片和视频生成以 mock tool event 演示状态与结果展示 |
| 测试 | Vitest + TypeScript + ESLint | 覆盖事件合并、stream、mock adapter 和 shell utils |

## 3. 当前能力

- `/chat`：AI SDK 示例页面，支持 AI Gateway 或 OpenAI-compatible Base URL。
- `/chat/mock`：纯前端 mock runtime，用于稳定验证 UI 状态。
- `/chat/langgraph`：LangGraph interrupt / resume 示例。
- `/api/chat`：聊天事件流边界。
- `/api/models`：使用用户在 Settings 中输入的 Base URL / API Key 代理获取模型列表。
- `/api/templates`：图片模板图库数据代理。
- `/api/template-image`：图片模板缩略图代理。
- `/api/agent`：LangGraph HITL 示例边界。
- 多模态 composer：支持聊天、图片生成、视频生成。
- 图片参数：模型、比例、分辨率、格式、风格、模板提示词。
- 视频参数：模型、时长、比例、分辨率、格式。
- Tool renderer：支持 `image_generation`、`video_generation`、`mock_weather` 的专用结果卡。
- 顶栏语言切换：支持 `en` 与 `zh-CN`。
- 顶栏模型连接状态：显示 idle/loading/success/error。
- 设置面板运行时连接：Base URL、API Key、显示/隐藏 Key、清空配置、测试连接、错误提示。
- 会话侧边栏：新建会话、历史会话选择、搜索、归档、运行时示例入口。

## 4. 目录结构

```txt
app/
  chat/
    page.tsx
    chat-client.tsx
    mock/page.tsx
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

components/
  agent/
    chat.tsx
    chat/
    shell/
    message/
    tool/
    composer/
    input/
    debug/
  ui/

hooks/
  use-agent.ts
  use-runtime-connection.ts

lib/
  agent/
    adapter.ts
    ai-sdk-adapter.ts
    events.ts
    langgraph-adapter.ts
    langgraph-runtime.ts
    mock-adapter.ts
    stream.ts
    types.ts
```

模块职责：

- `components/agent/chat`：聊天容器与会话状态组合。
- `components/agent/shell`：侧边栏、顶栏、面板、i18n、shell 数据和工具函数。
- `components/agent/message`：消息列表、气泡、Markdown。
- `components/agent/tool`：工具卡片、审批按钮、工具展示 registry。
- `components/agent/composer`：多模态 composer、参数配置、模板图库和模板数据获取。
- `components/agent/input`：输入区。
- `hooks/use-agent.ts`：事件归并、消息发送、审批操作。
- `hooks/use-runtime-connection.ts`：本地开发用模型连接配置和模型列表获取。
- `lib/agent`：协议类型、事件合并、stream 工具、runtime adapters。

## 5. 核心边界

数据流：

```txt
runtime route -> AgentEvent stream -> AgentAdapter -> useAgent -> AgentMessage[] -> components/agent
```

边界规则：

- `components/agent` 只消费 `AgentMessage[]` 和 props。
- UI 组件不得直接 import AI SDK、LangGraph、OpenAI、MCP 或业务后端 SDK。
- 运行时差异必须放在 adapter、route 或 service 层。
- 工具调用统一通过 `ToolCard` 渲染。
- 审批动作统一通过 `AgentAdapter.resolveApproval`。
- 新运行时必须实现 `AgentAdapter` 并输出 `AgentEvent`。
- 示例页面只负责组合 adapter、`useAgent` 和 `Chat`。

## 6. 运行时连接策略

模板保留前端 Settings 面板里的 Base URL / API Key 配置，只用于本地调试、模板验证和轻量集成验证。

当前行为：

- 配置保存在浏览器 `localStorage`。
- `/api/models` 使用该配置请求 OpenAI-compatible 服务的 `/models`。
- `/api/chat` 会从请求 metadata 中读取 `baseUrl`、`apiKey` 和 `model`，通过 AI SDK OpenAI-compatible provider 请求。
- 如果没有运行时配置且没有 `AI_GATEWAY_API_KEY`，`/api/chat` 走本地 deterministic fallback。
- 如果 composer 选择图片或视频模式，`/api/chat` 先输出 mock 媒体生成 tool event，用于验证 UI、参数和结果卡。

生产建议：

- 如果业务项目需要账号、计费、模型白名单或服务端 Key 管理，应在复制模板后替换 `use-runtime-connection.ts` 与相关 route。
- 生产环境不要把真实共享 API Key 暴露给所有终端用户。
- 模板不负责 new-api、充值、用户额度或 admin 配置，这些属于宿主业务项目。

## 7. 数据模型

UI 最终消费 `AgentMessage`：

```ts
export type AgentMessageRole = "user" | "assistant" | "tool";

export type ToolCallStatus =
  | "pending"
  | "approved"
  | "denied"
  | "running"
  | "done"
  | "error";

export type AgentToolCall = {
  id: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  approvalId?: string;
  result?: unknown;
  error?: string;
};

export type AgentMessage = {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt?: string;
  toolCall?: AgentToolCall;
  metadata?: Record<string, unknown>;
};
```

运行时输出 `AgentEvent`，由 `useAgent` 合并成 `AgentMessage[]`。展示组件不做事件归并。

## 8. 开发阶段状态

已完成：

- Next.js 16 项目初始化。
- shadcn/ui 组件引入。
- ChatGPT 风格 shell。
- 模块化目录结构。
- 中英文 i18n 基础。
- mock runtime。
- AI SDK runtime。
- OpenAI-compatible Base URL / API Key 调试配置。
- 模型列表测试连接。
- LangGraph HITL 示例。
- ToolCard 和 ApprovalButtons。
- 多模态 composer：图片/视频模式、比例、分辨率、格式、风格、时长和模板图库。
- 图片/视频 mock tool renderer。
- Debug panel。
- 文档和迁移指南初版。

当前收口任务：

- 保持模板定位，不继续加入登录注册、admin 或充值。
- 维护文档与实现一致。
- 保持 `components/agent` 可复制、可迁移。

## 9. 测试与验收

提交前至少运行：

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

手动检查：

- `/chat` 可以打开并发送消息。
- `/chat` 中图片模式可以选择比例、分辨率、格式、风格和模板。
- `/chat` 中视频模式可以选择模型、时长、比例、分辨率和格式。
- 图片或视频模式发送后，工具卡可以展示 mock 生成结果和格式参数。
- Settings 中 Base URL / API Key 可以测试连接。
- 模型下拉框打开时可以刷新模型。
- 顶栏连接状态正确变化。
- `/chat/mock` 的工具成功、失败、审批场景可用。
- `/chat/langgraph` 的审批示例可用。
- 中文/英文切换不出现乱码。

## 10. 迁移 `cyanyi-ai-image` 建议路线

建议先复制这个模板作为新项目基座，再按业务模块迁移，避免直接把旧项目代码大块塞进模板。

推荐顺序：

1. 复制模板并确认基础聊天、模型连接、mock runtime 可运行。
2. 新建业务模块目录，例如 `features/image-generation`、`features/gallery`、`features/history`。
3. 先迁移图片生成工具链：参数表单、生成请求、结果数据结构。
4. 把图片生成过程映射成 `AgentEvent`，让现有 Chat/ToolCard 展示执行状态。
5. 再迁移图片结果卡、预览、下载、收藏、历史记录。
6. 最后迁移视频、批量任务、用户资产、支付或 new-api 对接等产品级能力。

迁移原则：

- 业务状态和接口放在 `features/*`、`app/api/*` 或 service 层。
- 通用聊天 UI 不直接理解“图片生成平台”的业务协议。
- 图片、视频等结果如果需要专用展示，可以在 tool registry 中注册 renderer，而不是复制一套工具状态 UI。
- 先保留 mock 场景，确保每个业务工具都有可复现的成功、失败、运行中状态。

## 11. 开发约束

- 文件结构必须按模块划分。
- 不要把代码全塞进一个文件。
- 单文件接近 500 行时优先拆分，禁止写成上千行的大组件。
- 可复用 UI、数据配置、工具函数和类型要提出来。
- 组件组合优先数据驱动：展示组件通过 props 接收数据和回调。
- 状态管理、数据变换、运行时协议留在 hooks、adapters、routes 或 container 层。
- sidebar、topbar、panel 等 shell 区域必须独立组件化，不塞进 `Chat`。
- 通用控件优先使用 shadcn/ui 组件组合。
- 新用户可见文案需要进入 i18n 文件。
- 不把业务产品功能提前写进模板。
- 不提交 `.next`、`node_modules`、dev log、tsbuildinfo 等生成物。
