# 90 秒单集漫剧化改编开发计划

## 1. 文档状态

- 状态：待实施
- 基线日期：2026-08-30
- 适用链路：分集 -> AI 漫剧化改编 -> 剧本 -> 分镜 -> 图片/视频提示词 -> 配音/后期
- 实施原则：先完成数据合同与校验，再修改提示词，最后接入 UI；不以提示词自觉代替服务端硬校验
- 代码边界：只修改本计划列出的领域、API、Prompt、UI 和回归测试，不重构无关模块

## 2. 背景与问题定义

当前“改编”只返回标题、摘要、正文、改动说明和原文事件覆盖。它能证明模型对原文句子做了登记，但不能回答以下生产问题：

1. 这一集最终计划多少秒，是否超过 90 秒。
2. 90 秒如何分配给建立、动作、转场、对白、揭示和结尾钩子。
3. 人物从一个地点到另一个地点时，离场、路径、入场和到达状态在哪里。
4. 对白过程中人物在看谁、做什么、与谁或什么道具发生互动。
5. 打斗、功法、神秘器物、能量和异象如何进入 VFX/SFX 设计。
6. 上游即使生成了这些设计，剧本、分镜和降级分镜是否真正继承。

现有约束还存在两个相反风险：

- 逐句覆盖过强时，模型倾向于接近原文复述，三千字原文仍输出三千字左右。
- 只追求“精简”时，模型容易输出三百字摘要，动作过程、转场、互动和有效对白都被压没。

本次改造的核心不是规定固定字数，而是建立“时长驱动、事件保真、过程完整、下游可执行”的生产合同。

## 3. 已确认的产品决策

### 3.1 单集边界

- 有明确章节标记时，默认一章作为一集，不因原文字数较多自动拆成两集。
- 没有章节标记时，AI 分集仍需选择完整叙事边界，但不得按小说朗读字数机械切分。
- 超过 90 秒时先压缩重复说明、修辞和低价值停留，不先拆集。
- 只有在关键事件、因果、人物关系、核心设定和结尾钩子无法同时容纳时，才返回拆集建议。
- 拆集建议只供用户确认，系统不自动改写已经确认的章节边界。

### 3.2 时长

- 项目默认目标时长：85 秒。
- 用户可配置目标时长：60–90 秒。
- 成片硬上限：90 秒，客户端和模型均无权放宽。
- 内容充足时建议成片范围：70–90 秒。
- 原文内容不足时允许短于 70 秒，不新增无依据剧情、不用旁白或慢镜头注水。

### 3.3 镜头与节拍

- 常规 85–90 秒单集建议 16–22 个镜头，但镜头数只作为质量提示，不作为硬门禁。
- 单镜仍沿用现有 1–15 秒约束；常规叙事镜头以 2–6 秒为主。
- “生产节拍”不是“单个镜头”。一个 8–15 秒节拍可以由 2–4 个镜头完成。
- 不允许把 60 秒都理解为站桩对白。对白、动作、表演、视线和反应应在同一时间段并行发生。

### 3.4 内容取舍

必须保留：

- 关键事件及先后顺序
- 原因、过程、结果和状态变化
- 人物身份、关系、动机与已揭示信息
- 关键道具的归属、状态和交接
- 世界规则、境界、能力上限和关键限制
- 本集悬念、揭示和结尾钩子

允许压缩：

- 重复表达同一事实的说明
- 修辞、评价性旁述和重复感叹
- 不影响后续剧情的冗余背景解释
- 可由一个明确画面替代的长段文字说明

禁止为了缩短而删除动作的中间过程、跨场景转场、关键对白事实或人物反应。

### 3.5 对白与旁白

- 原文直接对白允许合并、压缩和调整口语节奏，但不得改变事实、关系、意图和揭示结果。
- 关键揭示、冲突回应和结尾钩子优先保留为直接对白。
- 少量明确心理活动可转为角色内心独白。
- 世界观说明优先转为有依据且说话逻辑成立的角色对白，其次转为画面；不默认交给旁白。
- 旁白最多 2 条，总计最多约 60 个中文字，只用于难以视觉化的地点、时间或世界规则。
- TTS 只接收最终台词/内心独白/批准旁白，不接收生产计划、表演说明、VFX/SFX 或整段改编正文。

## 4. 90 秒生产合同

### 4.1 常量与配置

