# Cyanyi Drama

Cyanyi Drama 是一个面向 AI 漫剧和短剧创作的智能工作台。

项目以对话式创作为入口，逐步接入剧本分析、角色与场景设计、分镜、图片生成、视频生成和后续内容生产流程。当前版本优先完成模型接入、渠道管理、媒体任务和用户数据基础设施，业务创作模块会持续扩展。

## 当前能力

- ChatGPT 风格的聊天工作台、侧边栏、会话列表和设置中心
- 中文 / 英文界面基础支持
- 文本聊天、图片生成、视频生成模式
- 图片和视频生成工具卡，展示等待、执行、成功和失败状态
- OpenAI 兼容协议、Anthropic、Google Gemini、火山方舟协议
- 从服务商真实接口获取模型列表，不使用内置假模型
- 多渠道配置，每个渠道独立保存 Base URL、协议、多个 API Key 和模型
- 选中模型后自动根据所属渠道路由请求
- 图片、视频媒体任务状态持久化和查询
- 统一媒体任务系统：幂等创建、队列重试、进度、取消、事件记录和失败恢复
- 匿名用户 Session，以及注册、登录、退出接口
- API Key 加密保存，MySQL 数据库持久化
- 漫剧项目、项目配置和剧集数据持久化
- 结构化角色、角色形象、场景、场景图和分镜草稿持久化
- 工作流运行、步骤门禁、暂停、恢复、重试、取消和事件流水
- 真实文本模型驱动的剧集解析，可产出角色、场景和分镜草稿
- 角色/场景图片生成任务可回填业务资产引用
- 角色/场景图片批量生成，并自动携带已选资产作为一致性参考
- 项目/剧集接口按当前用户隔离，媒体任务可关联项目和剧集
- LangGraph Human-in-the-loop 示例运行时

## AI 漫剧方向

Cyanyi Drama 的目标不是单纯提供一个聊天窗口，而是把 AI 能力组织成一条可复用的漫剧生产链：

1. 输入小说、故事梗概或创意描述。
2. 通过文本模型进行故事分析、角色提取和场景拆解。
3. 通过图片模型生成角色、场景和分镜素材。
4. 通过视频模型生成镜头片段和动态内容。
5. 在后续模块中继续接入配音、口型同步、剪辑和成片输出。

当前项目处于基础能力建设阶段，模型协议和媒体任务链路已经具备，完整的一键式漫剧流程会在此基础上逐步加入。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 应用框架 | Next.js 16 App Router |
| UI | React 19、shadcn/ui、Base UI、Tailwind CSS 4 |
| AI Runtime | Vercel AI SDK 7、LangGraph |
| 模型协议 | OpenAI Compatible、Anthropic、Google Gemini、Volcengine Ark |
| 数据库 | Prisma ORM / MySQL 8.4 |
| 队列与缓存 | Redis、BullMQ |
| 对象存储 | S3 兼容存储（本地开发使用 MinIO） |
| 认证 | HttpOnly Session Cookie |
| 测试 | Vitest、TypeScript、ESLint |

## 快速开始

要求：Node.js 20+ 和 pnpm。

```bash
pnpm install
docker compose up -d
pnpm db:push
pnpm dev
```

打开：

```text
http://localhost:3000/chat
```

运行检查：

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

## 环境变量

复制环境变量示例：

```bash
cp .env.example .env.local
```

常用配置：

```env
# 用于加密数据库中的 API Key。部署时请替换为随机长字符串。
APP_SECRET=change-me

# 可选：AI SDK Gateway 凭据。
AI_GATEWAY_API_KEY=
```

也可以直接在设置中心填写服务商 Base URL 和 API Key。API Key 由服务端加密保存，不依赖浏览器 localStorage 作为唯一数据源。

## 用户身份和数据

