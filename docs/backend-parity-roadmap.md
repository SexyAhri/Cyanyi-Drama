# Cyanyi-Drama 全链路开发计划

## 1. 开发目标

在不照搬第三方 UI 或受限源码的前提下，使 Cyanyi-Drama 的影视生产工作流逐步达到同类成熟工具的行为能力，同时保留现有媒体任务 SSE、Fal/Vidu/百炼口型同步、音频合并和 Timeline Render，并为这些能力建设统一的生产工作台。

开发顺序固定为：稳定基线、工作流可靠性、Prompt 与领域 Agent、两条生产工作流、外部能力、质量体系、生产工作台、专业影视部门编排。功能只有通过对应恢复测试和验收门禁后才算完成。

## 2. 交付原则

- 开始新增工作流行为前，必须先形成干净且经过验证的代码基线。
- 每个 clip 或 phase 完成后立即持久化，禁止等整个 Run 结束后集中保存。
- Workflow、Task、Billing 和领域数据必须能够独立恢复与对账。
- 生产环境必须拒绝缺失或公开默认的密钥，媒体访问必须校验用户或项目所有权。
- 每个里程碑同步增加测试，不把回归测试推迟到最后补。
- 保留现有 FFmpeg Render、音频合并、媒体 SSE 和三家 Lip Sync Provider。
- M7 前端只消费真实 API、Workflow、Media Task、Worker、Trace 和领域数据；禁止用定时器或本地假数据伪造执行进度与成功结果。
- UI 维持 `shadcn/ui + Base UI + Tailwind semantic tokens + lucide-react` 技术边界，不为模仿参考项目引入另一套组件系统。

## 3. 里程碑总表

| 编号 | 状态 | 预估 | 交付内容 | 验收门禁 |
| --- | --- | ---: | --- | --- |
| M0 | 已完成 | 1-2 天 | 分类当前工作树、删除空迁移和生成物、强制生产 `APP_SECRET`、验证 Prisma Schema 和迁移、通过类型与测试、提交现有基线 | 跟踪文件干净；没有密钥和空迁移；全新数据库迁移成功；类型检查和测试通过 |
| M1 | 已完成 | 3-5 天 | 活动 Run 复用、目标级去重、Run 租约抢占和续租、孤儿任务补偿、取消超时、`Retry-After` | 重复请求只返回一个活动 Run；第二个 Worker 无法执行已租用 Run；过期任务可恢复且不重复计费 |
| M2 | 已完成 | 3-4 天 | Prompt 目录、Prompt ID、中英模板、变量契约、版本 Hash、`jsonrepair + Zod`、纠错重试 | 缺失或多余变量稳定失败；畸形 JSON 可修复或重试；Prompt 契约测试通过 |
| M2.5 | 已完成 | 2-3 天 | Agent Contract V2、System/User 分层、领域语义 Validator、证据链、连续性监督、结构化 Trace | 语义失败只做定向修复且不跨 Key 重复；Trace 可追踪 Prompt、模型、纠错和 Token 用量 |
| M3 | 已完成 | 4-6 天 | Story-to-Script：并行角色/场景/道具分析、边界校验切片、逐 clip 剧本转换、增量 Artifact | 单个 clip 可独立重试；Worker 中断后成功 clip 不丢失；原文无重叠和缺口 |
| M4 | 已完成 | 5-7 天 | Script-to-Storyboard：规划、摄影、表演、细化、台词分析、clip/phase 级失效重试 | 重试一个 phase 只失效其下游；其他 clip 不变化；分镜和台词输出通过 Schema 校验 |
| M5 | 已完成 | 4-6 天 | 资产上传、参考图转角色、资产提取、标记/AI 分集、OpenAI Compatible 媒体模板、空字段显式省略 | 新 Provider 无需修改 Worker 核心代码；上传和提取资产保留所有权与来源 |
| M6 | 已完成 | 3-5 天 | 计费对账、结构化 Trace、Prompt Canary、行为 Guard、渲染规格归一化、系统回归测试 | 对账幂等；Run/Task/Step 可串联追踪；混合媒体输入能生成规格统一的成片 |
| M7 | 已完成 | 12-18 天 | 项目首页、全屏生产工作台、六阶段创作导航、上下文 Agent、任务与 Trace 可观测、响应式与无障碍 | 现有生产 API 均有可操作入口；刷新可恢复真实状态；失败可定位、取消或重试；桌面与移动端关键流程可用 |
| M8 | 进行中 | 18-26 天 | 电影级部门 Agent、制作圣经、剧本拆解、视觉开发、Previs、VFX、声音后期、调色与交付 QC、审批门和资源编排 | 每个部门有类型化交付物、负责人、依赖和质量门；单次失败可降级或精确恢复；完成一集可审计的端到端制作 |

## 4. M0 当前基线任务表

