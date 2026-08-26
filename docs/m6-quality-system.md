# M6 生产质量体系

## 计费对账

媒体任务预扣继续使用 `BalanceFreeze`。结算方必须先把冻结记录从 `pending` 原子更新为 `settled` 或 `released`，只有抢占成功的调用才能修改余额和写入流水。

- 交易键：`media:{taskId}:charge` 或 `media:{taskId}:release`。
- 用量键：`media:{taskId}:usage`。
- 成功任务结算并写入唯一 `UsageCost`。
- 失败或取消任务释放冻结，不产生实际扣款。
- 已过期且找不到任务的孤儿冻结会释放。
- 排队或运行中的任务即使冻结到期也不会提前释放。

Worker Watchdog 每轮恢复任务后执行对账。用户也可以调用 `POST /api/user/billing/reconcile` 主动对账自己的记录。对账会锁定当前用户余额，以全部 `pending` 冻结之和修复 `frozenAmount`，避免与并发预扣覆盖。

## 结构化 Trace

Workflow Run、Workflow Step 和 Media Task 都保存：

- `traceId`：一次完整执行链共享的根标识。
- `spanId`：当前 Run、Step 或 Task 的唯一标识。
- `parentSpanId`：父级 Span；Run 根节点为空。

Media Task 还可保存 `workflowRunId` 和 `workflowStepId`。内部调用通过 `traceParent` 继承 Workflow 上下文；独立媒体任务使用任务 ID 生成稳定 Trace，因此重试不会改变追踪身份。

`GET /api/traces/:traceId` 返回按时间排序的 Run、Step、Attempt、Prompt 和 Media Task Span，以及对应状态事件。接口只查询当前用户拥有的数据，不接受项目外 Trace。

## Prompt Canary 与行为门禁

`lib/prompts/canary.ts` 固化 13 个领域 Prompt 的中英文 `versionHash`，共 26 个 Canary。版本 Hash 同时覆盖模板、Agent System Contract、Locale 和显式版本号。

Worker 连接队列前执行 Canary。以下漂移会直接失败：

- 模板内容变化但 Canary 未更新。
- Prompt 缺少双语版本或残留未渲染变量。
- Agent 不再把输入视为不可信数据。
- 纠错不再是最多一次的定向修复。
- 成功标准、禁止项、质量门禁或停止规则为空。

媒体行为 Guard 还会拒绝空输出、重复资产 ID、任务与资产类型不匹配、不可获取的媒体 URL、重复 Panel 和不安全的渲染规格。

## 渲染规格归一化

`POST /api/projects/:projectId/episodes/:episodeId/render` 支持：

```json
{
  "channelId": "channel-id",
  "model": "configured-video-model",
  "format": "mp4",
  "resolution": "1080p",
  "aspectRatio": "16:9",
  "fps": 24,
  "imageDurationSeconds": 3
}
```

可用分辨率为 `720p`、`1080p`、`2160p` 和 `4k`；宽高比为 `16:9`、`9:16`、`4:3`、`3:4` 和 `1:1`。也可显式传入偶数化后的 `width` 与 `height`，最大 3840。

每个镜头先独立归一化：

- 按比例缩放并使用黑边补齐，不裁切原画面。
- 统一为 H.264、`yuv420p`、指定 FPS 和固定 GOP。
- 视频缺失时使用选中分镜图生成定长静态镜头。
- 合并音轨统一为 AAC、48kHz、双声道。
- 最终容器固定为带 `faststart` 的 MP4。

运行时依次尝试 `FFMPEG_PATH`、`ffmpeg-static` 和系统 PATH。部署环境应执行一次真实混合媒体回归；如果打包的静态二进制不适用于目标操作系统，应通过 `FFMPEG_PATH` 指向经过验证的 FFmpeg。

## 数据库迁移

迁移 `20260826163000_quality_trace_billing`：

- 为既有 Workflow Run、Step 和 Media Task 回填稳定 Trace/Span Hash。
- 添加 Task 到 Workflow Run/Step 的可选外键。
- 为 `UsageCost` 添加来源字段和唯一幂等键。

迁移只增加追踪和计费字段，不修改现有领域资产与生产数据。