```ts
export const DEFAULT_EPISODE_TARGET_SECONDS = 85;
export const MIN_EPISODE_TARGET_SECONDS = 60;
export const MAX_EPISODE_DURATION_SECONDS = 90;
```

`ProjectConfig` 新增 `episodeTargetDurationSeconds`，只表示单集目标时长。现有 `UserRuntimeSettings.videoGenerationDuration` 继续表示单次视频模型任务的单镜时长，两者不得复用。

### 4.2 计算规则

- `plannedDurationSeconds = sum(beats[].durationSeconds)`。
- `plannedDurationSeconds <= 90` 为硬门禁。
- 每个含台词节拍的 `durationSeconds` 必须大于等于该节拍所有口播文本的估算时长。
- 继续复用现有口播公式：中文约 4.2 字/秒、英文约 2.6 词/秒，并计入标点停顿。
- 动作和对白在同一节拍中并行时，节拍时长取两者所需时间的较大值，不允许简单相加造成虚假超时。
- 后续分镜中 `sum(panels[].durationSeconds)` 必须等于其承接节拍的预算；整集分镜总时长不得超过 90 秒。

### 4.3 质量提示而非硬门禁

- 内容充足但计划不足 70 秒：返回 `EPISODE_RUNTIME_UNDERFILLED` 警告，不直接捏造内容补齐。
- 预计镜头少于 16 或多于 22：返回质量警告，允许特殊叙事通过。
- 直接对白较多的原文却只有极少对白轮次：返回质量警告，要求模型优先检查是否过度改成旁白或叙述。

## 5. 改造后的数据流

```text
章节原文
  -> 无损编号 Source Units
  -> 单次 AI 改编请求
       -> 改编正文
       -> 生产时长总表
       -> 节拍/对白/旁白/转场/互动/特效计划
  -> 服务端结构与语义校验
  -> 改编稿版本 + Production Plan 一起落库
  -> 激活改编稿
  -> 节拍感知的 Clip 切分
  -> 剧本逐节拍实现动作链、转场、对白和特效设计
  -> 分镜按节拍预算实现镜头、表演、VFX/SFX 和连续性
  -> 图片/视频提示词继承已批准的分镜事实
  -> TTS 仅消费最终声音文本
  -> Timeline/Render 执行最终 90 秒门禁
```

正常路径只增加结构化输出字段，不增加第二次“分析改编”模型调用。现有结构化请求层仍可在 Schema 或硬合同失败时执行最多一次定向纠错；UI 必须明确显示“正在校验”或“正在纠错”，不能让用户误以为生成完成后系统又偷偷开始一次新任务。

## 6. 数据结构与迁移

### 6.1 `ProjectConfig`

在 `prisma/schema.prisma` 增加：

```prisma
episodeTargetDurationSeconds Int @default(85) @map("episode_target_duration_seconds")
```

迁移同时增加数据库 `CHECK`，限制范围为 60–90；API 仍需独立校验，不能依赖数据库报错作为用户提示。

### 6.2 `EpisodeSourceVersion`

增加可空字段：

```prisma
productionPlan        Json? @map("production_plan")
productionPlanVersion Int?  @map("production_plan_version")
```

约束：

- 原文版本和历史改编版本允许为空。
- 新生成的改编版本必须写入 `productionPlanVersion = 1`。
- Production Plan 是该稿件版本的不可变快照；以后修改项目目标时长，不得静默改写旧计划。
- 用户要采用新的目标时长，必须生成新的改编版本。

### 6.3 TypeScript 类型

新增共享类型 `EpisodeProductionPlanV1`，由 Zod Schema 推导，避免 Prisma JSON、API 类型和运行时各写一套接口。建议放在 `lib/episodes/production-plan.ts`，并由以下模块复用：

- `lib/episodes/adaptation.ts`
- `lib/projects/types.ts`
- `lib/novel/story-to-script-runtime.ts`
- `lib/novel/script-to-storyboard-runtime.ts`
- `features/studio/writing/*`

## 7. Source Units 与证据链改造

### 7.1 目标

当前改编请求同时传入完整原文、证据候选和完整事件锚点，模型输入重复；输出又要求重复大量原文证据，Token 成本高且容易诱导复述。

改为只构造一次无损编号原文：

```ts
type AdaptationSourceUnit = {
  unitId: `U${string}`;
  text: string;
  startIndex: number;
  endIndex: number;
  kind: "heading" | "narrative" | "dialogue" | "exposition";
};
```