| 任务 | 目标文件或模块 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| 分类现有改动 | Git 工作树和迁移目录 | 每个文件归类为提交、删除或仅本地保留 | 已完成 |
| 删除空迁移 | `20260825162000_production_tasks` | Prisma 不再报 `P3015` | 已完成 |
| 强化应用密钥 | `lib/server/crypto.ts`、`lib/storage/local.ts`、`.env.example` | 生产环境缺少或使用公开值时失败 | 已完成 |
| 验证 Schema | `prisma/schema.prisma` | `prisma validate` 成功 | 已完成 |
| 验证完整迁移 | 11 组非空 Migration | 全新 MySQL 数据库执行成功且无 Schema 漂移 | 已完成 |
| 验证代码 | 当前源码和测试 | TypeScript、测试、变更文件 ESLint 通过 | 已完成 |
| 提交现有基线 | 当前需要交付的源码、迁移、配置和测试 | Staged Diff 不含本地文件、密钥和生成物 | 已完成 |

## 5. M1 工作流可靠性任务表

| 任务 | 目标模块 | 验收测试 | 状态 |
| --- | --- | --- | --- |
| 活动 Run 复用 | `lib/workflow/store.ts`、Workflow POST API | 同一用户、项目、工作流和目标的两次提交返回相同 Run | 已完成 |
| Run 租约 | Prisma、Workflow Runtime、Worker | 并发 Worker 只有一个租约持有者，心跳能延长租期 | 已完成 |
| 过期工作补偿 | Queue Reconciler、Worker Bootstrap | 活动租约不会被误杀，过期租约能够恢复或明确失败 | 已完成 |
| 增量 Artifact | Workflow Runtime 和领域 Handler | 强制终止进程后，已完成步骤 Checkpoint 和 Artifact 仍存在 | 已完成 |
| Provider 冷却 | 共享 Provider 请求工具 | HTTP 429 以 `Retry-After` 为最小等待时间 | 已完成 |

M1 实库并发验收使用 8 个同目标并发创建请求，只持久化 1 条 Run，其余 7 次复用；两个 Worker 同时抢占只允许 1 个租约持有者。过期租约验收确认 Run 回到 `queued`、运行步骤回到 `pending`、旧 Attempt 标记失败；取消超时验收确认 Run 以 `WORKFLOW_CANCEL_TIMEOUT` 结束。

## 6. M2 Prompt 与领域 Agent 任务表

| 任务 | 目标模块 | 验收测试 | 状态 |
| --- | --- | --- | --- |
| Prompt Registry | `lib/prompts` | 每个 Prompt ID 都有中英模板和变量声明 | 已完成 |
| 领域身份 | 选角、场景/道具、切片、编剧、分镜规划、摄影、表演、细化、台词 | 每个角色职责单一且有输出 Schema | 已完成 |
| 结构化解析 | 共享 LLM JSON Parser | 可修复输出成功；语义错误触发纠错重试 | 已完成 |
| 现有调用链迁移 | 小说解析、台词分析、Workflow/API Locale | 删除硬编码 Prompt 和手写 JSON 解析 | 已完成 |
| 回归 Guard | Prompt 与结构化输出 Tests | 占位符、必要字段、JSON Canary 和固定样本测试通过 | 已完成 |

M2 共注册 9 个领域 Prompt ID 和 18 份中英模板。小说解析已按角色分析与场景/道具分析并行、分镜规划串行的依赖顺序执行；台词分析复用同一结构化请求层，并保留 `panelIndex` 到持久化 `panelId` 的映射。10 项 M2 定向测试覆盖变量契约、双语 Hash、Markdown Fence、混合文本、`jsonrepair` 和单次语义纠错；全量 86 项测试、TypeScript、ESLint、生产构建、Prisma 校验及 13 组迁移状态均通过。

### 6.1 M2.5 Agent Contract V2

| 任务 | 目标模块 | 验收测试 | 状态 |
| --- | --- | --- | --- |
| 运行时 Agent Contract | Prompt Catalog 与 Registry | System 消息包含职责、工具、上下文、证据、质量、重试和停止规则 | 已完成 |
| System/User 分层 | 结构化 LLM 请求层 | 原文和上游资产只进入不可信 User 数据层 | 已完成 |
| 领域语义 Validator | 角色、场景、道具、切片、剧本、分镜、摄影、表演、细化、台词、连续性 | Schema 合法但领域错误的输出触发具体错误和一次定向纠错 | 已完成 |
| 证据链与连续性监督 | Prompt Schema、模板和 Artifact | 原文摘录可校验；连续性问题只能引用有效 Panel 和规范实体 | 已完成 |
| Provider 能力协商 | Channel 模型能力与 OpenAI Structured | 仅明确支持时启用严格 JSON Schema，否则使用兼容 JSON Object | 已完成 |
| Prompt Trace | Workflow Attempt 与 Artifact | 保存 Prompt/System Hash、模型、纠错次数、输出 Hash 和累计 Token 用量 | 已完成 |

M2.5 将既有 9 个 Prompt 升级为 V2，并新增连续性监督 Prompt，共 10 个领域 Agent。纠错预算由 Agent Contract 直接控制；Schema 或语义错误不会轮换 API Key 重复消耗 Token，只有 Provider 或网络错误才执行 Key 故障转移。严格 JSON Schema 会补齐必填字段并移除不兼容默认值；存在动态对象等 Provider Strict 不支持的结构时自动降级为 JSON Object。33 项定向测试与全量 106 项测试、TypeScript、变更文件 ESLint、生产构建、Prisma 校验和 13 组迁移状态均通过。

