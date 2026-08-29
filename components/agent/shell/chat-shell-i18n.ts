import type { AgentLocale } from "./chat-shell-types";

export type ShellCopy = {
  accountLabel: string;
  apiKey: string;
  archivedChats: string;
  archiveDescription: string;
  archiveEmpty: string;
  baseUrl: string;
  chinese: string;
  clearConnection: string;
  compactSidebar: string;
  connectionError: string;
  connectionErrorDescription: string;
  connectionIdle: string;
  connectionLoading: string;
  connectionSuccess: string;
  currentModel: string;
  dramaStudio: string;
  english: string;
  help: string;
  helpDescription: string;
  helpNewChat: string;
  helpNewChatValue: string;
  helpSearch: string;
  helpSearchValue: string;
  helpSettings: string;
  helpSettingsValue: string;
  hideApiKey: string;
  inputPlaceholder: string;
  language: string;
  logout: string;
  modelConnection: string;
  modelConnectionDescription: string;
  newChat: string;
  noMatchingChats: string;
  openAccountMenu: string;
  openSettings: string;
  openWorkspaceMenu: string;
  projectVersion: string;
  provider: string;
  promptStarterImage: string;
  promptStarterImageDescription: string;
  promptStarterProjectDescription: string;
  promptSuggestionsLabel: string;
  promptStarterDescription: string;
  promptStarterTitle: string;
  promptStarterVideo: string;
  promptStarterVideoDescription: string;
  recentChats: string;
  refreshModels: string;
  runtime: string;
  search: string;
  searchChats: string;
  searchDescription: string;
  searchPlaceholder: string;
  selectModel: string;
  settings: string;
  settingsAccount: string;
  settingsAccountRedirecting: string;
  settingsAdmin: string;
  settingsChannels: string;
  settingsChannelsDescription: string;
  settingsChannelEndpoint: string;
  settingsChannelApiKeys: string;
  settingsApiKeyMode: string;
  settingsApiKeyModeSingle: string;
  settingsApiKeyModeBatch: string;
  settingsAddApiKey: string;
  settingsRemoveApiKey: (index: number) => string;
  settingsChannelModels: string;
  settingsChannelName: string;
  settingsChannelProtocol: string;
  settingsChannelModelCount: (count: number) => string;
  settingsChannelSelectModels: string;
  settingsChannelNoModels: string;
  settingsSelectChannelModelsTitle: string;
  settingsSearchModels: string;
  settingsManualModelName: string;
  settingsAddModel: string;
  settingsFetchModels: string;
  settingsFetchedModels: string;
  settingsExistingModels: string;
  settingsSelectedCurrentModels: string;
  settingsSelectAll: string;
  settingsClearSelection: string;
  settingsNoSelectedModels: string;
  settingsConfirm: string;
  settingsCapabilityImage: string;
  settingsCapabilityVideo: string;
  settingsCapabilityText: string;
  settingsCapabilityAudio: string;
  settingsCallScript: string;
  settingsAddChannel: string;
  settingsCopyChannel: string;
  settingsChannelCopySuffix: string;
  settingsEditChannel: string;
  settingsDeleteChannel: string;
  settingsNewChannel: string;
  settingsSave: string;
  settingsCancel: string;
  settingsFinish: string;
  settingsDefaultChannel: string;
  settingsPreferences: string;
  settingsPreferencesDescription: string;
  settingsRuntime: string;
  settingsRuntimeDescription: string;
  settingsRuntimeRequests: string;
  settingsRuntimeRequestsDescription: string;
  settingsStructuredTimeout: string;
  settingsStructuredTimeoutHint: string;
  settingsStructuredStreaming: string;
  settingsStreamingEnabled: string;
  settingsStreamingDisabled: string;
  settingsTransportAttempts: string;
  settingsTransportAttemptsHint: string;
  settingsWorkflowExecution: string;
  settingsWorkflowExecutionDescription: string;
  settingsWorkflowAttempts: string;
  settingsWorkflowAttemptsHint: string;
  settingsWorkflowConcurrency: string;
  settingsWorkflowConcurrencyHint: string;
  settingsClipMaxChars: string;
  settingsClipMaxCharsHint: string;
  settingsRuntimeLoadError: string;
  settingsRuntimeSaveError: string;
  settingsRuntimeSaveSuccess: string;
  settingsRuntimeSaving: string;
  settingsRuntimeReset: string;
  settingsImageGeneration: string;
  settingsImageGenerationDescription: string;
  settingsVideoGeneration: string;
  settingsVideoGenerationDescription: string;
  settingsGenerationRatio: string;
  settingsGenerationResolution: string;
  settingsImageCount: string;
  settingsImageCountHint: string;
  settingsImageQuality: string;
  settingsImageQualityAuto: string;
  settingsImageQualityHigh: string;
  settingsVideoDuration: string;
  settingsWorkflowModels: string;
  settingsWorkflowModelsDescription: string;
  settingsAnalysisModel: string;
  settingsCharacterModel: string;
  settingsLocationModel: string;
  settingsStoryboardModel: string;
  settingsEditModel: string;
  settingsVideoModel: string;
  settingsAudioModel: string;
  settingsLipSyncModel: string;
  settingsCreativeDefaults: string;
  settingsCreativeDefaultsDescription: string;
  settingsVideoRatio: string;
  settingsArtStyle: string;
  settingsArtStyleAmericanComic: string;
  settingsArtStyleChineseComic: string;
  settingsArtStyleChineseInk: string;
  settingsArtStyleJapaneseAnime: string;
  settingsArtStyleStylized3d: string;
  settingsArtStyleRealistic: string;
  settingsVisualEra: string;
  settingsVisualEraSource: string;
  settingsVisualEraPremodern: string;
  settingsVisualEraContemporary: string;
  settingsVisualEraCustom: string;
  settingsVisualEraCustomPrompt: string;
  settingsVisualEraCustomPlaceholder: string;
  settingsTtsRate: string;
  settingsTtsRateNormal: string;
  settingsTtsRateSlightlyFast: string;
  settingsTtsRateFast: string;
  settingsTtsRateVeryFast: string;
  settingsDescription: string;
  showApiKey: string;
  showModelName: string;
  switchLanguage: string;
  switchModel: string;
  switchTheme: string;
  testConnection: string;
  workspace: string;
};