用户、Session、渠道、模型、项目和媒体任务统一保存到 MySQL，连接地址由 `DATABASE_URL` 配置。Redis 用于 BullMQ 队列、任务事件和分布式锁；媒体文件使用 S3 兼容对象存储，默认连接本地 MinIO。项目不使用本地数据库文件。

系统首次访问时会自动创建匿名用户和 HttpOnly Session。账号接口如下：

- `GET /api/auth/session`：获取当前用户，没有 Session 时创建匿名用户
- `POST /api/auth/register`：注册账号
- `POST /api/auth/login`：登录
- `POST /api/auth/logout`：退出登录

匿名用户注册后，已有渠道和媒体任务会尝试迁移到正式账号。

## 渠道和模型

设置中心支持创建、复制、编辑和删除渠道。每个渠道包含：

- 渠道名称和协议类型
- Base URL
- 一个或多个 API Key
- 从接口获取的模型列表
- 选中的模型及其能力类型

相关接口：

- `GET /api/channels`：读取当前用户的渠道和模型
- `PUT /api/channels`：创建或更新渠道、Key 和模型选择
- `DELETE /api/channels?id=...`：删除渠道
- `POST /api/models`：从服务商接口获取模型列表

模型列表必须由实际渠道接口返回。调用文本、图片或视频模型时，系统会依据选中的模型自动选择对应渠道和 API Key。

## 聊天和媒体任务

- `/api/chat`：文本聊天、工具调用、图片生成和视频生成事件流
- `GET /api/media/tasks`：读取当前用户的媒体任务
- `GET /api/media/tasks/:taskId`：读取单个媒体任务
- `/api/agent`：LangGraph HITL 示例运行时

图片、视频和语音任务会经过统一状态机，记录 queued、running、succeeded 和 failed 等状态，并按用户隔离查询。火山方舟的视频生成支持异步创建、轮询和结果处理。服务商返回的媒体会优先转存到 S3/MinIO，并通过媒体资产接口返回签名 URL。

媒体任务接口还支持：

- `POST /api/media/tasks`：创建并入队任务，支持 `idempotencyKey`
- `GET /api/media/tasks/:taskId`：读取任务及事件流水
- `POST /api/media/tasks/:taskId`：使用 `{ "action": "cancel" }` 取消任务，或使用 `{ "action": "retry" }` 重试失败任务

Worker 不会在没有实际服务商处理器时伪造成功状态；未接入的任务类型会明确失败并保留可重试错误，避免媒体任务出现假成功。

## 项目接口

