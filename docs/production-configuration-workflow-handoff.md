# 制作配置与工作流优化交接

更新时间：2026-10-13（Asia/Shanghai）。完整范围见 `production-configuration-workflow-plan.md`。用户要求每完成一个功能都更新清单和本文件，便于更换环境后 AI 接手。

## 当前状态

正在实施第一阶段：统一配置存储、版本、声音策略到真实请求的链路。后续阶段仍在完整交付范围内，不因阶段拆分省略。97 项清单均保持未勾选，避免将底层和部分 UI 落盘误报为完整交付。

### 最新续接状态（2026-10-13）

- 用户要求停止耗时验收并先汇总；此轮到此暂停，不代表 A–G 已交付完成。
- 单 worker 全量测试通过：148 个测试文件、722 项；`pnpm exec tsc --noEmit --pretty false` 通过；本轮改动文件 ESLint 通过。之后仅追加了配置加载失败保护，尚未重新运行检查。
- `http://localhost:3000` 的工作台和 `/api/settings/production` 可访问。真实项目“本地小说 / 寒门少年”制作配置页显示 v0，确认继承的声音默认值及提示词预览：`audioMode: full`、对白/画外音/心声/环境声/动作音效开启、配乐按已有设计生成、字幕后期合成。没有保存或发布该项目配置。
- 窄屏快速查看仅到 390×844：配置弹窗内容采用内部纵向滚动，底部“完成”仍可见；完整窄屏、键盘、主题和交互验收按用户要求暂停。结束前已恢复默认视口并关闭设置面板。
- 最后的小改动在 `features/production-configuration/panel.tsx`：切换范围/重载时清空旧记录，API 读取失败时保持空配置，避免旧范围内容留在页面后对新范围误提交。该改动尚未验收。
- PostgreSQL、Redis 正在运行；前端与 worker 仍运行。换环境时重新检查进程、迁移和服务，不依赖旧 PID。
- 后续具体缺口：工作流预览已有 `workflow.retryMode` 和 `workflow.concurrency`，但设置页尚未编辑这两项，运行调度也未完整应用它们。补齐真实调度语义和 UI 后才可验收相应项目。

本轮已完成准备工作：

- 将前两轮建议逐项展开为 A–G 共 97 个验收项；尚未实现的功能没有勾选。
- 添加根目录 `AGENTS.md`，要求后续 AI 先读清单与交接并持续更新。
- 已读取 `product-ui-engineering` 技能及设计、架构、验证要求；沿用现有 UI。
- 已检查运行设置、项目设置、声音提示词、模型音频参数、Agent 提示词和工作流创建入口。

## 已有且已验证的修复（上一轮工作，当前仍未提交）

- 媒体手动重试使用新队列 ID，避免 BullMQ 返回已保留的终态任务而不执行；批量重试复用相同入口。
- 工作流重新生成清理目标和后续缓存、旧输出、旧租约；保留成功前置步骤。
- 原著手动重新生成不复用跨工作流旧缓存。
- 重试入队失败恢复失败状态；旧媒体队列任务不能改写新重试任务状态。
- 验证：144 个测试文件、705 项测试通过；真实 Redis 独立队列验证通过；类型检查和改动文件 lint 通过。
- 主要文件：`lib/workflow/store.ts`、`runtime.ts`、`retry.test.ts`；`lib/media/task-actions.ts` 及测试；`lib/queue/media-queue.ts` 及测试；`lib/worker/index.ts`；`app/api/media/batches/[batchId]/route.ts`；原著分析模块。

## 实施发现与设计决策

- 当前 `audioMode: "full"` 在 `lib/media/project-asset-tasks.ts` 固定设置；声音提示词在 `lib/media/director-prompt-locks.ts` 固定追加。
- `lib/novel/storyboard-director.ts` 仍有静音/独立配音固定契约；必须随声音策略一起修改，避免生成链路自相矛盾。
- `lib/prompts/registry.ts` 从文件缓存模板，`catalog.ts` 定义 Agent；需加入版本化配置读取与实际执行覆写。
- 现有设置 UI：`components/agent/shell/agent-settings-dialog.tsx` 与 `runtime-settings-panel.tsx`；项目入口是 `features/studio/components/workspace-topbar.tsx`。
- 统一配置计划新增数据库表，保存作用域键、草稿、已发布配置、发布版本、编辑修订和历史；继承顺序为个人→项目→剧集→镜头→本次。
- 计划给 workflow 输入和 media 请求保存配置快照；生产 Agent 使用同一快照，发布仅影响新任务。
- 计划采用服务器执行上下文承载配置，并在公共文本模型请求入口应用 Agent 模板/系统指令，避免各任务读到不同版本。
- 配置基础代码已落盘：`lib/production-configuration/{contract,context,store,agents}.ts`、`app/api/settings/production/route.ts`、Prompt 变量保留及 Prisma 表。
- 增量迁移 `20261013090000_production_configuration` 已通过 `prisma migrate deploy` 应用，客户端已生成；新代码类型检查通过。尚未完成配置测试、执行接入和页面，不能据此勾选端到端验收项。
- 数据库记录存在三项本地缺失的旧迁移：`20260831174500_reviewed_workflow_v2_foundation`、`20260831210000_project_lip_sync_model`、`20260901093000_enable_reviewed_workflow_v2`。保留现有数据，不 reset；本轮只部署新增迁移。

