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
  explore: string;
  exploreDescription: string;
  help: string;
  helpDescription: string;
  helpNewChat: string;
  helpNewChatValue: string;
  helpRuntime: string;
  helpRuntimeValue: string;
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
  openWorkspaceMenu: string;
  provider: string;
  promptSuggestionsLabel: string;
  promptStarterDescription: string;
  recentChats: string;
  refreshModels: string;
  runtime: string;
  search: string;
  searchChats: string;
  searchDescription: string;
  searchPlaceholder: string;
  selectModel: string;
  settings: string;
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
  settingsComingSoon: string;
  settingsPreferences: string;
  settingsPreferencesDescription: string;
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
  settingsArtStyleJapaneseAnime: string;
  settingsArtStyleRealistic: string;
  settingsTtsRate: string;
  settingsTtsRateNormal: string;
  settingsTtsRateSlightlyFast: string;
  settingsTtsRateFast: string;
  settingsTtsRateVeryFast: string;
  settingsPromptSources: string;
  settingsPromptSourcesDescription: string;
  settingsDescription: string;
  settingsWebdav: string;
  settingsWebdavDescription: string;
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
    accountLabel: "Agent UI",
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
    explore: "Explore",
    exploreDescription: "Jump between available runtime demos.",
    help: "Help",
    helpDescription: "Front-end shell interactions for this Agent UI template.",
    helpNewChat: "New chat",
    helpNewChatValue: "Clears the current thread state.",
    helpRuntime: "Runtime",
    helpRuntimeValue: "Switches between example pages.",
    helpSearch: "Search",
    helpSearchValue: "Filters local demo conversations.",
    helpSettings: "Settings",
    helpSettingsValue: "Controls shell preferences and runtime connection.",
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
    openWorkspaceMenu: "Open workspace menu",
    provider: "Provider",
    promptSuggestionsLabel: "Try these prompts",
    promptStarterDescription:
      "Start with a question, generate media, or test a tool call. The composer below can switch between chat, image, and video modes.",
    recentChats: "Chats",
    refreshModels: "Refresh models",
    runtime: "Runtime",
    search: "Search",
    searchChats: "Search chats",
    searchDescription: "Find a recent or archived conversation.",
    searchPlaceholder: "Search by title",
    selectModel: "Select model",
    settings: "Settings",
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
    settingsComingSoon: "This section is not configured yet.",
    settingsPreferences: "Preferences",
    settingsPreferencesDescription:
      "Adjust the workspace layout and model display preferences.",
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
    settingsArtStyleAmericanComic: "Comic style",
    settingsArtStyleChineseComic: "Chinese comic",
    settingsArtStyleJapaneseAnime: "Japanese anime",
    settingsArtStyleRealistic: "Realistic",
    settingsTtsRate: "TTS speed",
    settingsTtsRateNormal: "Normal (1.0x)",
    settingsTtsRateSlightlyFast: "Slightly fast (1.2x)",
    settingsTtsRateFast: "Fast (1.5x)",
    settingsTtsRateVeryFast: "Very fast (2.0x)",
    settingsPromptSources: "Prompt sources",
    settingsPromptSourcesDescription:
      "Manage reusable prompt and template sources.",
    settingsDescription:
      "Defaults are organized around the generation workflow and ready for a future preferences API.",
    settingsWebdav: "WebDAV",
    settingsWebdavDescription:
      "Connect WebDAV storage for syncing workspace assets.",
    showApiKey: "Show API Key",
    showModelName: "Show model name",
    switchLanguage: "Switch language",
    switchModel: "Switch model",
    switchTheme: "Switch theme",
    testConnection: "Test connection",
    workspace: "Workspace",
  },
  "zh-CN": {
    accountLabel: "Agent UI",
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
    explore: "探索",
    exploreDescription: "在可用的运行时示例之间快速切换。",
    help: "帮助",
    helpDescription: "这个 Agent UI 模板的前端壳层交互说明。",
    helpNewChat: "新建会话",
    helpNewChatValue: "清空当前会话状态。",
    helpRuntime: "运行时",
    helpRuntimeValue: "切换到不同的示例页面。",
    helpSearch: "搜索",
    helpSearchValue: "筛选本地演示会话。",
    helpSettings: "设置",
    helpSettingsValue: "控制壳层偏好和运行时连接。",
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
    openWorkspaceMenu: "打开工作区菜单",
    provider: "提供商",
    promptSuggestionsLabel: "试试这些提示",
    promptStarterDescription:
      "从一个问题开始，也可以生成图片、视频或测试工具调用。下方输入区可在聊天、图片和视频模式之间切换。",
    recentChats: "会话",
    refreshModels: "刷新模型",
    runtime: "运行时",
    search: "搜索",
    searchChats: "搜索会话",
    searchDescription: "查找最近或已归档的会话。",
    searchPlaceholder: "按标题搜索",
    selectModel: "选择模型",
    settings: "设置",
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
    settingsComingSoon: "此功能暂未配置。",
    settingsPreferences: "偏好设置",
    settingsPreferencesDescription: "调整工作区布局和模型显示偏好。",
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
    settingsArtStyleAmericanComic: "漫画风",
    settingsArtStyleChineseComic: "精致国漫",
    settingsArtStyleJapaneseAnime: "日系动漫风",
    settingsArtStyleRealistic: "真人风格",
    settingsTtsRate: "TTS 语速",
    settingsTtsRateNormal: "正常速度 (1.0x)",
    settingsTtsRateSlightlyFast: "轻微加速 (1.2x)",
    settingsTtsRateFast: "加速 (1.5x)",
    settingsTtsRateVeryFast: "快速 (2.0x)",
    settingsPromptSources: "提示词来源",
    settingsPromptSourcesDescription: "管理可复用的提示词和模板来源。",
    settingsDescription:
      "偏好字段按生成工作流整理，后续可直接接入偏好接口。",
    settingsWebdav: "WebDAV",
    settingsWebdavDescription: "连接 WebDAV 存储，同步工作区资源。",
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