### 7.2 构建规则

- 先按段落、对白边界和强标点切分，再合并过短相邻片段。
- 对白及其说话归属不得被切断。
- `units.map(text).join("")` 必须能无损还原原文；空白也通过 offset 记账。
- 章节标题单独标为 `heading`，不伪装成剧情事件。
- 所有非标题单元都必须在输出 `sourceCoverage` 中恰好出现一次。
- 不再传 `source_text + source_evidence_candidates + source_event_anchors_json` 三份重复数据，只传 `source_units_json`。

### 7.3 覆盖语义

`sourceCoverage.treatment` 只允许：

- `preserved`：核心事实或对白保留
- `condensed`：重复说明或修辞压缩，但事实仍存在
- `visualized`：转成可见动作、状态或环境
- `dialogized`：有依据的说明转成逻辑成立的角色对白

不提供 `omitted` 作为逃生选项。模型不能通过覆盖表声称处理了某单元，却在正文和节拍中找不到对应实现。

## 8. Production Plan V1 Schema

改编模型的顶层输出使用互斥结果，避免“计划必须不超过 90 秒”和“本集确实无法容纳”同时出现在同一个 Production Plan：

```ts
type EpisodeAdaptationResult =
  | {
      status: "ready";
      title: string;
      summary: string;
      adaptedText: string;
      changeSummary: string[];
      productionPlan: EpisodeProductionPlanV1;
    }
  | {
      status: "split_recommended";
      title: string;
      reason: string;
      suggestedBoundarySourceUnitId: `U${string}`;
      firstPartHook: string;
      secondPartOpening: string;
    };
```

只有 `ready` 结果落库。`split_recommended` 是一次成功解析的结构化业务结果，API 将其转成稳定的 409 业务响应供用户决定；它不触发结构化纠错重试，也不自动改写章节边界。

Production Plan 建议结构如下，最终字段名以 Zod Schema 为唯一真源：

```ts
type EpisodeProductionPlanV1 = {
  version: 1;
  sourceHash: string;
  runtime: {
    targetDurationSeconds: number;
    plannedDurationSeconds: number;
    hardMaxDurationSeconds: 90;
    estimatedSpokenSeconds: number;
    estimatedShotCount: number;
    fit: "target" | "compressed" | "short_source";
  };
  beats: Array<{
    beatId: `B${string}`;
    kind:
      | "establishing"
      | "action"
      | "transition"
      | "interaction"
      | "dialogue"
      | "reveal"
      | "climax"
      | "hook";
    purpose: string;
    location: string;
    durationSeconds: number;
    adaptedStartMarker: string;
    adaptedEndMarker: string;
    actionChain: null | {
      triggerOrIntent: string;
      preparation: string;
      execution: string;
      stateChange: string;
      settleOrReaction: string;
    };
    transition: null | {
      exitAction: string;
      pathCompression: string;
      entryAction: string;
      arrivalState: string;
    };
    performanceIntent: string;
    interactions: Array<{
      actor: string;
      target: string;
      action: string;
      reaction: string;
    }>;
    effects: Array<{
      kind: "combat" | "skill" | "artifact" | "phenomenon";
      trigger: string;
      visualIntent: string;
      soundIntent: string;
      provenance: "source" | "world_bible" | "production_inference";
    }>;
  }>;
  sourceCoverage: Array<{
    sourceUnitId: `U${string}`;
    beatId: `B${string}`;
    adaptedEvidence: string;
    treatment: "preserved" | "condensed" | "visualized" | "dialogized";
  }>;
  dialoguePlan: Array<{
    lineId: `L${string}`;
    beatId: `B${string}`;
    speaker: string;
    type: "dialogue" | "inner_monologue";
    text: string;
    sourceUnitIds: Array<`U${string}`>;
    treatment: "preserved" | "condensed" | "merged" | "converted_exposition";
  }>;
  narrationPlan: Array<{
    lineId: `N${string}`;
    beatId: `B${string}`;
    text: string;
    sourceUnitIds: Array<`U${string}`>;
    reason: "location_time" | "world_rule";
  }>;
  cliffhanger: {
    beatId: `B${string}`;
    setup: string;
    finalImageOrLine: string;
  };
};
```