## 7. M3-M4 Artifact 与重试粒度

| 工作项 | Artifact 粒度 | 重试失效范围 |
| --- | --- | --- |
| 角色/场景/道具分析 | 每种分析一个 Artifact | 对应分析和依赖的切片、剧本步骤 |
| Clip 切分 | 每集一个版本化 Artifact | 切分和全部剧本 clip |
| 剧本转换 | 每个 clip 一个 Artifact | 失败 clip 自身 |
| 分镜规划 | 每个 clip 一个 Artifact | 该 clip 的后续全部 phase |
| 摄影与表演 | 每个 clip、每个 phase 一个 Artifact | 该 clip 的细化 phase |
| 分镜细化 | 每个 clip 一个 Artifact | 台词分析和领域落库 |
| 台词分析 | 每集一个 Artifact | 仅台词分析 |

### 7.1 M3 Story-to-Script 完成记录

| 任务 | 目标模块 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| 分析边界拆分 | Novel Parser 与 Workflow | 分析阶段只处理角色、场景、道具，不再提前生成整集分镜 | 已完成 |
| 分项增量持久化 | Parser Runtime 与 Workflow Artifact | 两路并行分析分别完成即落库并写领域 Artifact 与 Prompt Trace | 已完成 |
| 严格原文切片 | Clip Prompt、Schema 与 Validator | 所有 `clip.content` 按顺序拼接后与原文逐字一致，空白不被隐式裁剪 | 已完成 |
| 稳定 Clip Upsert | Production Domain Store | 同一 `episodeId + clipIndex` 保留 Clip ID；原文不变时保留有效剧本，变化时精确失效 | 已完成 |
| 逐 Clip 剧本 Agent | Story-to-Script Runtime | 有界并发执行剧本转换，动作、对白、说话人、场次和规范实体通过语义 Guard | 已完成 |
| Clip 级恢复 | Workflow Runtime | 每个成功或失败 Clip 立即写独立 Artifact；重试只请求失败或无效 Clip | 已完成 |
| 工作流收口 | Parse API 与 Workflow Registry | M3 固定为分析、切片、剧本三步，M4 分镜和台词步骤不再混入 | 已完成 |

M3 参考成熟工作流的分析、切片、逐 Clip 剧本顺序，但采用更强的原文完整覆盖约束，不依赖模糊边界猜测。增量 Artifact 写入与 Workflow Run 租约在同一事务校验，取消或租约丢失后不会继续提交 Artifact；领域写入在恢复时会通过有效性校验并补齐 Artifact。36 项 M3 定向测试覆盖原文空白、并发上限、稳定 Clip ID、剧本失效、部分失败恢复和工作流依赖；全量 114 项测试、TypeScript、变更文件 ESLint、生产构建、Prisma 校验和 13 组迁移状态均通过。

### 7.2 M4 Script-to-Storyboard 完成记录

| 任务 | 目标模块 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| Clip 分镜规划 | Script-to-Storyboard Runtime | 每个有效剧本 Clip 独立生成 Phase 1，Prompt 版本和输入 Hash 决定 Artifact 是否可复用 | 已完成 |
| 摄影与表演并行 | Runtime 与领域 Agent | Phase 2 两个分支并行；单分支失败不丢失另一分支的成功 Artifact | 已完成 |
| 分镜细化与连续性 | Runtime、Schema 与 Validator | Phase 3 保持镜头身份和实体不变；连续性审查只引用有效局部 Panel 和规范实体 | 已完成 |
| 稳定 Panel 落库 | Prisma 与 Novel Domain Store | `clipId + clipPanelIndex` 保留 Panel ID 和媒体引用，全局 `panelIndex` 继续供 UI、台词与 Timeline 使用 | 已完成 |
| Phase 级恢复 | Workflow Store 与 Retry API | `refId + phase` 只失效目标 Clip 的对应分支及下游；连续性重试不重跑台词 | 已完成 |
| 集级台词分析 | Workflow Runtime 与 Voice Analyze | 全部分镜落库后执行，并写 `voice.lines` 与 Prompt Trace 增量 Artifact | 已完成 |
| 工作流入口 | Storyboard API 与 Workflow Registry | `POST /storyboard` 创建分镜、台词两步工作流，支持去重、租约、取消与独立重试 | 已完成 |

M4 保留参考成熟工作流的规划、摄影/表演并行、细化和台词分析顺序，并增加连续性监督、Prompt 版本化恢复和严格的 Clip 所有权校验。分镜只在全部 Clip 成功后统一落库；中途失败时，已完成 Phase 仍以 Artifact 保存。7 项新增测试覆盖部分失败恢复、分支失效范围、连续性隔离、稳定 Panel ID、跨剧集 Clip 拒绝和工作流依赖；全量 121 项测试、TypeScript、ESLint、生产构建、Prisma 校验和 14 组本地迁移状态均通过。

### 7.3 M5 外部能力完成记录

