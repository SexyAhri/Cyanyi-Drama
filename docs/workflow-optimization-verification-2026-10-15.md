# 工作流修复与验收记录

2026-10-15。范围来源：[工作流优化待办](workflow-optimization-backlog-2026-10-15.md)。代码在原工作区实施，保留已有文档改动、历史任务快照和《雨停之前》原始产物；不自动提交Git。

## 已实现的产品行为

| 待办 | 实现与验证 |
| --- | --- |
| A01/A02 | 普通输入参考不推导输出归属。明确资产分支在提交时冻结目标；显式空目标不回退。历史结果按冻结目标恢复，过期结果不回填，缺目标的旧快照仅在原revision一致时兼容推断；重复同步幂等，不清洗现有候选。 |
| A03 | 新canvas来源指纹v3只解析实际生成输入和依赖版本。拖动、视角和无关节点变化不会失效；真正提示词/参考变化仍标旧来源。旧任务快照保持原版本。 |
| A04 | 自由图片、正式单图和批量图片均传递并核对完整预览hash。动态采用图/默认参数变化返回409且不创建任务；固定参考及已提交快照保持固定。 |
| A05 | 页面候选、显式素材解析和正式采用统一过滤媒体类型与成功状态。浏览器视频候选只有本地视频版本，未混入已有图片。 |
| A06 | 自动模板持有基线。未手改时跟随正式设定；手改草稿、固定媒体与历史快照保留，展开对比后可显式替换。浏览器确认“白伞”草稿与正式“深蓝伞”同时可见。 |
| A07 | 正式镜头删除后，关联分支解除失效panelId，保留草稿/素材/历史候选和原ID线索；归属权限校验不放宽。浏览器自身保存revision7→8并重载成功，只读数据库确认全部7原节点及草稿/媒体保留，所有分支已解除被删镜头的panelId。 |
| B01 | 冻结明确场次/人物/地点/时长/道具范围；场次数与镜头数分别计算。去掉至少4场及固定15秒规则；支持2场各30秒，审核展示偏差，服务端采用前再次拒绝不匹配。近似、上限/下限、否定语境不误当精确值。续写区分已采用全剧registry与本集scenes实际出场约束，新的明确要求优先；项目有效目标时长进入prompt、缓存、冻结输入与校验，8项续写回归通过。 |
| B02 | 正文对白形成有ID/顺序的账本，VoiceLine与镜头账本使用同一UUID，字幕/唇形/旁白从同组数据映射；动态提示按冻结原文、顺序和明确说话人检查。测试覆盖遗漏、倒序、错误归属及后续编辑不改变快照。未调用配音/视频模型。 |
| B03 | 新生成先冻结continuity起止状态及动作转换；视听设计不得改起始字段。图片只描述单一时刻，明确时间序列触发修正；静态景深/颜色渐变可用。旧持久化产物可读取。自然语言物理因果和左右关系仍需实际审阅，不能只凭字符串测试勾整体完成。 |
| B04 | 镜头工作台新增连续性联系表，只显示成功且已采用帧；对照相邻镜头起止状态、人物、机位、关键帧时刻、道具和版本，可进入单镜编辑与局部修复。浏览器两镜实测包括未采用帧、上一镜对照和窄屏。原实图尚未局部重生。 |
| B05 | 保存实际图片时解码测量尺寸；后期提示源尺寸与项目画幅差异。contain/crop持久化，真实预览及FFmpeg采用同一方式；取消两种模式的隐式3%推进，保证全片取景不偏离预览，不拉伸人物。FFmpeg像素/片尾边缘检查通过。 |
| B06 | 静音字幕按阅读量与留白规划；手工入出点保留并真实烧录。保存/导出校验顺序、重叠、越界及可读时长。界面修改字幕和填边后刷新保持；重叠时错误可见且保存/导出禁用。全部4个入出点的8帧边界检测通过。 |
| B07 | minimal名册逐项区分independent/inline并说明理由，仅独立项生成档案；inline全局策略不创建独立道具档案，普通工具可留在动作中而不增加参考槽位。针对某个普通道具免生图不误判成全局禁止。4项阶段回归覆盖分流与拒绝路径。 |
| B08 | 中英文提示增加自然对白、动作与潜台词要求，版本/canary更新；另有实际两场四镜编辑草稿。没有新的样片艺术验收。 |
| C01/C02 | 默认标题随正式重排，自定义名保留；卡片关系分用途显示。审核按后端preview列实际参考图及素材ID/时间，浏览器确认1张固定色块版本，不根据关系线数量猜模型输入。 |
| C03 | 本地导出固定local/local-ffmpeg，不选渠道/模型，不依赖供应商费率；保持权限、队列、素材归属、失败处理和提交快照。真实队列导出成功，未产生供应商请求或费用账目。390px弹窗溢出已修复并复验。 |

## 隔离链路与页面证据

