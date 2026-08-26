# M5 外部资产与媒体模板

## 项目资产

所有上传、参考和提取操作都先校验当前用户的项目所有权。上传结果统一写入 `MediaTask`、`MediaAsset` 和 `AssetReference`，不会创建绕过任务与资产账本的独立媒体记录。

### 上传

`POST /api/projects/:projectId/assets/upload` 使用 `multipart/form-data`：

- `file`：必填，图片或视频，最大 100MB。
- `kind`：可选，`image` 或 `video`；未传时从 MIME 推断。
- `episodeId`：可选，必须属于当前项目。
- `targetType`：可选，支持 `project`、`episode`、`character`、`character_appearance`、`location`、`location_image`、`storyboard_panel`。
- `targetId`：非项目目标时必填。
- `role`：可选的来源角色，默认 `uploaded_source`。

上传到角色或场景时会在同一数据库事务中创建外观/场景图并关联资产。相同字节仍复用全局媒体哈希，但业务引用始终保留当前项目所有权。

### 参考图转角色

`POST /api/projects/:projectId/assets/reference-to-character` 接收：

```json
{
  "referenceAssetIds": ["media_asset_..."],
  "characterId": "character-id",
  "channelId": "image-channel",
  "model": "image-model",
  "count": 1,
  "prompt": "可选的角色设定图要求"
}
```

参考图片必须是当前项目拥有的 `MediaAsset`，不接受任意 URL。设置 `extractOnly: true` 时，模型必须明确声明 `supportsReferenceImages: true`，接口只提取角色描述并记录 `description_source` 引用。

### 图片/视频提取资产

`POST /api/projects/:projectId/assets/extract` 接收项目内图片或视频资产 ID。视频先在服务端通过 FFmpeg 抽取有限帧，再与图片一起发送给视觉资产 Agent。设置 `persist: true` 后，角色、场景和道具会按项目稳定名称写入，并为每个实体创建 `extracted_source` 引用。

## 整本小说分集

`POST /api/projects/:projectId/episodes/split` 支持：

- `mode: "markers"`：只使用明确的“第 X 集/章/幕”、`Episode X`、`Chapter X` 或场景编号。
- `mode: "ai"`：使用结构化 Episode Editor Agent。
- `mode: "auto"`：优先可靠标记，没有标记时使用 AI。

AI 只能返回可在原文逐字定位的 `startMarker` 和 `endMarker`。服务端重新计算全部边界，并验证所有剧集拼接后与原文完全一致。`persist: true` 会事务化创建或更新剧集；若目标剧集已有 Clip、Storyboard、Voice 或 Workflow 数据且正文变化，接口返回 `409`，不会覆盖下游制作结果。

## OpenAI Compatible 媒体模板

模板保存在渠道更新请求的 `models[].capabilities.mediaTemplate` 中。API Key 不进入模板；运行时自动注入默认 Bearer Header，也可在自定义 Header 中使用 `{{api_key}}`。

同步图片示例：

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
  "response": {
    "outputUrlsPath": "$.data"
  }
}
```

异步视频模板还需要 `status`、`response.taskIdPath`、`response.statusPath` 和 `polling`。完成结果可直接从状态响应读取，也可配置 `content` 端点。

内置变量包括 `model`、`prompt`、`image`、`images`、`aspect_ratio`、`resolution`、`size`、`duration`、`task_id` 和请求中的其他 JSON 字段。模板只删除 `omitEmptyBodyFields` 明确列出的空值；未列出的空字符串、`false` 和 `0` 会原样发送。模板端点必须与渠道 Base URL 同源。
