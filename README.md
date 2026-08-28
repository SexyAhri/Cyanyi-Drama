# Cyanyi Drama

Cyanyi Drama 是一个面向 AI 漫剧和短剧创作的智能工作台。

项目以 `/chat` 对话式创作为主入口，并通过 `/projects` 进入专业漫剧工作台。普通问答、图片与视频生成和项目制片共用同一套渠道、模型与媒体任务基础设施；项目工作台按编剧、资产、分镜、镜头、声音和交付六个阶段组织生产。

## 当前能力

- ChatGPT 风格的聊天工作台、侧边栏、会话列表和设置中心
- `/chat` 与漫剧项目双向导航，根路由默认进入聊天主界面
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
- 项目图片/视频上传、来源追踪、参考图转角色和视觉资产提取
- 整本小说标记分集与 AI 边界分集，支持安全批量落库
- 模型级 OpenAI Compatible 媒体模板，支持同步、异步和显式空字段省略
- 媒体冻结、结算、释放与用量的幂等对账，Worker Watchdog 自动补偿
- Workflow Run、Step、Prompt 与 Media Task 的统一 Trace ID 和父子 Span
- 13 个领域 Prompt 的双语 Canary Hash 与 Agent 行为门禁
- 图片、异构视频和音轨统一转码为确定规格的 MP4 成片
- 项目/剧集接口按当前用户隔离，媒体任务可关联项目和剧集
- 六阶段漫剧工作区：编剧、资产、分镜、镜头、声音和交付
- 逐步骤工作流与逐素材任务视图，展示具体部门、角色、场景、道具或镜头名称
- 工作流步骤和媒体任务支持独立失败原因、重试、取消及 Trace 查看
- 镜头图片与视频候选素材可预览、选择、上传、删除和批量生成
- 固定高度制作工作区，长列表和详情仅在各自区域内滚动
- LangGraph Human-in-the-loop 示例运行时

## 产品入口

- `/chat`：默认主界面，用于对话、图片生成、视频生成和渠道设置；桌面侧栏及移动端顶栏均可进入漫剧创作。
- `/projects`：漫剧项目列表，用于创建、搜索和打开项目。
- `/projects/:projectId`：项目制作工作区；URL 会保留剧集和制作阶段，工作区顶栏可返回项目列表或 AI 对话。

项目右侧的上下文 Agent 读取当前项目、剧集、阶段和选中实体，处理项目内检查与操作；`/chat` 保持通用创作入口。二者共享基础能力，但不会把完整制片界面塞入普通聊天窗口。

## AI 漫剧方向

Cyanyi Drama 的目标不是单纯提供一个聊天窗口，而是把 AI 能力组织成一条可复用的漫剧生产链：

1. 输入小说、故事梗概或创意描述。
2. 通过文本模型进行故事分析、角色提取和场景拆解。
3. 通过图片模型生成角色、场景和分镜素材。
4. 通过视频模型生成镜头片段和动态内容，并复用已确认分镜图作为参考。
5. 分析对白与内心独白，按模型能力生成声音、音效或口型同步素材。
6. 编排时间线、字幕和后期交付物，经过质量检查后输出成片。

当前版本已经形成可操作的六阶段生产工作区。文本、图片、视频、声音和交付是否能完整跑通，取决于所配置渠道的真实模型能力；系统不会用假结果掩盖未接入、余额不足或服务商拒绝等错误。

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

媒体生成和工作流任务需要在另一个终端启动 Worker：