- 画布：正式Next API、PostgreSQL、最新Worker共14项断言，4次请求只到127.0.0.1图片stub；包含单图/批量图旧hash409且0新增任务、拖动保持有效、真实输入变化标旧、原归属恢复及重复同步。证据 `artifacts/workflow-fixes-20261015/canvas-api-verification.json`。驱动 `.backups/verify-canvas-workflow-fixes.mts`，临时项目/用户/任务/价格已精确清理。
- 删除恢复：真实浏览器打开删除第二镜后的持久化画布，保存并重载；数据库只读复核revision7→8、全部7原节点、自定义视频名、原panel/video草稿、所有媒体引用及两个视频候选保留，失效panelId全部解除。证据 `artifacts/workflow-fixes-20261015/canvas-ui-deleted-panel-recovery.json`；驱动`.backups/verify-canvas-ui-recovery.mts`未执行sync或写操作。
- 交付：正式HTTP/PostgreSQL/队列12项通过，无channel/model请求的真实FFmpeg任务成功；跨用户保存/导出404，非法字幕400且不覆盖保存。证据 `artifacts/workflow-optimization-20261015/delivery/api-verification.json`、`output-verification.json`、`local-output.mp4`、`subtitle-boundaries.jpg`。
- 浏览器使用独立UI项目 `4e3d5a1a-c204-441a-bd4a-70bba461a954`，素材为本地产生的测试色块及其实际FFmpeg成片引用，明确不是模型作品。桌面1588px与390×844窄屏实际操作；图片均真实载入。联系表窄屏document宽度390；修后导出dialog宽度/scrollWidth均358，文档宽度390；选择填边、字幕5.1秒入点保存后刷新保持。
- 截图在 `artifacts/workflow-optimization-20261015/ui/`：`continuity-desktop.png`、`continuity-mobile.png`、`video-candidates.png`、`asset-prompt-difference.png`、`actual-reference-review.png`、`reordered-titles.png`、`deleted-shot-recovery.png`、`subtitle-overlap-mobile.png`、`local-render-mobile-fixed.png`。`local-render-mobile.png`保留为修复前溢出证据，不能当作修复通过截图。
- 本轮没有真实文本、生图、视频、配音或口型请求，没有启用已停用费率。原《雨停之前》11项完整性复核通过，11媒体任务/22账目/9图/4镜/7实体/2工作流和画布内容未变；证据 `artifacts/workflow-optimization-20261015/delivery/integrity-after-delivery.json`。

## 综合检查与环境收尾

- 最终Vitest：241个文件、1228项全部通过，日志`artifacts/workflow-optimization-20261015/vitest-final.log`。全量中发现旧render-spec期望3%推进，与已验证固定取景的设计冲突；改为contain/crop固定取景和拼接参数一致性检查，6项通过后全量重跑通过。
- 独立TypeScript通过；全仓ESLint为0错误、13条既有Canvas警告，后续只改动的render-spec测试文件lint也通过。生产构建含TypeScript通过；24项Prisma迁移状态最新；`git diff --check`通过。对应日志`tsc-final.log`、`lint-final.log`、`build-final.log`、`migration-final.log`在同一证据目录。
- 浏览器临时标签关闭，临时视口已恢复。隔离UI项目、4任务、4媒体、1队列job、2份去重且无人引用bytes、2临时Session、stranger与1配置均精确清理，逐项剩余0；原owner保留，私有token移除。公开证据保留，原项目11项完整性再次全通过。清理记录`artifacts/workflow-optimization-20261015/delivery/cleanup-verification.json`。
- 为避免内存不足，重型检查顺序运行，构建时暂停本项目Web/Worker，之后隐藏恢复最新代码。Web3000 wrapper38624/child35808，首页与`/login`均HTTP200；Worker wrapper39272/child27776，在Redis两个队列各实际注册1个执行器。启动前后活动任务及待执行队列全0，任务/工作流/账目总数未增，无模型请求。证据`artifacts/workflow-optimization-20261015/services/restoration.json`及脱敏启动日志。没有新增数据库迁移、重置或Git提交。

## 尚待完成与证据边界

- B03/B04：程序边界合同与联系表可用；旧第1→2镜左右换位、第2镜提袋状态等原实图尚未修图和再次采用。文字规则不能证明物理语义或跨镜视觉质量。
- B08：已提供 [两场四镜修订草稿](workflow-content-revision-2026-10-15.md)，含完整八句账本、字幕时间和局部修图要求；未把修改后的文字写回原失败证据，也没有新模型/样片验收。
- D01：按阶段拆分13次153,755Token，视听设计占约51.3%；没有原始HTTP prompt字节或同任务质量A/B，未推断确切浪费/缓存节省。D02：原500不可复现，4类非法JSON真实HTTP均400、费率表摘要不变；根因未确认。详见 [诊断记录](workflow-optimization-diagnostics-2026-10-15.md)。
- 浏览器本轮核验中文暗色桌面与390px窄屏关键操作；英文/浅色、完整触屏/键盘、真实供应商返回尺寸与艺术质量不在本轮通过结论中。
- 本清单共20项，其中15项达到实现及相关验证条件；B03/B04/B08/D01/D02的剩余部分如上明确记录，未整体勾选。不得将全部程序回归通过写成原始样片的艺术质量通过。

媒体、JSON和驱动位于Git忽略目录，跨环境需额外保留；本文件、诊断和修订草稿随仓库保留。