- `GET /api/projects`：分页读取当前用户的漫剧项目
- `POST /api/projects`：创建项目并初始化项目配置
- `GET/PATCH/DELETE /api/projects/:projectId`：读取、更新和删除项目
- `GET /api/projects/:projectId/data`：一次读取项目配置和剧集列表
- `GET/POST /api/projects/:projectId/episodes`：读取和创建剧集
- `PATCH/DELETE /api/projects/:projectId/episodes/:episodeId`：编辑和删除剧集
- `GET/PATCH /api/projects/:projectId/config`：读取和更新项目级模型、画幅、画风等配置
- `GET/PUT /api/projects/:projectId/characters`：读取和保存角色草稿
- `GET/PUT /api/projects/:projectId/locations`：读取和保存场景草稿
- `GET/PUT /api/projects/:projectId/props`：读取和保存道具草稿
- `GET/PUT /api/projects/:projectId/episodes/:episodeId/storyboard`：读取和保存分镜草稿
- `POST /api/projects/:projectId/episodes/:episodeId/parse`：创建真实文本解析工作流
- `POST /api/projects/:projectId/assets/generate`：创建角色或场景图片任务
- `POST /api/projects/:projectId/assets/generate-batch`：批量创建角色或场景图片任务，默认复用已选参考图
- `POST /api/projects/:projectId/assets/select`：确认角色、场景或分镜图片/视频资产为当前基准资产（分镜通过 `assetKind: "image" | "video"` 区分）
- `POST /api/projects/:projectId/episodes/:episodeId/storyboard/:panelId/generate`：根据分镜格和已确认资产生成分镜图片
- `POST /api/projects/:projectId/episodes/:episodeId/storyboard/generate-batch`：批量生成剧集分镜图片
- `POST /api/projects/:projectId/episodes/:episodeId/storyboard/:panelId/generate-video`：根据分镜格、分镜图片和已确认资产生成视频片段
- `POST /api/projects/:projectId/episodes/:episodeId/storyboard/generate-video-batch`：批量生成剧集视频片段
- `GET/PUT /api/projects/:projectId/episodes/:episodeId/production`：读取和保存 Clip、Shot、语音行和编辑时间线
- `POST /api/projects/:projectId/episodes/:episodeId/production/timeline`：根据 Clip/Shot 和语音行生成时间线、字幕草稿
- `GET/PUT /api/projects/:projectId/voice-presets`：读取和创建项目音色预设
- `POST /api/projects/:projectId/episodes/:episodeId/voice-lines/:lineId/generate`：通过真实音频模型生成语音行
- `POST /api/projects/:projectId/episodes/:episodeId/audio/merge`：创建音频合并任务
- `POST /api/projects/:projectId/episodes/:episodeId/lip-sync`：创建口型同步任务
- `POST /api/projects/:projectId/episodes/:episodeId/render`：创建时间线渲染任务
- `GET /api/media/assets/:assetId`：读取媒体资产并生成对象存储签名 URL
- `GET/POST /api/media/batches/:batchId`：读取批次汇总，批量取消或重试失败任务
- `GET /api/projects/:projectId/workflows`：读取项目工作流
- `GET/POST /api/workflows/:runId`：读取、暂停、恢复、重试或取消工作流

## 目录结构

```text
app/                       页面和 API 路由
components/agent/          聊天、Composer、设置和工具 UI
components/ui/             通用 UI 组件
hooks/                     聊天、模型和运行时状态
lib/agent/                 Agent 事件、适配器、协议和流处理
lib/media/                 媒体任务契约和存储
lib/server/                Prisma、认证和密钥加密
lib/queue/                 Redis/BullMQ 队列和任务事件
lib/storage/               S3 兼容对象存储适配器
lib/worker/                BullMQ Worker 入口
docs/                      集成、工具扩展和项目说明
```

## 后续规划

- 角色和场景一致性工作流：批量资产生成、失败重试和结果确认
- 小说到剧本、角色、场景和分镜的多阶段结构化流水线
- 角色一致性和场景一致性工作流
- 配音、音频设计、口型同步和字幕
- 视频片段编排、剪辑和成片导出
- 更完善的任务队列、重试、配额和审计能力
- 生产环境的 MySQL、Redis 和 S3 兼容存储部署方案

## 开发原则

- UI、业务流程和模型协议保持清晰边界。
- 模型必须从配置渠道的真实接口获取，不在生产逻辑中写死假模型。
- API Key、Session 和用户数据由服务端处理。
- 媒体任务统一经过状态机，并按用户隔离。
- 新增能力优先通过协议适配器和 Agent 事件接入，避免把服务商逻辑散落到 UI 中。
- 新增用户可见文案时同步补充国际化内容。

## 文档

- [集成指南](docs/integration-guide.md)
- [项目结构](docs/project-structure.md)
- [添加工具](docs/adding-tools.md)
- [HITL 后端要求](docs/hitl-backend.md)
- [示例页面](docs/examples.md)
- [模板迁移说明](docs/template-migration.md)
- [开发计划](AGENT_UI_TEMPLATE_PLAN.md)

## 项目状态

Cyanyi Drama 仍在快速开发中。协议适配、模型路由和媒体任务基础能力已经接通，但完整的一键式 AI 漫剧生产流程仍在建设。欢迎通过 Issue 反馈问题和建议。