export const shellCopyByLocale: Record<AgentLocale, ShellCopy> = {
  en: {
    accountLabel: "Cyanyi Drama",
    apiKey: "API Key",
    archivedChats: "Archived chats",
    archiveDescription:
      "Review saved conversations that are out of the main list.",
    archiveEmpty: "No archived chats",
    baseUrl: "Base URL",
    chinese: "简体中文",
    clearConnection: "Clear",
    compactSidebar: "Compact sidebar",
    connectionError: "Connection failed",
    connectionErrorDescription:
      "Check the Base URL, API Key, network access, and whether the service supports /models.",
    connectionIdle: "Not tested",
    connectionLoading: "Connecting...",
    connectionSuccess: "Connected",
    currentModel: "Current model",
    dramaStudio: "Drama Studio",
    english: "English",
    help: "Help",
    helpDescription:
      "Use conversations for quick creative tasks and projects for complete production workflows.",
    helpNewChat: "New chat",
    helpNewChatValue: "Clears the current thread state.",
    helpSearch: "Search",
    helpSearchValue: "Filters saved conversations.",
    helpSettings: "Settings",
    helpSettingsValue:
      "Manages model channels, creative defaults, and runtime behavior.",
    hideApiKey: "Hide API Key",
    inputPlaceholder: "Ask AI...",
    language: "Language",
    logout: "Log out",
    modelConnection: "Model connection",
    modelConnectionDescription:
      "Use an OpenAI-compatible Base URL and API Key for local template testing.",
    newChat: "New chat",
    noMatchingChats: "No matching chats",
    openAccountMenu: "Open account menu",
    openSettings: "Open settings",
    openWorkspaceMenu: "Open workspace menu",
    projectVersion: "Project version",
    provider: "Provider",
    promptStarterImage: "Generate an image",
    promptStarterImageDescription:
      "Create character, location, prop, or storyboard references.",
    promptStarterProjectDescription:
      "Manage scripts, assets, storyboards, audio, and final delivery.",
    promptSuggestionsLabel: "Ask the creative agent",
    promptStarterDescription:
      "Plan with the agent, generate media directly, or move into a complete production project.",
    promptStarterTitle: "What do you want to create?",
    promptStarterVideo: "Generate a video",
    promptStarterVideoDescription:
      "Turn a shot description or visual reference into a video clip.",
    recentChats: "Chats",
    refreshModels: "Refresh models",
    runtime: "Runtime",
    search: "Search",
    searchChats: "Search chats",
    searchDescription: "Find a recent or archived conversation.",
    searchPlaceholder: "Search by title",
    selectModel: "Select model",
    settings: "Settings",
    settingsAccount: "Account",
    settingsAccountRedirecting: "Opening payment...",
    settingsAdmin: "Administration",
    settingsChannels: "Channels",
    settingsChannelsDescription:
      "Configure the runtime connection used by chat and media generation.",
    settingsChannelEndpoint: "Endpoint",
    settingsChannelApiKeys: "Additional API Keys",
    settingsApiKeyMode: "Add mode",
    settingsApiKeyModeSingle: "Single key",
    settingsApiKeyModeBatch: "Batch add (one key per line)",
    settingsAddApiKey: "Add key",
    settingsRemoveApiKey: (index) => `Remove API key ${index}`,
    settingsChannelModels: "Channel models",
    settingsChannelName: "Channel name",
    settingsChannelProtocol: "Protocol",
    settingsChannelModelCount: (count) => `${count} models`,
    settingsChannelSelectModels: "Select models",
    settingsChannelNoModels: "Click Select models to add models.",
    settingsSelectChannelModelsTitle: "Select channel models",
    settingsSearchModels: "Search models",
    settingsManualModelName: "Enter model name",
    settingsAddModel: "Add model",
    settingsFetchModels: "Fetch model list",
    settingsFetchedModels: "Fetched models",
    settingsExistingModels: "Existing models",
    settingsSelectedCurrentModels: "Selected in this channel",
    settingsSelectAll: "Select all",
    settingsClearSelection: "Clear selection",
    settingsNoSelectedModels: "No models selected.",
    settingsConfirm: "Confirm",
    settingsCapabilityImage: "Image",
    settingsCapabilityVideo: "Video",
    settingsCapabilityText: "Text",
    settingsCapabilityAudio: "Audio",
    settingsCallScript: "Call script",
    settingsAddChannel: "Add channel",
    settingsCopyChannel: "Copy channel",
    settingsChannelCopySuffix: "(Copy)",
    settingsEditChannel: "Edit channel",
    settingsDeleteChannel: "Delete channel",
    settingsNewChannel: "New channel",
    settingsSave: "Save",
    settingsCancel: "Cancel",
    settingsFinish: "Done",
    settingsDefaultChannel: "Default channel",
    settingsPreferences: "Preferences",
    settingsPreferencesDescription:
      "Adjust the workspace layout and model display preferences.",
    settingsRuntime: "Runtime settings",
    settingsRuntimeDescription:
      "Control model request reliability and workflow execution defaults.",
    settingsRuntimeRequests: "Model requests",
    settingsRuntimeRequestsDescription:
      "Global request behavior for all structured model calls.",
    settingsStructuredTimeout: "Request timeout (seconds)",
    settingsStructuredTimeoutHint: "10-3600 seconds per request.",
    settingsStructuredStreaming: "Response mode",
    settingsStreamingEnabled: "Streaming",
    settingsStreamingDisabled: "Non-streaming",
    settingsTransportAttempts: "Transport attempts",
    settingsTransportAttemptsHint: "1-10 attempts for connection failures.",
    settingsWorkflowExecution: "Workflow execution",
    settingsWorkflowExecutionDescription:
      "Defaults used when a workflow does not provide an explicit value.",
    settingsWorkflowAttempts: "Step attempts",
    settingsWorkflowAttemptsHint: "1-10 attempts before a step is exhausted.",
    settingsWorkflowConcurrency: "Default concurrency",
    settingsWorkflowConcurrencyHint: "1-8 clips processed at the same time.",
    settingsClipMaxChars: "Clip character limit",
    settingsClipMaxCharsHint: "400-4000 source characters per screenplay clip.",
    settingsRuntimeLoadError: "Failed to load runtime settings.",
    settingsRuntimeSaveError: "Failed to save runtime settings.",
    settingsRuntimeSaveSuccess: "Runtime settings saved.",
    settingsRuntimeSaving: "Saving...",
    settingsRuntimeReset: "Restore defaults",
    settingsImageGeneration: "Image generation",
    settingsImageGenerationDescription:
      "Defaults used by image tasks and the /chat image composer unless a request overrides them.",
    settingsVideoGeneration: "Video generation",
    settingsVideoGenerationDescription:
      "Defaults used by video tasks and the /chat video composer unless a request overrides them.",
    settingsGenerationRatio: "Aspect ratio",
    settingsGenerationResolution: "Resolution",
    settingsImageCount: "Image count",
    settingsImageCountHint: "Generate 1-4 images for each image task.",
    settingsImageQuality: "Quality",
    settingsImageQualityAuto: "Automatic",
    settingsImageQualityHigh: "High",
    settingsVideoDuration: "Default duration",
    settingsWorkflowModels: "Workflow models",
    settingsWorkflowModelsDescription:
      "Defaults used by each generation workflow.",
    settingsAnalysisModel: "AI analysis model",
    settingsCharacterModel: "Character image model",
    settingsLocationModel: "Location image model",
    settingsStoryboardModel: "Storyboard image model",
    settingsEditModel: "Image editing model",
    settingsVideoModel: "Video model",
    settingsAudioModel: "Audio model",
    settingsLipSyncModel: "Lip sync model",
    settingsCreativeDefaults: "Creative defaults",
    settingsCreativeDefaultsDescription:
      "Project defaults shared by image, video, and TTS generation.",
    settingsVideoRatio: "Video ratio",
    settingsArtStyle: "Art style",
    settingsArtStyleAmericanComic: "American comic",
    settingsArtStyleChineseComic: "Chinese animation",
    settingsArtStyleChineseInk: "Chinese ink animation",
    settingsArtStyleJapaneseAnime: "Japanese anime",
    settingsArtStyleStylized3d: "Stylized 3D animation",
    settingsArtStyleRealistic: "Live-action realism",
    settingsVisualEra: "Visual era / adaptation world",
    settingsVisualEraSource: "Follow source",
    settingsVisualEraPremodern: "Premodern Eastern",
    settingsVisualEraContemporary: "Contemporary adaptation",
    settingsVisualEraCustom: "Custom world",
    settingsVisualEraCustomPrompt: "Custom visual-world rules",
    settingsVisualEraCustomPlaceholder:
      "For example: retro-futurist 1990s city; preserve cultivation ranks but modernize wardrobe, buildings, and transport.",
    settingsTtsRate: "TTS speed",
    settingsTtsRateNormal: "Normal (1.0x)",
    settingsTtsRateSlightlyFast: "Slightly fast (1.2x)",
    settingsTtsRateFast: "Fast (1.5x)",
    settingsTtsRateVeryFast: "Very fast (2.0x)",
    settingsDescription:
      "Manage model channels, creative defaults, and workflow runtime behavior.",
    showApiKey: "Show API Key",
    showModelName: "Show model name",
    switchLanguage: "Switch language",
    switchModel: "Switch model",
    switchTheme: "Switch theme",
    testConnection: "Test connection",
    workspace: "Workspace",
  },
  "zh-CN": {
    accountLabel: "Cyanyi Drama",
    apiKey: "API Key",
    archivedChats: "归档会话",
    archiveDescription: "查看暂时不在主列表中的已保存会话。",
    archiveEmpty: "暂无归档会话",
    baseUrl: "Base URL",
    chinese: "简体中文",
    clearConnection: "清除",
    compactSidebar: "紧凑侧边栏",
    connectionError: "连接失败",
    connectionErrorDescription:
      "检查 Base URL、API Key、网络访问，以及服务是否支持 /models。",
    connectionIdle: "尚未测试",
    connectionLoading: "连接中...",
    connectionSuccess: "连接成功",
    currentModel: "当前模型",
    dramaStudio: "漫剧创作",
    english: "English",
    help: "帮助",
    helpDescription:
      "会话适合快速创作任务，完整制作流程统一进入项目工作台。",
    helpNewChat: "新建会话",
    helpNewChatValue: "清空当前会话状态。",
    helpSearch: "搜索",
    helpSearchValue: "筛选已经保存的会话。",
    helpSettings: "设置",
    helpSettingsValue: "管理模型渠道、创作默认值和工作流运行参数。",
    hideApiKey: "隐藏 API Key",
    inputPlaceholder: "问问 AI...",
    language: "语言",
    logout: "退出登录",
    modelConnection: "模型连接",
    modelConnectionDescription:
      "用于本地模板调试的 OpenAI-compatible Base URL 和 API Key。",
    newChat: "新建会话",
    noMatchingChats: "没有匹配的会话",
    openAccountMenu: "打开账户菜单",
    openSettings: "打开设置",
    openWorkspaceMenu: "打开工作区菜单",
    projectVersion: "项目版本",
    provider: "提供商",
    promptStarterImage: "生成图片",
    promptStarterImageDescription: "制作角色、场景、道具或分镜视觉参考。",
    promptStarterProjectDescription:
      "管理剧本、资产、分镜、声音和最终交付。",
    promptSuggestionsLabel: "直接问创作助手",
    promptStarterDescription:
      "可以先和助手规划，也可以直接生成媒体，完整制作流程请进入项目工作台。",
    promptStarterTitle: "今天要创作什么？",
    promptStarterVideo: "生成视频",
    promptStarterVideoDescription: "把镜头描述或视觉参考生成视频片段。",
    recentChats: "会话",
    refreshModels: "刷新模型",
    runtime: "运行时",
    search: "搜索",
    searchChats: "搜索会话",
    searchDescription: "查找最近或已归档的会话。",
    searchPlaceholder: "按标题搜索",
    selectModel: "选择模型",
    settings: "设置",
    settingsAccount: "账户",
    settingsAccountRedirecting: "正在跳转支付...",
    settingsAdmin: "管理员设置",
    settingsChannels: "渠道",
    settingsChannelsDescription: "配置聊天和媒体生成使用的运行时连接。",
    settingsChannelEndpoint: "接口地址",
    settingsChannelApiKeys: "备用 API Keys",
    settingsApiKeyMode: "添加模式",
    settingsApiKeyModeSingle: "单密钥",
    settingsApiKeyModeBatch: "批量添加（每行一个密钥）",
    settingsAddApiKey: "添加 Key",
    settingsRemoveApiKey: (index) => `删除备用 API Key ${index}`,
    settingsChannelModels: "渠道模型",
    settingsChannelName: "渠道名称",
    settingsChannelProtocol: "协议",
    settingsChannelModelCount: (count) => `${count} 个模型`,
    settingsChannelSelectModels: "选择模型",
    settingsChannelNoModels: "点击“选择模型”拉取或手动增加模型。",
    settingsSelectChannelModelsTitle: "选择渠道模型",
    settingsSearchModels: "搜索模型",
    settingsManualModelName: "输入模型名称",
    settingsAddModel: "增加模型",
    settingsFetchModels: "拉取模型列表",
    settingsFetchedModels: "新获取的模型",
    settingsExistingModels: "已有的模型",
    settingsSelectedCurrentModels: "当前列表已选择",
    settingsSelectAll: "全选当前列表",
    settingsClearSelection: "取消当前列表",
    settingsNoSelectedModels: "暂无已选择的模型。",
    settingsConfirm: "确定",
    settingsCapabilityImage: "生图",
    settingsCapabilityVideo: "视频",
    settingsCapabilityText: "文本",
    settingsCapabilityAudio: "音频",
    settingsCallScript: "调用脚本",
    settingsAddChannel: "新增渠道",
    settingsCopyChannel: "复制渠道",
    settingsChannelCopySuffix: "副本",
    settingsEditChannel: "编辑渠道",
    settingsDeleteChannel: "删除渠道",
    settingsNewChannel: "新增渠道",
    settingsSave: "保存",
    settingsCancel: "取消",
    settingsFinish: "完成",
    settingsDefaultChannel: "默认渠道",
    settingsPreferences: "偏好设置",
    settingsPreferencesDescription: "调整工作区布局和模型显示偏好。",
    settingsRuntime: "运行设置",
    settingsRuntimeDescription: "控制模型请求可靠性和工作流执行默认值。",
    settingsRuntimeRequests: "模型请求",
    settingsRuntimeRequestsDescription:
      "统一作用于所有结构化模型调用，新任务会使用保存后的参数。",
    settingsStructuredTimeout: "单次请求超时（秒）",
    settingsStructuredTimeoutHint: "范围 10-3600 秒。",
    settingsStructuredStreaming: "响应模式",
    settingsStreamingEnabled: "流式响应",
    settingsStreamingDisabled: "非流式响应",
    settingsTransportAttempts: "传输尝试次数",
    settingsTransportAttemptsHint: "连接中断时尝试 1-10 次。",
    settingsWorkflowExecution: "工作流执行",
    settingsWorkflowExecutionDescription:
      "工作流没有显式指定参数时使用这些全局默认值。",
    settingsWorkflowAttempts: "步骤尝试次数",
    settingsWorkflowAttemptsHint: "单步骤用尽 1-10 次后标记失败。",
    settingsWorkflowConcurrency: "默认并发数",
    settingsWorkflowConcurrencyHint: "同时处理 1-8 个剧本片段。",
    settingsClipMaxChars: "剧本分段字符上限",
    settingsClipMaxCharsHint: "每段原文 400-4000 字符。",
    settingsRuntimeLoadError: "运行设置加载失败。",
    settingsRuntimeSaveError: "运行设置保存失败。",
    settingsRuntimeSaveSuccess: "运行设置已保存。",
    settingsRuntimeSaving: "保存中...",
    settingsRuntimeReset: "恢复默认值",
    settingsImageGeneration: "图片生成",
    settingsImageGenerationDescription:
      "图片任务和 /chat 图片模式的默认参数，请求显式选择时优先使用本次参数。",
    settingsVideoGeneration: "视频生成",
    settingsVideoGenerationDescription:
      "视频任务和 /chat 视频模式的默认参数，请求显式选择时优先使用本次参数。",
    settingsGenerationRatio: "画面比例",
    settingsGenerationResolution: "分辨率",
    settingsImageCount: "生成数量",
    settingsImageCountHint: "每个图片任务生成 1-4 张。",
    settingsImageQuality: "图片质量",
    settingsImageQualityAuto: "自动",
    settingsImageQualityHigh: "高清",
    settingsVideoDuration: "默认时长",
    settingsWorkflowModels: "工作流模型",
    settingsWorkflowModelsDescription:
      "对应各个生成工作流的默认模型。",
    settingsAnalysisModel: "AI 分析模型",
    settingsCharacterModel: "角色图像模型",
    settingsLocationModel: "场景图像模型",
    settingsStoryboardModel: "分镜图像模型",
    settingsEditModel: "修图/编辑模型",
    settingsVideoModel: "视频模型",
    settingsAudioModel: "音频模型",
    settingsLipSyncModel: "口型同步模型",
    settingsCreativeDefaults: "创作默认值",
    settingsCreativeDefaultsDescription:
      "图片、视频和 TTS 生成共用的项目默认配置。",
    settingsVideoRatio: "视频比例",
    settingsArtStyle: "艺术风格",
    settingsArtStyleAmericanComic: "美式漫画",
    settingsArtStyleChineseComic: "国漫影视动画",
    settingsArtStyleChineseInk: "中国水墨动画",
    settingsArtStyleJapaneseAnime: "日系动画",
    settingsArtStyleStylized3d: "风格化 3D 动画",
    settingsArtStyleRealistic: "写实影视",
    settingsVisualEra: "视觉时代 / 改编世界",
    settingsVisualEraSource: "跟随原作",
    settingsVisualEraPremodern: "古代东方",
    settingsVisualEraContemporary: "现代都市改编",
    settingsVisualEraCustom: "自定义世界",
    settingsVisualEraCustomPrompt: "自定义视觉世界规则",
    settingsVisualEraCustomPlaceholder:
      "例如：九十年代复古未来都市；保留修炼境界，但服装、建筑和交通工具现代化。",
    settingsTtsRate: "TTS 语速",
    settingsTtsRateNormal: "正常速度 (1.0x)",
    settingsTtsRateSlightlyFast: "轻微加速 (1.2x)",
    settingsTtsRateFast: "加速 (1.5x)",
    settingsTtsRateVeryFast: "快速 (2.0x)",
    settingsDescription:
      "管理模型渠道、创作默认值和工作流运行参数。",
    showApiKey: "显示 API Key",
    showModelName: "显示模型名称",
    switchLanguage: "切换语言",
    switchModel: "切换模型",
    switchTheme: "切换主题",
    testConnection: "测试连接",
    workspace: "工作区",
  },
};

export function getShellCopy(locale: AgentLocale = "en") {
  return shellCopyByLocale[locale] ?? shellCopyByLocale.en;
}