模型不负责生成 `sourceHash` 和 `estimatedSpokenSeconds` 的最终值；服务端使用原文和声音公式覆盖这些派生字段，避免信任模型算术。

## 9. 改编正文合同

改编正文仍然是“供剧本转换的生产型叙事稿”，不是最终分镜脚本，也不写镜头焦段和摄影术语。

正文必须做到：

1. 按叙事顺序包含每个生产节拍。
2. 每个会改变人物、道具或空间状态的事件写出过程，不能只写结果。
3. 每个 Production Plan 的动作链字段都能在对应 beat 的正文区间找到实现。
4. 所有对白、内心独白和旁白文本与 `dialoguePlan/narrationPlan` 完全一致。
5. 旁白用明确标识，避免下游把普通叙述误判为可配音文本。
6. 不为凑时长增加原文没有的敌人、冲突、能力、道具、关系或结果。
7. 不复制大段重复说明；用动作、角色反应或一句有依据的对白承接核心事实。

不设置一个适用于所有小说的固定正文总字数。对约 3,000 字、信息充足的一章，85–90 秒成品通常会得到约 600–1,000 字的生产型改编稿，其中建议口播约 130–200 个中文字；这是黄金样例范围，不是全局硬编码。

## 10. 动作、转场、互动与表演合同

### 10.1 动作链

对改变状态的事件强制记录：

```text
触发/意图 -> 准备 -> 执行 -> 状态变化 -> 停稳/反应
```

普通微动作可以在同一镜头内完成，不要求每一步单独切镜。关键道具操作、身体接触、攻击受力和地点变化不得只写起点与结果。

### 10.2 地点变化

相邻 beat 的 `location` 不同时，必须存在：

```text
离场动作 -> 路径压缩 -> 入场动作 -> 到达状态
```

路径压缩可以只占 1–2 个镜头，例如“穿过灯笼摇曳的回廊”，但不能从练武场直接无动作切到偏院屋内。

### 10.3 人物互动

每个重要互动至少明确：

- 谁主动
- 对谁或什么道具动作
- 是否发生接触/交接
- 对方即时反应
- 动作结束后的站位、持有或视线状态

### 10.4 对白表演

对白 beat 不能只有“角色说台词”。必须给出与意图一致的表演信息，例如：

- 开口前的观察、迟疑或动作触发
- 说话中的视线、姿态、手部或道具操作
- 对方的非语言反应
- 台词结束时形成的切镜点或状态变化

这些信息在改编阶段只写制作意图，剧本阶段扩展为 action/bridge/performance，分镜阶段再变成带时间的 motion timeline。

## 11. 特效与声音触发

现有 `actionDesign` 主要由打斗、追逐、攻击、防御、变身、召唤和功法关键词触发。本次扩展到：

- 神秘器物开启、激活、认主或释放明确异象
- 可见能量、气息、光芒、阵纹、灵魂体和空间扭曲
- 突破、召唤、变身或环境异常
- 原文明示的轰鸣、破空、震动、能量冲击和毁坏反馈

计划修改 `ACTION_DESIGN_KINDS`，增加 `artifact` 和 `phenomenon`，并让验证器同时参考 Production Plan 的 `effects`，不再只依赖文本关键词。

边界：

- 只有已确认的超自然事实或可见/可听效果才触发。
- 制作推断只能决定颜色、材质感、粒子、运动和消散方式，不能新增能力、属性、威力和剧情结果。
- 环境声与动作音效保留在视频/后期声音轨；角色人声继续由独立 TTS 生成。
- 视频提示词明确“允许环境声与动作音效，不含角色人声”，避免模型内置人声污染。

## 12. 分集阶段修改

### 12.1 章节标记路径

保持 `detectEpisodeMarkers()` 和“一章一集”的现有行为，不按目标时长再次拆章节。

### 12.2 AI 分集路径

只在没有可靠章节标记时向 `episode_split` 提供：

- 项目目标时长
- 90 秒硬上限
- “先保完整事件，再由改编压缩”的边界策略
- 禁止按朗读速度把同一完整章节机械切碎

AI 分集仍只返回原文边界，不改写正文。分集提示词和 Schema 不承担详细节拍设计，避免职责重叠。

## 13. 剧本阶段继承

### 13.1 加载

`story-to-script` 加载 Episode 时，同时读取 `activeSourceId` 对应的 `productionPlan`。若为空，走兼容路径并显示“未做时长设计”，不伪造计划。

