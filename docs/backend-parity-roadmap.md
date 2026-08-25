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
| M2 | 下一步 | 3-4 天 | Prompt 目录、Prompt ID、中英模板、变量契约、版本 Hash、`jsonrepair + Zod`、纠错重试 | 缺失或多余变量稳定失败；畸形 JSON 可修复或重试；Prompt 契约测试通过 |
| M3 | 待开始 | 4-6 天 | Story-to-Script：并行角色/场景/道具分析、边界校验切片、逐 clip 剧本转换、增量 Artifact | 单个 clip 可独立重试；Worker 中断后成功 clip 不丢失；原文无重叠和缺口 |
| M4 | 待开始 | 5-7 天 | Script-to-Storyboard：规划、摄影、表演、细化、台词分析、clip/phase 级失效重试 | 重试一个 phase 只失效其下游；其他 clip 不变化；分镜和台词输出通过 Schema 校验 |
| M5 | 待开始 | 4-6 天 | 资产上传、参考图转角色、资产提取、标记/AI 分集、OpenAI Compatible 媒体模板、空字段显式省略 | 新 Provider 无需修改 Worker 核心代码；上传和提取资产保留所有权与来源 |
| M6 | 待开始 | 3-5 天 | 计费对账、结构化 Trace、Prompt Canary、行为 Guard、渲染规格归一化、系统回归测试 | 对账幂等；Run/Task/Step 可串联追踪；混合媒体输入能生成规格统一的成片 |

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

| 任务 | 目标模块 | 验收测试 |
| --- | --- | --- |
| Prompt Registry | `lib/prompts`、`lib/prompt-i18n` | 每个 Prompt ID 都有中英模板和变量声明 |
| 领域身份 | 选角、场景/道具、切片、编剧、分镜规划、摄影、表演、细化、台词 | 每个角色职责单一且有输出 Schema |
| 结构化解析 | 共享 LLM JSON Parser | 可修复输出成功；语义错误触发纠错重试 |
| 回归 Guard | Scripts 和 Tests | 占位符、必要字段、JSON Canary 和固定样本测试通过 |

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

## 8. 提交计划

| 提交信息 | 范围 | 当前是否提交 |
| --- | --- | --- |
| `docs: add backend parity roadmap` | 本计划表和验收门禁 | 是 |
| `feat: establish production pipeline baseline` | 当前 Prisma Schema、非空迁移、Storage、Provider、媒体 Runtime、资产库、Billing、Workflow Checkpoint、API 和测试 | 已提交 |
| `fix: harden production app secret` | 共享 `APP_SECRET` 策略和测试 | 已随 M0 基线提交 |
| `feat: add workflow run leases and dedupe` | M1 Schema、Runtime、API 和测试 | 当前提交 |
| `feat: add domain prompt contracts` | M2 Prompt、Parser 和 Guard | M1 之后 |
| `feat: implement story-to-script workflow` | M3 编排、Artifact 和落库 | M2 之后 |
| `feat: implement script-to-storyboard workflow` | M4 编排、Artifact 和落库 | M3 之后 |

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