## 当前环境

- 当前工作目录：`D:\HomeCode\Cyanyi-Drama`；PowerShell；pnpm 11.7.0。
- 前端：`http://localhost:3000`，Next dev，最近验证 HTTP 200。
- PostgreSQL、Redis：本项目 Docker Compose 服务；上一轮已恢复运行。
- 前端最近启动 PID 42560、Worker PID 28872（launcher）；PID 是临时环境信息，接手时必须重新检查进程。Worker 无自动 watch，执行验证前需加载新代码。
- 浏览器工具返回到工作台页；设置弹窗已关闭。配置加载与声音预览已在真实页面只读查看，没有持久更改。
- 不读取/输出 `.env.local` 的密钥；dotenv 仅用于执行本地数据库或队列检查。

## 下一步（按顺序）

1. 先对 `features/production-configuration/panel.tsx` 最后的读取失败保护跑改动文件 lint，再跑全量 typecheck/tests。
2. 补齐 D/E 的真实执行语义，尤其 `retryMode`、并发槽位、请求级恢复，并在保存或发布测试时使用可清理的专用数据。
3. 完成范围继承、草稿发布/冲突/历史、Agent 请求试运行与执行快照的页面到 API 端到端验收。
4. 继续实施清单 F 的编排、历史、统计和通知；按功能分段推进，不把阶段拆分当作缩减总范围。
5. 每交付一个功能，更新对应 A–G 条目和下面的功能日志；仅实现且验证完成后勾选。

## 功能交付日志

2026-10-13 本轮进行中（尚未端到端验收，条目保持未勾选）：

- 配置服务已提供个人/项目/剧集/镜头继承、每字段来源、草稿、发布、历史恢复新版本、修订冲突。新增 4 个配置测试文件，针对配置和既有重试的 47 项测试通过；改动文件 lint 通过；类型检查通过。
- 视频提示词、预览和任务 `audioMode` 已接入同一声音策略；媒体请求保存 `productionConfiguration`。导演静音契约已替换为有效声音策略。默认不生成字幕，配乐仅按已有设计；post/silent 使用 none。
- 新建工作流输入保存快照；旧工作流第一次执行时在租约保护下固定快照。公共 LLM 入口应用 Agent 模板、系统指令、模型/渠道、温度、修正及文本请求策略；请求 trace 包含版本来源。项目助手的工具停用在候选、模型输出和审批执行三处约束。
- UI 已添加到工作台运行设置及通用设置中的“制作配置”：声音、Agent、请求策略、版本、字段继承、预览、草稿/发布/回滚、未保存保护和冲突保留。代码位于 `features/production-configuration`；尚未通过真实页面保存/发布验收。
- 全量测试第一次运行发现旧测试没有模拟新增表读取及断言旧声音文案，正在补齐回归用例，不算全量通过。
- 页面验证发现 Docker Desktop 已退出，PostgreSQL/Redis 不可连接，项目页面 P1001；已请求启动 Docker Desktop。前端和 worker 仍在运行。恢复依赖后继续验证，不重置数据库。

历史 Docker 离线记录已过期；服务于本轮恢复。最新进展：

- 加入配置读取失败保护，避免上一范围记录残留并允许错误范围提交；未复跑检查。
- 单 worker 全量回归：148/148 文件、722/722 项通过；类型检查、改动文件 lint 在最后这次改动之前通过。并行测试尝试遇到 worker 非预期退出，因此不作为通过证据。
- 真实页面只读核验了声音开关、字幕/配乐策略及最终请求提示预览。未更改真实项目设置；保存/发布、版本回滚和 API 错误状态尚未做端到端验证。
- 用户要求“先总结”，暂停更多验收。恢复后优先验证最后的 UI 安全改动，然后落实 `workflow.retryMode` 和 `workflow.concurrency` 至任务调度，并继续完整 A–G 清单。

后续每条完成记录包含：功能编号、行为、文件、测试/页面证据、限制和下一项。不要把文档准备当作功能交付。