### 13.2 Clip 切分

- 有 Production Plan 时，优先按 beat 的 `adaptedStartMarker/adaptedEndMarker` 建立 source units。
- Clip 可以合并相邻 beat，但不能从一个动作链或转场中间切断。
- 超过 `screenplayClipMaxChars` 时，只能在 beat 内的安全动作边界切分，并保留相同 beatId。
- 无 Production Plan 时保留当前 AI 切片与确定性降级行为。

### 13.3 剧本输出

`story_screenplay_conversion` 增加当前 clip 的 Production Plan 子集，要求：

- 每个 beat 在 `beatCoverage` 中恰好出现一次。
- 动作链、互动、表演意图和转场实际进入 `scenes.content`。
- 对白/独白/旁白逐字等于已批准的改编正文，不进行第二轮改写。
- Production Plan 标记 effects 的 action 必须生成 `actionDesign`。
- `source/bridge/inferred` 的现有事实边界继续生效。

服务端验证 `beatCoverage` 对应到真实 scene 和 content，不能只返回标签。

## 14. 分镜阶段继承

`script-to-storyboard` 的 planning phase 同时接收：

- 当前 clip 剧本
- 当前 clip Production Plan 子集
- clip 总秒数预算
- 已有角色、场景、道具、世界观和跨集连续性

新增硬校验：

1. 每个 production beat 至少进入一个 panel，顺序不变。
2. 每个 panel 在 `worldContext.productionBeatIds` 标明承接节拍。
3. 当前 clip 所有 panel 时长之和等于分配给该 clip 的 beat 时长总和。
4. 整集所有 panel 时长之和不超过 90 秒。
5. 有口播镜头继续满足现有最短说话时长公式。
6. 剧本动作、actionDesign、impact、environmentResponse、VFX/SFX 继续实际进入描述、动作时间线和视频提示词。
7. 跨地点转场必须覆盖离场、路径、入场和到达状态。
8. 对白镜头必须带可见表演或对方反应，禁止连续站桩口型镜头。

确定性降级分镜也要接收同一 Production Plan，并保留：

- beat 顺序和秒数预算
- actionDesign choreography
- VFX/SFX
- 转场动作
- 对白与表演触发

修改降级版本指纹，防止复用旧格式缓存。

## 15. 图片、视频、配音与最终渲染边界

### 15.1 图片提示词

- 继承分镜的起始状态、角色/道具资产、构图和连续性约束。
- 不写不可见的完整时间动作。
- 不重新发明 Production Plan 中已经锁定的特效外观。

### 15.2 视频提示词

- 继承完整 motion timeline、起止状态、互动、VFX/SFX 和切镜终点。
- 默认要求保留环境声、动作声和特效声。
- 明确禁止角色对白、旁白和模型自生人声；这些由 TTS 和后期时间线负责。

### 15.3 配音

- Voice Analysis/Voice Design 只处理 screenplay/storyboard 产出的声音行。
- 表演指令可以包含情绪、语气、语速、角色和风格，但不把整段生产说明送给 TTS。
- Production Plan 的对白预算用于提前发现时长问题，不直接作为 TTS 文本。

### 15.4 最终渲染

- 渲染前再次校验 Timeline 总时长不超过 90 秒。
- 已有“镜头缺媒体、台词缺音频、整集对白无合并音轨”的阻断错误继续保留。
- 不通过删除缺失镜头或静默裁掉尾部来满足 90 秒。

## 16. API 与 UI 修改

### 16.1 Project Config API

`PATCH /api/projects/:projectId/config`：

- 接收整数 `episodeTargetDurationSeconds`。
- 低于 60、超过 90、非整数返回 400 和明确中文/英文错误。
- 不再把该字段统一转成字符串。

### 16.2 Adaptation API

`POST /api/projects/:projectId/episodes/:episodeId/sources`：

- 服务端从 ProjectConfig 读取目标时长，不信任客户端传入硬上限。
- 流式事件扩展为 `started -> generating -> validating -> correcting? -> completed/failed`。
- `completed` 返回改编版本及 Production Plan 摘要。
- 无法在 90 秒内保留硬事实时返回稳定错误码和拆集建议，不自动落库半成品。

### 16.3 设置界面

在现有“创作默认值”中只增加一个数字输入/步进器：

- 标签：单集目标时长
- 默认：85 秒
- 最小：60 秒
- 最大：90 秒
- 步长：5 秒

