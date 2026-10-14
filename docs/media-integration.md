# 媒体、资产与任务接入

本页合并原资产生成、M5 外部能力和 M6 质量说明。用户入口与钱包规则见 [README](../README.md)，实际视频参数见 [视频声音与实际模型参数](video-model-parameters.md)。API 的最新输入校验以对应路由和服务端合同为准。

## 执行和权限边界

- Web 接口校验当前用户、项目、剧集及目标归属后创建任务；Redis/BullMQ 排队，独立 `pnpm worker` 执行。未配置供应商或失败时保存真实错误，不伪造产物。
- 媒体请求、工作流步骤尝试和产物保留请求 ID、冻结输入、配置来源及关联对象。任务状态与执行阶段分别记录，查询和 SSE 消费持久化状态；恢复复用已保存的 provider task ID 和检查点。
- 生成结果保留为可选择的版本。采用素材走现有选择服务；重试不得清空已采用素材，过期来源的结果不能自动覆盖当前制作对象。
- 媒体字节存于 PostgreSQL，哈希可以复用，业务引用仍需逐项检查项目权限。
- 外部模型请求统一通过 `lib/billing/` 预留和结算。输出生成完成后的下载/保存失败仍可产生费用；交付重试复用产物，不再请求模型。详细单位、数量和失败边界见 README 的模型价格与钱包章节。

## 项目资产接口

路径以下均以 `/api/projects/:projectId` 为前缀。

| 接口 | 用途 |
| --- | --- |
| `POST /assets/upload` | 上传图片、视频或音频；multipart 的 `file` 必填，文件为 1B–100MB，MIME 与 kind 匹配 |
| `POST /assets/generate` | 为角色、场景或道具创建图片任务 |
| `POST /assets/generate-batch` | 批量创建独立图片任务，各目标可单独追踪、重试或取消 |
| `POST /assets/reference-to-character` | 使用项目内参考图片生成角色外观；`extractOnly` 创建描述提取工作流 |
| `POST /assets/extract` | 项目内图片/视频的视觉资产提取工作流；`persist` 控制领域写入 |
| `POST /assets/select` | 确认角色外观、场景/道具图片或分镜素材版本 |

单个图片任务示例：

```json
{
  "targetType": "character",
  "targetId": "character-id",
  "channelId": "image-channel-id",
  "model": "configured-image-model",
  "prompt": "同一角色的正面全身设定图，背景干净",
  "ratio": "1:1",
  "resolution": "2k",
  "useSelectedReference": true
}
```

参考素材使用当前项目的 `MediaAsset` ID，不接受通过任意 URL 绕过所有权检查。上传时可携带 `episodeId`、`targetType`、`targetId` 和来源 `role`；所有引用经过服务端范围校验。

## 分镜和声音接口

路径以下以 `/api/projects/:projectId/episodes/:episodeId` 为前缀。

| 接口 | 用途 |
| --- | --- |
| `POST /storyboard/:panelId/generate` | 读取图片提示词和已确认参考素材，创建镜头图片任务 |
| `POST /storyboard/generate-batch` | 批量镜头图片任务 |
| `POST /storyboard/:panelId/generate-video` | 按镜头提示词、参数和当前声音方式创建视频任务 |
| `POST /storyboard/generate-video-batch` | 批量镜头视频任务 |
| `POST /voice-lines/:lineId/generate` | 按台词、音色与渠道能力创建配音任务 |
| `POST /production/timeline` | 根据已保存镜头和语音组织剪辑时间线 |
| `POST /render` | 校验渲染规格并提交时间线渲染任务 |

声音方式为视频原生声音（`native`）、独立配音后期（`post`）和静音（`silent`）。服务商只接收其明确支持的参数；不能把提示词声音要求当作逐字对白或口型保证。台词重新分析保留未变化条目的声音设计和已生成音频。

批次状态通过 `GET /api/media/batches/:batchId` 查询；同一路径的 `POST` 支持 `retry` 和 `cancel` 操作。失败、取消与恢复仍需检查所属用户及每个任务当前状态。

## 原著分集与资料提取

`POST /api/projects/:projectId/episodes/split` 支持明确标记、AI 和自动选择模式。边界由服务端重新定位和校验；已有下游制作结果的剧集不能被静默覆盖。AI 拆集、资料提取及长篇改编保存分块结果，重试可复用已完成分块。工作流及分块并发设置见 README。

## OpenAI Compatible 媒体模板

模板保存在渠道的 `models[].capabilities.mediaTemplate`。API Key 不进入模板数据；运行时注入鉴权，也可用 `{{api_key}}` 映射自定义 Header。模板端点必须与渠道 Base URL 同源。

```json
{
  "version": 1,
  "mediaType": "image",
  "mode": "sync",
  "create": {
    "method": "POST",
    "path": "images/generate",
    "bodyTemplate": {
      "model": "{{model}}",
      "prompt": "{{prompt}}",
      "image": "{{image}}",
      "size": "{{size}}"
    },
    "omitEmptyBodyFields": ["image", "size"]
  },
  "response": { "outputUrlsPath": "$.data" }
}
```

异步模板还需状态端点、provider task ID/status 的响应路径和轮询规则；必要时配置内容端点。常用变量包括 `model`、`prompt`、`image`、`images`、`aspect_ratio`、`resolution`、`size`、`duration`、`task_id` 和 `generate_audio`。仅删除 `omitEmptyBodyFields` 明确列出的空值，保留其他空字符串、`false` 和 `0`。

## Trace、校验与渲染

Run、Step 和 Media Task 保存 `traceId`、`spanId`、`parentSpanId`；媒体任务可关联工作流 Run/Step。`GET /api/traces/:traceId` 按当前用户范围返回 Run、Step、Attempt、Prompt、媒体任务及真实事件；UI 只呈现安全摘要。

Prompt Canary 在 Worker 启动时检查模板版本、语言、变量及契约。模型输出经任务 schema 和语义校验；媒体 Guard 检查输出类型、资产引用、可获取 URL 和渲染规格。Canary 的模板完整性检查不能代替内容质量验证。

时间线渲染统一尺寸、帧率和像素格式，输出 H.264、`yuv420p`、AAC/48kHz/双声道、带 `faststart` 的 MP4。缺视频的镜头可使用所选图片和明确时长。可配置 `720p`、`1080p`、`2160p`/`4k` 及横竖/方形比例，也可提交经服务端校验的尺寸。

FFmpeg 按 `FFMPEG_PATH`、`ffmpeg-static`、系统 PATH 的顺序查找。部署系统须有可用二进制。口型同步按已接入供应商能力执行；音频合并和时间线渲染使用已有 FFmpeg 实现，不需要伪装成外部模型请求。