| 任务 | 目标模块 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| 资产上传与来源 | Project Asset Store、Storage 与 Upload API | 图片/视频统一写入媒体账本；项目、剧集和目标实体均校验所有权；来源进入 `AssetReference` | 已完成 |
| 参考图转角色 | Project Asset Task 与 Reference API | 只接受项目拥有的图片资产；生成和描述提取均记录来源；重复请求使用稳定幂等键 | 已完成 |
| 图片/视频提取 | Visual Asset Agent 与 FFmpeg 抽帧 | 图片与视频帧进入同一结构化 Agent；角色、场景、道具落库后保留源资产引用 | 已完成 |
| 标记/AI 分集 | Episode Split Runtime 与 API | 标记模式不调用模型；AI 边界逐字定位；所有分集重建后与原文完全一致 | 已完成 |
| 安全分集落库 | Episode Store | 有下游制作数据的剧集正文不会被覆盖；批量创建和更新在同一事务完成 | 已完成 |
| 媒体模板 | OpenAI Compatible Template Adapter | 模型级 sync/async、自定义端点、JSONPath 映射、同源约束和显式空字段省略 | 已完成 |
| Worker 分派 | Media Runtime | Worker 从模型能力读取模板；后续同协议 Provider 只需配置模板，不再增加核心分支 | 已完成 |

M5 复用了既有媒体任务、资产引用和模型能力数据结构，因此不需要新增 Prisma 表或迁移。模板不会保存 API Key，绝对 URL 只能与渠道 Base URL 同源；视觉提取只读取通过项目所有权校验的媒体资产。13 项新增回归测试覆盖上传来源、跨项目资产拒绝、视频抽帧、分集完整覆盖、异步状态与空字段语义；全量 134 项测试、TypeScript、ESLint、生产构建、Prisma 校验和 14 组本地迁移状态均通过。

### 7.4 M6 质量体系完成记录

| 任务 | 目标模块 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| 计费对账 | Billing Service 与 Queue Watchdog | 冻结只允许一个结算方抢占；交易和用量使用稳定幂等键；终态任务和过期孤儿冻结自动补偿 | 已完成 |
| 余额修复 | Billing Reconciler | 串行锁定用户余额后，以待处理冻结总和校正 `frozenAmount`，不会与并发预扣互相覆盖 | 已完成 |
| 结构化 Trace | Workflow、Media Task 与 Trace API | Run、Step、Attempt、Prompt、Task 使用统一 Trace ID 和父子 Span；查询按当前用户隔离 | 已完成 |
| Prompt Canary | Prompt Registry 与 Worker Bootstrap | 13 个 Prompt 的 26 个双语版本 Hash 固化；模板或 Agent Contract 漂移会阻止 Worker 启动 | 已完成 |
| 行为 Guard | Quality Guards 与 Media Runtime | 拒绝重复资产、错误媒体类型、非法 URL、重复 Panel、危险尺寸和不一致输出规格 | 已完成 |
| 渲染归一化 | FFmpeg Render 与 Render API | 图片和不同编码、宽高比、帧率的视频先统一转码，再与 48kHz 双声道音轨合成 MP4 | 已完成 |
| 系统回归 | M6 Tests | 覆盖计费重复结算、Trace 父子链、Canary 漂移、渲染参数和跨模块行为门禁 | 已完成 |

M6 新增第 15 组非空迁移，为既有 Run、Step 和 Task 回填稳定 Trace/Span Hash，并为后续任务保留显式 Workflow 关联。用量记录增加唯一来源键，重复 Worker 回调和 Watchdog 对账不会重复扣费。渲染输出固定为 H.264、`yuv420p`、确定尺寸和帧率；当分镜没有视频时可使用选中图片按镜头时长补帧。完整接口和运维说明见 `docs/m6-quality-system.md`。

## 8. M7 生产工作台与统一编排

M7 的目标不是再做一层聊天壳，而是把 M0-M6 已完成的领域能力组织成可连续操作、可恢复、可追踪的漫剧生产工作台。用户从项目进入后，应能沿同一条生产链完成内容导入、资产确认、分镜与媒体生产、声音制作、时间线渲染和交付。

### 8.1 产品信息架构

| 层级 | 页面或区域 | 核心职责 | 数据来源 |
| --- | --- | --- | --- |
| 全局层 | 项目首页 | 新建、搜索、排序、最近打开、归档项目；显示真实制作阶段和异常摘要 | Project、Episode、Workflow Run、Media Task |
| 项目层 | 全屏生产工作台 | 承载项目配置、剧集切换、阶段切换和全局任务反馈 | Project Config、Episodes、Workflow Runs |
| 导航层 | 左侧剧集导航 | 剧集状态、未完成项、失败提示、快速切换和新增剧集 | Episode、Storyboard、Production |
| 阶段层 | 顶部阶段导航 | 显示当前阶段、完成度、阻塞关系和可执行的下一步 | Workflow Step、Artifact、领域有效性 |
| 内容层 | 中央工作区 | 针对当前阶段提供密集、可扫描、可编辑的专业工具 | 对应领域 API |
| 协作层 | 右侧上下文 Agent | 读取当前项目、剧集、阶段和选中实体上下文，展示建议、工具调用与审批 | AgentEvent、Trace、当前 UI Context |
| 反馈层 | 任务与运行面板 | 查看批次、队列、进度、错误、费用、Trace，并执行取消、重试 | Media Batch、Media Task、Workflow、Billing、Trace |