不重排设置页，不另建新的设置卡片。

### 16.4 改编对话框与稿件版本

- 改编对话框显示当前“目标 85 秒 / 硬上限 90 秒”。
- 完成后的候选稿显示计划时长、节拍数、估算口播秒数、预计镜头数和旁白数量。
- 稿件只有在收到 `completed` 后才结束 loading；正文流完但仍在校验时显示准确阶段。
- 历史稿或原文没有 Production Plan 时显示“未做时长设计”，不显示虚假 85 秒。

## 17. Prompt、版本和缓存失效

需要同步维护中文和英文模板：

- `episode_split.zh/en.txt`
- `episode_adaptation.zh/en.txt`
- `story_clip_segmentation.zh/en.txt`（如采用 beat-aware 模型切片）
- `story_screenplay_conversion.zh/en.txt`
- `story_storyboard_planning.zh/en.txt`

同时修改：

- `lib/prompts/catalog.ts`：新增变量并递增 Prompt 版本
- `lib/prompts/schemas.ts`：Production Plan、beat coverage 和 storyboard beat IDs
- `lib/prompts/validators.ts`：全部硬合同
- `lib/prompts/canary.ts`：更新双语 Hash
- 对应 Prompt Registry/Canary 测试

Storyboard phase 的 input hash 必须包含 Production Plan 版本、内容和目标秒数。确定性 fallback hash 版本必须递增。旧稿没有 Production Plan 时继续使用旧兼容路径，不能因 Hash 变化自动破坏已生成媒体。

## 18. 精确文件清单