```bash
pnpm worker
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

# 可选：OpenAI Compatible 参考图编辑端点及 multipart 文件字段。
OPENAI_COMPATIBLE_IMAGE_EDIT_PATH=images/edits
OPENAI_COMPATIBLE_IMAGE_EDIT_FILE_FIELD=image[]
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

OpenAI Compatible 图片/视频模型可在 `models[].capabilities.mediaTemplate` 中保存模型级媒体模板。模板支持自定义创建、状态、内容端点和 JSONPath 响应映射；只允许访问渠道 Base URL 的同源端点。无参考图时默认调用 `images/generations`，有参考图时通过 `images/edits` 的 multipart 请求提交，不会静默丢弃参考图或降级模型。配置细节见 [M5 外部资产与媒体模板](docs/m5-external-capabilities.md)。

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
- `POST /api/projects/:projectId/assets/upload`：上传项目图片或视频，并记录所有权、来源和目标实体引用
- `POST /api/projects/:projectId/assets/reference-to-character`：使用已归属项目的参考图生成角色外观，或只提取角色描述
- `POST /api/projects/:projectId/assets/extract`：从项目图片或视频抽帧中提取角色、场景和道具，可选择落库
- `POST /api/projects/:projectId/assets/select`：确认角色、场景或分镜图片/视频资产为当前基准资产（分镜通过 `assetKind: "image" | "video"` 区分）
- `POST /api/projects/:projectId/episodes/split`：整本小说自动选择标记分集或 AI 分集，可选择事务化创建剧集
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
- `POST /api/workflows/:runId/steps/:stepKey/retry`：只重试一个失败且仍可重试的工作流步骤

## 制作任务与失败恢复

右侧任务面板把一个 Workflow Run 拆成独立步骤展示，例如“编剧-小说解析”“编剧-剧情分片”“编剧-剧本转换”；媒体任务会解析业务目标并显示“角色-韩宇-素材生成”或“分镜-镜头 03-图片生成”等名称。

失败操作遵循以下边界：

- 工作流步骤只有在服务端标记为 `retryable` 且尚未达到最大尝试次数时显示重试。
- 媒体任务在 `retryCount < maxRetries` 时允许独立重试，不需要重跑整个批次。
- 服务商错误、超时、余额不足和响应格式异常会保留在任务记录及 Trace 中。
- 删除仅用于已取消或失败的媒体任务；工作流历史仍保留用于审计和恢复。

## 目录结构

```text
app/                       页面和 API 路由
components/agent/          聊天、Composer、设置和工具 UI
components/ui/             通用 UI 组件
features/studio/           六阶段漫剧工作区、上下文 Agent 和制作视图
hooks/                     聊天、模型和运行时状态
lib/agent/                 Agent 事件、适配器、协议和流处理
lib/media/                 媒体任务契约和存储
lib/providers/             各服务商独立的文本、图片、视频和声音适配器
lib/server/                Prisma、认证和密钥加密
lib/queue/                 Redis/BullMQ 队列和任务事件
lib/storage/               S3 兼容对象存储适配器
lib/worker/                BullMQ Worker 入口
docs/                      集成、工具扩展和项目说明
```

## 后续规划

- 强化小说到剧本的影视化补全、内心独白归属和镜头过渡连续性
- 建立跨剧集锁定的角色三视图、场景空间、道具和视觉一致性基准
- 完善长镜头逐秒动作规划、机位连续性和重复主体检测
- 扩充不同服务商端点的兼容性矩阵与真实模型集成测试
- 根据视频原生声音能力完善对白、音效、配音和字幕的混合交付策略
- 增加批量任务背压、并发预算、成本上限和更完整的交付 QC
- 完善生产环境的 MySQL、Redis 和 S3 兼容存储部署方案

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
- [全链路开发计划（M0-M7）](docs/backend-parity-roadmap.md)
- [Agent UI 模板历史计划](AGENT_UI_TEMPLATE_PLAN.md)
- [M5 外部资产与媒体模板](docs/m5-external-capabilities.md)

## 项目状态

Cyanyi Drama 仍在快速开发中。六阶段工作区、模型路由、媒体任务、失败恢复和基础交付链路已经接通；真实服务商下的长篇连续性、视频与声音策略以及批量稳定性仍在持续验证。欢迎通过 Issue 反馈问题和建议。