生产阶段固定为六组，避免把后端接口直接平铺成菜单：

1. **小说与剧本**：导入或编辑原文、标记/AI 分集、运行 `story-to-script`、查看 Clip 与结构化剧本。
2. **角色、场景与道具**：确认分析结果，上传或提取参考素材，生成候选图并选择基准资产。
3. **分镜设计**：运行 `script-to-storyboard`，按 Clip/Panel 检查构图、表演、连续性和台词。
4. **镜头生产**：批量或单格生成分镜图与视频，比较候选结果，重试失败任务并确认镜头资产。
5. **声音制作**：管理音色、台词与语音，执行音频合并和口型同步，处理失败与替换结果。
6. **时间线与交付**：生成和调整 Timeline、预览字幕与音轨、提交渲染、查看成片并导出。

### 8.2 页面骨架与交互原则

- 项目首页使用克制的列表或网格切换，不制作营销式 Hero；项目名称、阶段、更新时间和阻塞状态应在首屏可扫描。
- 项目工作台采用全屏应用布局，不把主编辑器包在装饰性卡片中，也不使用卡片嵌套卡片。
- 桌面端保持“左侧剧集导航 + 中央工作区 + 可收起右侧 Agent”的稳定结构；窄屏将两侧区域收为 Sheet，主任务保持单列。
- 顶部阶段导航使用图标、短标签和明确状态，不用仅靠颜色表达完成、运行、失败或阻塞。
- 中央工作区优先使用表格、列表、画布、时间线和分栏检查器；卡片只用于候选资产、重复媒体项、任务和确认对话框。
- 生成、重试、取消、确认和发布必须提供明确的 pending、success、error、disabled 与 destructive 状态；高风险批量操作需要二次确认。
- 用户选择角色、场景、道具、Panel 或时间线片段时，右侧 Agent 同步接收结构化上下文，不从 DOM 文本反推上下文。
- 每个阶段保留稳定 URL 与选择状态，刷新、前进后退和深链访问不会丢失当前项目、剧集、阶段或选中实体。

### 8.3 OpenAI 风格的原创设计约束

M7 借鉴 [OpenAI Docs 的 UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines) 所体现的设计原则，不复制 OpenAI 产品页面或品牌资产：

- 使用系统字体栈、有限的正文与小字号层级、稳定的行高和一致的 4/8px 间距节奏，保证信息优先和长时间工作可读性。
- 使用中性的语义色处理背景、文字、边框和状态，仅把项目品牌色用于少量主操作、选中态与状态强调；不使用装饰性渐变、纹理或大面积品牌色背景。
- 延续项目现有 Tailwind semantic tokens，同时支持明暗主题；禁止在业务组件中散落无法审计的硬编码颜色。
- 使用 `lucide-react` 的单色线性图标和熟悉控件；图标按钮提供 Tooltip 和可访问名称，不绘制仿 OpenAI 图标。
- 通过标题、辅助信息、主操作的固定顺序建立视觉层级，减少无关控件；次要设置采用渐进披露。
- 文本与背景至少满足 WCAG AA；支持键盘导航、清晰焦点、图片替代文本和浏览器文本缩放，状态变化通过可感知文本或实时区域反馈。
- 不使用 OpenAI Logo、ChatGPT 名称、商标、专有插图、截图、文案或像素级布局，也不暗示产品由 OpenAI 提供或背书。

### 8.4 状态与数据编排

```txt
Project / Episode / Stage URL
  -> typed feature client
  -> server API and persisted domain state
  -> Workflow Run / Media Batch / Task events
  -> normalized workspace view model
  -> stage UI + contextual Agent + task panel
```

- 在 `features/studio` 内按 `projects`、`episodes`、`assets`、`storyboard`、`shots`、`audio`、`timeline`、`runs` 拆分类型、请求、状态组合和视图组件，避免新增单个超大工作台组件。
- 现有 `components/agent` 继续作为通用 Agent shell 和消息/工具协议层；生产领域状态不得写回通用聊天组件。
- Workflow Run 是长流程阶段状态的权威来源，Media Batch/Task 是媒体任务状态的权威来源，领域表和 Artifact 决定产物是否真实存在且有效。
- 统一映射 `queued`、`running`、`paused`、`succeeded`、`failed`、`cancelled` 和阻塞状态；页面刷新后从服务端重建，不从本地倒计时推算。
- 优先复用现有 SSE 事件；断线后使用带退避的查询补偿，并在终态停止订阅或轮询。失败信息必须保留稳定错误码、可操作建议和 Trace 入口。
- 乐观更新只用于可安全回滚的轻量编辑；启动生成、资产确认、批量重试和渲染均以服务端响应为准。
- 前端不得绕过现有所有权、阶段门禁、幂等键、Billing 冻结和质量 Guard。

### 8.5 分批交付

