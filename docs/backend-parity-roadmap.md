# Cyanyi-Drama 后端功能对齐开发计划

## 1. 开发目标

在不照搬 UI 的前提下，使 Cyanyi-Drama 的影视生产工作流逐步达到与 `waoowaoo` 接近的行为能力，同时保留现有媒体任务 SSE、Fal/Vidu/百炼口型同步、音频合并和 Timeline Render。

开发顺序固定为：稳定基线、工作流可靠性、Prompt 与领域 Agent、两条生产工作流、外部能力、质量体系。功能只有通过对应恢复测试和验收门禁后才算完成。

## 2. 交付原则

- 开始新增工作流行为前，必须先形成干净且经过验证的代码基线。
- 每个 clip 或 phase 完成后立即持久化，禁止等整个 Run 结束后集中保存。
- Workflow、Task、Billing 和领域数据必须能够独立恢复与对账。
- 生产环境必须拒绝缺失或公开默认的密钥，媒体访问必须校验用户或项目所有权。
- 每个里程碑同步增加测试，不把回归测试推迟到最后补。
- 保留现有 FFmpeg Render、音频合并、媒体 SSE 和三家 Lip Sync Provider。

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
| M6 | 下一步 | 3-5 天 | 计费对账、结构化 Trace、Prompt Canary、行为 Guard、渲染规格归一化、系统回归测试 | 对账幂等；Run/Task/Step 可串联追踪；混合媒体输入能生成规格统一的成片 |

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

M3 与 `waoowaoo` 保持相同的分析、切片、逐 Clip 剧本顺序，但采用更强的原文完整覆盖约束，不依赖模糊边界猜测。增量 Artifact 写入与 Workflow Run 租约在同一事务校验，取消或租约丢失后不会继续提交 Artifact；领域写入在恢复时会通过有效性校验并补齐 Artifact。36 项 M3 定向测试覆盖原文空白、并发上限、稳定 Clip ID、剧本失效、部分失败恢复和工作流依赖；全量 114 项测试、TypeScript、变更文件 ESLint、生产构建、Prisma 校验和 13 组迁移状态均通过。

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

M4 保留 `waoowaoo` 的规划、摄影/表演并行、细化和台词分析顺序，并增加连续性监督、Prompt 版本化恢复和严格的 Clip 所有权校验。分镜只在全部 Clip 成功后统一落库；中途失败时，已完成 Phase 仍以 Artifact 保存。7 项新增测试覆盖部分失败恢复、分支失效范围、连续性隔离、稳定 Panel ID、跨剧集 Clip 拒绝和工作流依赖；全量 121 项测试、TypeScript、ESLint、生产构建、Prisma 校验和 14 组本地迁移状态均通过。

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

## 8. 提交计划

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
| `feat: add external assets and media templates` | M5 上传、视觉提取、整本分集、Provider 模板和测试 | 本次提交 |

当前 Prisma Schema、迁移、资产、计费、媒体和 Workflow 改动相互依赖，因此现有功能使用一个可编译、可迁移的基线提交，不拆成无法独立运行的中间提交。后续每个里程碑按功能和测试独立提交。

## 9. 明确不提交的内容

- `.env.local` 以及任何真实 API Key、密码、Token、存储凭据。
- `.next`、`node_modules`、Coverage、`*.tsbuildinfo`、日志、本地数据库卷、`.media` 和渲染媒体。
- 空迁移目录、没有任何 Schema 操作的迁移文件。
- 临时截图、剪贴板文件、调试 Payload、一次性 Provider Response。
- 生成的 Prisma Client。

## 10. 每次提交前检查

1. `pnpm exec prisma validate`
2. 在一次性 MySQL 数据库执行全部 Migration，并检查 Schema Drift。
3. `pnpm exec tsc --noEmit --pretty false`
4. `pnpm test`
5. 对所有变更 TypeScript 文件执行 ESLint。
6. `git diff --check`
7. 检查 Staged Files 和 Staged Diff，排除密钥、生成物和本地数据。
8. 只有全部门禁通过，或明确记录环境限制后才能提交。
