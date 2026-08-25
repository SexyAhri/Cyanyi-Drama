# 资产生成

角色和场景图片统一通过媒体任务队列执行。接口只创建任务，不在请求中直接等待服务商返回结果。

## 单个资产

`POST /api/projects/:projectId/assets/generate`

```json
{
  "targetType": "character",
  "targetId": "character-id",
  "channelId": "image-channel-id",
  "model": "gpt-image-2",
  "prompt": "Anime character portrait",
  "ratio": "1:1",
  "resolution": "2k",
  "useSelectedReference": true
}
```

`useSelectedReference` 为 `true` 时，会把该角色或场景已有的选中图片加入任务请求，Worker 再按协议转换为服务商需要的格式。

## 批量资产

`POST /api/projects/:projectId/assets/generate-batch`

```json
{
  "channelId": "image-channel-id",
  "model": "gpt-image-2",
  "prompt": "保持角色画风和身份一致",
  "items": [
    { "targetType": "character", "targetId": "character-a" },
    { "targetType": "location", "targetId": "location-a", "prompt": "夜晚版本" }
  ]
}
```

批量接口最多接受 50 个目标，每个目标创建独立的 `MediaTask`，因此可以分别查询、重试或取消。默认会复用目标已有的选中图片作为参考图；没有选中图时按纯文本提示生成。

接口返回 `batchId`。通过 `GET /api/media/batches/:batchId` 可以读取批次中的任务和状态汇总；向同一路径发送 `{ "action": "retry" }` 会重试所有失败任务，发送 `{ "action": "cancel" }` 会取消仍在排队或运行中的任务。

任务完成后，Worker 会把 `MediaAsset` 回填到角色形象或场景图，并创建 `AssetReference`。没有真实服务商结果时任务会进入 `failed`，不会伪造成功。

## 确认基准资产

`POST /api/projects/:projectId/assets/select`

```json
{
  "targetType": "character",
  "targetId": "character-appearance-id"
}
```

同一角色或场景只会保留一个选中版本。场景确认时还会同步更新 `selectedImageId`。确认后的资产会以 `selected` 角色写入 `AssetReference`，后续一致性生成会优先使用它。

## 分镜图片

`POST /api/projects/:projectId/episodes/:episodeId/storyboard/:panelId/generate`

接口读取分镜格的图片提示词、角色列表和场景名，自动收集这些实体的已确认图片作为参考图；任务成功后回填 `StoryboardPanel.imageAssetId`。

剧集也支持批量生成：`POST /api/projects/:projectId/episodes/:episodeId/storyboard/generate-batch`。请求的 `items` 使用 `{ "panelId": "...", "prompt": "..." }`，返回的 `batchId` 可以交给批次接口统一查询、取消和重试。

分镜图可以通过资产确认接口使用 `targetType: "storyboard_panel"` 写入 `selected` 资产引用。

## 分镜视频

`POST /api/projects/:projectId/episodes/:episodeId/storyboard/:panelId/generate-video`

```json
{
  "channelId": "video-channel-id",
  "model": "seedance-1-0-pro",
  "ratio": "16:9",
  "resolution": "720p",
  "duration": "5s"
}
```

视频提示词优先使用分镜格的 `videoPrompt`，没有时回退到 `description`。任务会自动携带当前分镜图片、已确认角色图片和已确认场景图片作为参考图。接口只创建异步媒体任务，返回的 `task` 可以通过媒体任务接口读取状态。

剧集视频也支持批量生成：`POST /api/projects/:projectId/episodes/:episodeId/storyboard/generate-video-batch`。请求的 `items` 使用 `{ "panelId": "...", "prompt": "..." }`，返回的 `batchId` 与图片批次共用查询、取消和重试接口。

视频任务成功后，Worker 会把结果写入 `StoryboardPanel.videoAssetId`，并创建 `generated_video` 资产引用。确认视频时调用资产确认接口：

```json
{
  "targetType": "storyboard_panel",
  "targetId": "panel-id",
  "assetKind": "video"
}
```

视频任务不会使用假模型或假结果。渠道没有视频能力、服务商返回错误或轮询超时时，任务会进入 `failed`，保留原始错误并可通过批次或单任务接口重试。