| 批次 | 交付内容 | 验收门禁 | 状态 |
| --- | --- | --- | --- |
| M7.1 工作台基础 | 路由、项目首页、项目工作台骨架、剧集与阶段导航、语义 Token、明暗主题、响应式 Shell | 可创建并打开项目；深链和刷新可恢复；桌面/移动端无重叠或横向溢出 | 已完成 |
| M7.2 小说与资产 | 原文/分集/剧本界面，角色/场景/道具资产库，上传、提取、生成、选择与批次反馈 | `story-to-script` 可完整操作；资产来源和当前基准可追踪；跨项目资产不可见 | 已完成 |
| M7.3 分镜与镜头 | Clip/Panel 分镜编辑、连续性问题、图片/视频候选、单项与批量任务控制 | `script-to-storyboard` 可完整操作；失败只重试目标范围；任务结果不伪造 | 已完成 |
| M7.4 声音与交付 | 音色与台词、语音、合并、口型、Timeline、渲染、预览与下载 | 真实任务可取消/重试；混合素材成片可渲染；失败有 Trace 和恢复入口 | 已完成 |
| M7.5 Agent 与可观测 | 上下文 Agent、审批、任务中心、费用摘要、Run/Step/Task Trace 检查器 | Agent 工具调用携带当前结构化上下文；状态、费用和 Trace 可串联核对 | 已完成 |
| M7.6 质量收口 | i18n、键盘与焦点、WCAG AA、空/载入/错误/部分成功状态、性能和端到端回归 | 中英文无溢出；关键路径端到端通过；生产构建、类型、Lint 和测试通过 | 已完成 |

每个批次使用独立双语提交并保持可运行。只有当前批次通过验收门禁后，才进入下一批次；不得用静态展示页代替对应业务闭环。

### 8.6 M7 总体验收

- 新用户可以从项目首页进入任意项目，在同一工作台内完成至少一集从原文到渲染成片的完整流程。
- 六个阶段都能区分未开始、进行中、已完成、失败、已取消和被上游阻塞，且状态与数据库、Workflow、Worker 和 Task 一致。
- 刷新页面、Worker 重启或 SSE 短暂断开后，已完成产物不丢失，运行状态能够恢复，不重复创建 Run、Task 或计费记录。
- 角色、场景、道具和镜头的当前基准资产可追溯到来源，替换后下游影响明确，不静默使用失效素材。
- 单项和批量任务均可查看进度、失败原因、费用、Trace，并按后端能力执行取消或精确重试。
- 右侧 Agent 的建议和工具调用基于当前结构化上下文；审批、错误和工具结果继续遵循 `AgentEvent` 协议。
- 关键桌面和移动视口无文本截断、控件重叠、不可达操作或布局跳动；键盘和屏幕阅读器可完成主要操作。
- 现有 API 所有权、幂等、质量 Guard、Prompt Canary、计费与 Trace 回归测试持续通过。

### 8.7 参考项目与许可边界

- 外部 UI 参考项目仅用于研究生产流程的信息分组、阶段可见性和任务反馈；其源码采用限制性 source-available 许可，本项目不复制其源码、样式、文案、品牌、颜色、素材、组件实现或文件组织方式。
- M7 使用 Cyanyi-Drama 自有领域模型、现有技术栈和六阶段信息架构独立实现，不引入参考项目的具体组件或编辑器方案，也不复刻其页面结构。
- OpenAI 官方指南只作为通用视觉与交互原则来源；本项目保留独立品牌，不复用 OpenAI 商标与专有资产。
- 新增第三方依赖前必须核对许可证和用途兼容性；需要保留的版权或 NOTICE 随依赖一并提交。

## 9. M8 专业影视部门工作流

M8 将现有六个功能页面升级为电影制作部门协作系统。Agent 不以聊天角色数量为目标，而以明确职责、类型化交付物、依赖关系、审批权限和质量门为边界。多个 Agent 可以共享一次已验证的上游分析结果，禁止为了展示“Agent 团队”重复发送相同上下文。

### 9.1 制作阶段与部门 Agent

| 制作阶段 | 主责 Agent | 结构化交付物 | 进入下游的质量门 |
| --- | --- | --- | --- |
| 项目开发 | 制片人、导演、故事编辑、编剧 | 创作简报、受众与规格、故事圣经、剧本版本 | 目标时长与画幅明确；核心人物、冲突、调性和禁改项获批 |
| 剧本拆解 | 剧本统筹、场记、选角指导 | 场次表、角色/场景/道具/服装清单、连续性台账、风险与需求拆解 | 原文与剧本覆盖完整；实体身份稳定；场次和日夜内外景可执行 |
| 视觉开发 | 美术指导、制作设计、角色概念、场景设计、道具服装、色彩脚本 | 视觉圣经、风格板、色彩脚本、角色 Turnaround、场景与道具规格、参考资产谱系 | 主视觉语言统一；资产可追溯；角色比例、服装、场景时代与材质锁定 |
| 导演与 Previs | 导演、摄影指导、分镜导演、表演指导 | Blocking、镜头表、构图/焦段/机位/运动/灯光规则、表演节拍、Animatic 草案 | 轴线、视线、空间、节奏和叙事覆盖通过；镜头具备可生成参数 |
| 镜头生产 | 镜头制片、生成操作、连续性监督 | 镜头任务包、候选媒体、选片记录、版本与成本记录 | 角色和场景连续；运动与时长合规；失败镜头可独立重做 |
| VFX 制作 | VFX Supervisor、FX、Compositor | VFX Breakdown、Plate/Element 清单、遮罩与跟踪需求、合成说明、镜头版本 | 每个 VFX Shot 有输入依赖、合成层、色彩空间、边缘/运动/光照检查 |
| 声音与剪辑 | 剪辑师、声音指导、对白编辑、拟音、音乐、混录 | EDL/Timeline、对白与 ADR 清单、Cue Sheet、SFX/Foley、音乐与混录版本 | 画音同步、响度、对白可懂度、节奏、版权和缺失素材检查通过 |
| 调色与交付 | 调色师、Online Editor、QC Supervisor | Look/LUT 决策、母版、字幕、封面、技术与内容 QC 报告、交付包 | 分辨率、帧率、色彩、响度、字幕安全区、黑帧/坏帧和平台规格全部通过 |