### 18.1 数据与领域

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_episode_production_plan/migration.sql`
- `lib/episodes/production-plan.ts`（新增）
- `lib/episodes/adaptation.ts`
- `lib/episodes/split.ts`
- `lib/projects/types.ts`
- `lib/projects/queries.ts`

### 18.2 API

- `app/api/projects/[projectId]/config/route.ts`
- `app/api/projects/[projectId]/episodes/split/route.ts`
- `app/api/projects/[projectId]/episodes/[episodeId]/sources/route.ts`

### 18.3 Prompt 与运行时

- `lib/prompts/domain/episode_split.zh.txt`
- `lib/prompts/domain/episode_split.en.txt`
- `lib/prompts/domain/episode_adaptation.zh.txt`
- `lib/prompts/domain/episode_adaptation.en.txt`
- `lib/prompts/domain/story_clip_segmentation.zh.txt`
- `lib/prompts/domain/story_clip_segmentation.en.txt`
- `lib/prompts/domain/story_screenplay_conversion.zh.txt`
- `lib/prompts/domain/story_screenplay_conversion.en.txt`
- `lib/prompts/domain/story_storyboard_planning.zh.txt`
- `lib/prompts/domain/story_storyboard_planning.en.txt`
- `lib/prompts/schemas.ts`
- `lib/prompts/validators.ts`
- `lib/prompts/catalog.ts`
- `lib/prompts/canary.ts`
- `lib/production/action-cues.ts`
- `lib/novel/story-to-script-runtime.ts`
- `lib/novel/script-to-storyboard-runtime.ts`

### 18.4 UI

- `components/agent/shell/shell-settings.ts`
- `components/agent/shell/preferences-settings-panel.tsx`
- `components/agent/shell/chat-shell-i18n.ts`
- `features/studio/components/workspace-topbar.tsx`
- `features/studio/writing/adaptation-dialog.tsx`
- `features/studio/writing/writing-workspace.tsx`
- `features/studio/api.ts`
- `features/studio/i18n.ts`

### 18.5 测试

- `lib/episodes/adaptation.test.ts`
- `lib/episodes/split.test.ts`
- `lib/episodes/split-persistence.test.ts`
- `lib/prompts/validators.test.ts`
- `lib/prompts/registry.test.ts`
- `lib/prompts/canary.test.ts`
- `lib/novel/story-to-script-runtime.test.ts`
- `lib/novel/script-to-storyboard-runtime.test.ts`
- `features/studio/api.test.ts`
- 项目 Config Route 新增定向测试
- Production Plan 新增独立单元测试

## 19. 实施阶段与门禁

### Phase 0：冻结黄金样例

状态：待实施

- 把第 1 章原文作为测试 fixture，不把完整版权文本塞进通用单元测试时则使用等价短样例，并把本地完整样例用于专项验收。
- 固定预期事件、转场、关键对白、神秘器物特效和 90 秒预算。
- 记录当前输出，作为变更前基线。

门禁：样例明确到“哪些事实不能删、哪些说明可压缩、哪些动作必须出现”。

### Phase 1：数据合同与配置

状态：待实施

- 新增 Prisma 字段、迁移、共享类型、Config API 和最小 UI 配置。
- 增加 Production Plan 解析/序列化和历史空值兼容。

门禁：数据库迁移、Prisma 校验、60/85/90 边界测试和旧数据读取全部通过。

### Phase 2：单次改编请求

状态：待实施

- 建立无损 Source Units。
- 扩展 adaptation Schema、双语 Prompt、流式阶段和服务端 Validator。
- 一次返回正文与完整 Production Plan 并一起落库。

门禁：缺 beat、漏 source unit、超 90 秒、旁白超量、台词超时、地点变化无转场、动作链缺步骤时均不能保存。

### Phase 3：剧本继承

状态：待实施

- Beat-aware clip 切分。
- 剧本 Prompt、Schema、Validator 和复用逻辑接入 Production Plan。
- effects 扩展到 artifact/phenomenon。

门禁：Production Plan 中每个动作链、转场、对白和 effect 都在剧本正文结构中有对应实现。

### Phase 4：分镜继承与总时长

状态：待实施

- 分镜 planning、fallback、input hash 和整集聚合校验接入节拍预算。
- 跨 clip 校验总秒数、地点转场和 beat 顺序。

门禁：整集分镜不超过 90 秒；降级分镜不丢动作、特效、音效和转场；口播最短时长继续成立。

### Phase 5：UI 可观测与专项全流程

状态：待实施

- 展示配置、生成阶段和计划摘要。
- 在独立测试集或克隆集上重跑第 1 章，不覆盖已有图片提示词、图片和视频资产。
- 依次检查改编、剧本、分镜、媒体提示词、TTS 输入和最终 Timeline。

门禁：实际模型专项流程通过本文件第 21 节验收；失败时从最早破坏合同的阶段修复，不在下游打补丁掩盖。

## 20. 测试矩阵

| 层级 | 必测场景 | 预期 |
| --- | --- | --- |
| Config | 59、60、85、90、91、浮点和字符串 | 仅 60–90 整数成功 |
| Source Units | 标题、段落、引号、多段对白、空白 | offset 有序且原文无损 |
| Coverage | 漏 ID、重复 ID、未知 ID、伪造 evidence | 明确错误且不落库 |
| Runtime | beat 求和 89/90/91 | 89/90 成功，91 阻断 |
| Dialogue | 单 beat 台词估时大于 beat | `DIALOGUE_DURATION_OVERFLOW` |
| Narration | 3 条或超过 60 个中文字 | 阻断 |
| Transition | 相邻 location 改变但无 transition | 阻断 |
| Action chain | 状态变化缺 preparation/settle | 阻断 |
| Interaction | 道具交接无接收方反应或结束状态 | 阻断 |
| Effects | 神秘器物有异象但无 effect/actionDesign | 阻断 |
| Persistence | 新旧改编版本并存 | 计划仅绑定对应版本 |
| Activation | 修改项目目标后激活旧稿 | 仍使用旧稿快照并提示重新生成 |
| Screenplay | coverage 有 beat 但 scene 未实现 | 阻断 |
| Storyboard | panel 只挂证据、不演动作 | 现有/新增 Validator 阻断 |
| Fallback | 模型结构化输出失败 | 保留 beat、时长、VFX/SFX、对白和转场 |
| Cache | 同正文不同 Production Plan | 不复用错误 phase/fallback |
| Streaming | 正文结束后进入校验/纠错 | UI 阶段准确，不无限转圈 |
| Legacy | 原文或历史改编无计划 | 兼容读取并明确标识 |

## 21. 第 1 章黄金样例验收

### 21.1 单集结构

第 1 章保持为一集，不拆为两个 70 秒片段。建议预算：

| 时间 | 节拍 | 建议镜头 | 声音/表演重点 |
| ---: | --- | ---: | --- |
| 0–7 秒 | 太炎镇、韩家庄、寒夜灯笼 | 2 | 环境风声、灯笼摇响，无旁白或仅一句地点旁白 |
| 7–22 秒 | 韩宇训练并举起铁石 | 3 | 呼吸、骨骼、铁石摩擦；准备、发力、离地、停稳完整 |
| 22–31 秒 | 放稳铁石并返回偏院 | 2 | 擦汗、望夜、离场、回廊路径、竹篱入场 |
| 31–47 秒 | 发现父亲做饭，父子见面，确认突破 | 3 | 韩宇先停步再开口，扶坐/视线/桌上热菜参与表演 |
| 47–56 秒 | 饭桌互动与修炼目标 | 2 | 对白和夹菜、握手、观察伤势等动作并行 |
| 56–64 秒 | 饭后进入卧房 | 1–2 | 起身、引路、跟随、入室、落位，不瞬移 |
| 64–77 秒 | 取铁盒、开盒、无字典籍、交接 | 3 | 手部交接；奇异气息、微光和对应能量/环境音 |
| 77–90 秒 | 母亲仍在世、阴阳境门槛、结尾钩子 | 3 | 追问、父亲迟疑/咳嗽、世界规则压缩、韩宇震动反应 |

合计约 19–20 镜头。不是“前 10 秒有动作、后 60 秒全是对话”，而是约 35–45 秒纯视觉/转场/反应，约 35–50 秒带对白的动作表演，两者在多个 beat 中重叠。

### 21.2 必须保留的动作过程

```text
韩宇放稳铁石、擦汗、望向夜幕，转身离开练武场。
他穿过灯笼摇曳的回廊，走向庄院边缘。
韩宇穿过竹篱院门，在屋舍前停下，推门进入。
他先看见父亲站在桌边，脚步停住，随后开口。
```

进入卧房、父亲取盒、开盒、拿出典籍和递给韩宇也必须按相同原则形成连续状态，不能一句“父亲把典籍交给他”全部跳过。

### 21.3 对白验收

- 不能只剩 4 句对白。
- 应保留父子问候、突破确认、修炼决心、母亲遗物、母亲仍在世、为何不能相见、阴阳境门槛和结尾重复/反应。
- 原文大段炼体说明压缩成一句有依据的角色说明或视觉信息，不用连续旁白朗读。
- 建议口播总量约 130–200 个中文字；最终以 4.2 字/秒公式和实际 beat 预算为准。

### 21.4 特效验收

- 铁盒开启后“牵引心神的奇异气息”必须进入 effect -> actionDesign -> storyboard VFX/SFX -> video prompt。
- 特效只表现已确认的奇异气息和典籍异常，不提前展示母亲身份、典籍能力或原文未揭示的力量。

### 21.5 最终判定

必须同时满足：

- 一章一集
- 总时长不超过 90 秒
- 关键事件与结尾钩子完整
- 转场和道具交接过程完整
- 对白不是 4 句，也没有旁白泛滥
- 对白期间存在表演和互动
- 神秘器物异象进入 VFX/SFX
- 分镜与降级分镜均继承生产合同

## 22. 兼容、回滚与数据安全

- 所有新数据库字段可空或有默认值，迁移不回填虚假 Production Plan。
- 新 Prompt/Validator 只对新生成的改编计划启用硬合同；历史稿可读取、可查看。
- 计划内每个 Phase 独立提交，中英文 Prompt 和对应 Canary 必须在同一提交中完成。
- 如果某阶段失败，回滚该阶段代码和迁移，不删除用户已有稿件、图片提示词、图片、视频或音频。
- 专项全流程使用克隆集或新版本；未经用户确认不清理现有生产资产。
- 不通过静默降级、删镜头、删台词或跳过媒体来制造“成功”。

## 23. 完成定义

本计划不是以“Prompt 已修改”作为完成，而是以下条件全部满足：

1. 数据库能版本化保存 Production Plan。
2. 新改编正常只需一次结构化生成即可返回正文和计划。
3. 服务端能阻断超 90 秒、漏事件、无转场、动作链不全、旁白超量和台词超时。
4. 剧本和分镜实际实现每个节拍，不能只挂 coverage/evidence 标签。
5. 打斗、人物互动、表演、角色动作、神秘器物和异象都能进入下游媒体提示词。
6. 降级分镜保留相同生产合同。
7. 第 1 章专项流程达到第 21 节标准。
8. Prisma、TypeScript、定向测试、全量测试、变更文件 ESLint 和 Prompt Canary 全部通过。