美术指导不等同于当前的 `production_designer` 抽取任务：前者负责统一视觉语言与批准资产规格，后者保留为剧本拆解阶段的场景/道具识别能力。VFX Supervisor 不归入静态资产库；它横跨镜头生产和后期，负责识别 VFX Shot、定义 Plate/Element/Comp 依赖并执行镜头级 QC。

### 9.2 编排与成本原则

- 使用“项目圣经 -> 剧集包 -> 场次 -> Clip -> Shot -> Asset/Track -> Master”的层级上下文；下游只读取所需切片，不重复发送整本原文。
- 文本 Agent 优先输出边界、引用和决策，不复制大段原文；媒体 Agent 只接收已批准资产、镜头规格和必要参考。
- 每个交付物保存 `version`、`status`、`approvedBy`、`sourceRefs`、`promptTrace`、`cost` 和依赖 Hash；上游变化只失效受影响的下游分支。
- 工作流必须支持 `draft -> review -> approved -> locked -> superseded`，审批门默认位于剧本锁定、视觉圣经锁定、Animatic 锁定、镜头终审和母版交付。
- Provider 超时、429 和临时 5xx 采用短请求、退避和可审计降级；不得依赖用户反复点击同一同步大请求。
- Agent 建议与执行分离：分析和检查可以自动运行，生成、批量重做、资产锁定、删除和最终交付继续要求用户批准。

### 9.3 分批交付

| 批次 | 交付内容 | 验收门禁 | 状态 |
| --- | --- | --- | --- |
| M8.0 可靠性修复 | 结构化 Provider 错误归一化；切片超时降级；轮询与心跳请求收敛 | 524 不再阻断整条工作流；降级结果保持原文逐字覆盖并可追踪 | 已完成 |
| M8.1 制作核心模型 | Production Bible、Department、Deliverable、Approval Gate、依赖与版本状态 | 上游版本变化能精确计算失效范围；未批准交付物不能进入锁定阶段 | 已完成 |
| M8.2 剧本与美术部门 | 创作简报、剧本拆解、美术指导、视觉圣经、色彩脚本、角色/场景/道具/服装规格 | 资产页可查看部门负责人、交付物、版本、来源、审批状态和阻塞原因 | 已完成 |
| M8.3 导演与 Previs | 导演阐述、Blocking、镜头表、摄影与表演规则、Animatic | 每个镜头具备构图、焦段、机位、运动、灯光、时长和连续性依据 | 已完成 |
| M8.4 VFX 与镜头生产 | VFX Breakdown、镜头依赖图、Plate/Element/Comp 任务、镜头 QC | VFX Shot 可独立排队、重试、换版本和回滚；普通镜头不承担无关 VFX 请求 | 已完成 |
| M8.5 声音与后期 | EDL、对白/ADR、SFX/Foley、音乐、混录、调色、Online 与字幕 | 时间线版本可恢复；响度、同步、色彩与字幕检查有机器可读报告 | 待开发 |
| M8.6 制片与总体验收 | 成本/用量预算、排期、部门看板、批量审批、端到端恢复与电影级 QC | 一集从剧本锁定到母版交付可审计；失败、费用、版本和批准链完整 | 待开发 |

### 9.4 UI 调整方向

- 顶层导航从单一线性进度升级为“开发、前期、镜头、后期、交付”五组制作域，现有六个 URL 继续兼容并映射到对应域。
- 中央区域以制作看板、交付物列表、版本比较、镜头表、节点依赖和时间线为主；Agent 作为部门负责人出现在所属工作区，不做装饰性角色卡。
- 资产工作区新增“视觉圣经、美术部门、角色、场景、道具、服装、色彩脚本”视图；VFX 工作区放在镜头与后期之间，并可从 Shot 直接打开 Breakdown。
- 右侧面板显示当前主责 Agent、需要的输入、将产生的交付物、质量检查和待批准操作；通用状态 Agent 保留为制片协调入口。

## 10. 提交计划与双语规范

从 M7 计划提交开始，Git 标题统一为：

```txt
<type>(<scope>): <English summary> / <中文摘要>
```

`scope` 可在不影响清晰度时省略。标题保持单行、同义和同一行为范围；必要的提交正文也应先英文后中文说明动机、风险或迁移步骤。历史提交不重写。

| 提交信息 | 范围 | 当前是否提交 |
| --- | --- | --- |
| `docs: add backend parity roadmap` | 本计划表和验收门禁 | 是 |
| `feat: establish production pipeline baseline` | 当前 Prisma Schema、非空迁移、Storage、Provider、媒体 Runtime、资产库、Billing、Workflow Checkpoint、API 和测试 | 已提交 |
| `fix: harden production app secret` | 共享 `APP_SECRET` 策略和测试 | 已随 M0 基线提交 |
| `feat: add workflow run leases and dedupe` | M1 Schema、Runtime、API 和测试 | 已提交 |
| `feat: add domain prompt contracts` | M2 Prompt、Parser 和 Guard | 已提交 |
| `feat: harden domain agent contracts` | M2.5 Agent Contract、Validator、连续性监督、Provider 能力和 Trace | 已提交 |
| `feat: implement story-to-script workflow` | M3 编排、Artifact 和落库 | 已提交 |
| `feat: implement script-to-storyboard workflow` | M4 编排、Artifact 和落库 | 已提交 |
| `feat: add external assets and media templates` | M5 上传、视觉提取、整本分集、Provider 模板和测试 | 已提交 |
| `feat: add production quality safeguards` | M6 计费对账、Trace、Canary、行为门禁、渲染归一化和系统回归 | 已提交 |
| `docs(roadmap): plan M7 production workspace / 规划 M7 生产工作台` | M7 信息架构、设计与许可边界、交付批次、验收门禁和双语提交规范 | 已提交 |
| `feat(studio): build project workspace foundation / 构建项目工作台基础` | M7.1 路由、项目首页、工作台 Shell、导航和响应式基础 | 已提交 |
| `feat(studio): connect writing and asset workflows / 接入编剧与资产工作流` | M7.2 小说、剧本和资产闭环 | 已提交 |
| `feat(studio): connect storyboard and shot production / 接入分镜与镜头生产` | M7.3 分镜、图片和视频闭环 | 已提交 |
| `feat(studio): connect audio timeline and delivery / 接入声音时间线与交付` | M7.4 声音、口型、时间线和渲染闭环 | 已提交 |
| `feat(studio): add contextual agent and observability / 增加上下文智能体与可观测性` | M7.5 Agent、审批、任务、费用和 Trace | 已提交 |
| `test(studio): complete M7 quality gates / 完成 M7 质量门禁` | M7.6 i18n、无障碍、响应式、端到端和回归测试 | 已提交 |
| `fix(workflow): recover clip segmentation from provider timeouts / 从渠道超时恢复故事切片` | M8.0 结构化错误归一化、确定性切片降级与恢复测试 | 已提交 |
| `docs(workflow): plan professional film production pipeline / 规划专业影视制作工作流` | M8 部门 Agent、交付物、审批门、编排原则与开发批次 | 已提交 |
| `feat(workflow): add production deliverables and approval gates / 增加制作交付物与审批门` | M8.1 Production Bible、Department、Deliverable、版本依赖与审批状态 | 已提交 |
| `feat(studio): add art department and visual development / 增加美术部门与视觉开发` | M8.2 美术指导、视觉圣经、色彩脚本和资产规格工作区 | 已提交 |
| `feat(studio): add direction and previs workflow / 增加导演与预演工作流` | M8.3 导演阐述、Blocking、镜头表、摄影与表演规则、Animatic | 已提交 |
| `feat(studio): add vfx and shot production / 增加视效与镜头制作` | M8.4 VFX Breakdown、镜头依赖与 QC | 已提交 |
| `feat(studio): add post-production and mastering / 增加后期制作与母版交付` | M8.5-M8.6 声音、剪辑、调色、Online、QC、预算和验收 | 待开发 |

当前 Prisma Schema、迁移、资产、计费、媒体和 Workflow 改动相互依赖，因此现有功能使用一个可编译、可迁移的基线提交，不拆成无法独立运行的中间提交。后续每个里程碑按功能和测试独立提交。

## 11. 明确不提交的内容

- `.env.local` 以及任何真实 API Key、密码、Token、存储凭据。
- `.next`、`node_modules`、Coverage、`*.tsbuildinfo`、日志、本地数据库卷、`.media` 和渲染媒体。
- 空迁移目录、没有任何 Schema 操作的迁移文件。
- 临时截图、剪贴板文件、调试 Payload、一次性 Provider Response。
- 生成的 Prisma Client。

## 12. 每次提交前检查

1. `pnpm exec prisma validate`
2. 在一次性 MySQL 数据库执行全部 Migration，并检查 Schema Drift。
3. `pnpm exec tsc --noEmit --pretty false`
4. `pnpm test`
5. 对所有变更 TypeScript 文件执行 ESLint。
6. `git diff --check`
7. 检查 Staged Files 和 Staged Diff，排除密钥、生成物和本地数据。
8. 只有全部门禁通过，或明确记录环境限制后才能提交。
