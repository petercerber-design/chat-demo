/**
 * 模型来源注册表。
 *
 * 新增来源时只需要在这里登记来源、接口地址与模型：设置界面的来源与模型选项、
 * API Key 的存储位置、请求地址都由这些信息推导。能力标记决定请求体能携带哪些字段，
 * 界面上的附件入口也按 filesUrl 是否配置显示。
 */

/** 注册表里单个模型的基础信息；id 在注册表推导出的 ChatModel 中收窄为字面量联合 */
export type ChatModelDefinition = {
  id: string
  /** 设置界面展示的名称 */
  label: string
  /** 支持服务端联网搜索与阅读链接（deepseek_web_search / deepseek_read_url） */
  serverTools: boolean
  /** 支持 safety_check、output_config、title 与 latest_reminder 等 DeepSeek 扩展 */
  deepseekExtensions: boolean
  /** 支持在对应 user 消息前插入 latest_reminder 快照角色 */
  latestReminder: boolean
  /** 支持 thinking 参数；关闭时不再发送，交给服务端默认行为 */
  thinking: boolean
}

export type ProviderInfo = {
  id: string
  /** 设置界面展示的名称 */
  label: string
  /** Messages 接口的完整地址（已包含 /v1/messages，不再拼接） */
  messagesUrl: string
  /** 校验 API Key 的只读模型列表接口；为 null 时改用不产生费用的消息接口探测 */
  modelsUrl: string | null
  /** Files API 集合地址（上传时直接使用，删除时在其后接 /{file_id}）；为 null 表示不支持附件 */
  filesUrl: string | null
  /** 切换到该来源时默认选中的模型 */
  defaultModel: string
  models: readonly ChatModelDefinition[]
}

export const PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    messagesUrl: `${__API_ORIGIN__}/anthropic/v1/messages`,
    modelsUrl: `${__API_ORIGIN__}/models`,
    filesUrl: `${__API_ORIGIN__}/anthropic/v1/files`,
    defaultModel: 'deepseek-v4-pro',
    models: [
      {
        id: 'deepseek-flash',
        label: 'deepseek-flash',
        serverTools: true,
        deepseekExtensions: true,
        latestReminder: true,
        thinking: true,
      },
      {
        id: 'deepseek-v4-pro',
        label: 'deepseek-v4-pro',
        serverTools: false,
        deepseekExtensions: true,
        latestReminder: false,
        thinking: true,
      },
    ],
  },
  glm: {
    id: 'glm',
    label: '智谱 GLM',
    /** 智谱 Claude API 兼容接口：base_url 为 https://open.bigmodel.cn/api/anthropic */
    messagesUrl: 'http://localhost:3005/api/glm/chat',
    modelsUrl: null,
    filesUrl: null,
    defaultModel: 'glm-5.3',
    models: [
      {
        id: 'glm-5.3',
        label: 'glm-5.3',
        serverTools: false,
        deepseekExtensions: false,
        latestReminder: false,
        thinking: true,
      },
      {
        id: 'glm-5.3-flash',
        label: 'glm-5.3-flash',
        serverTools: false,
        deepseekExtensions: false,
        latestReminder: false,
        thinking: true,
      },
      {
        id: 'glm-5.3-flashx',
        label: 'glm-5.3-flashx',
        serverTools: false,
        deepseekExtensions: false,
        latestReminder: false,
        thinking: true,
      },
    ],
  },
} satisfies Record<string, ProviderInfo>

export type ProviderId = keyof typeof PROVIDERS

/** 所有可选的聊天模型 id，按注册表顺序 */
export type ChatModel = (typeof PROVIDERS)[ProviderId]['models'][number]['id']

/** 注册表里单个模型的完整字面量类型（id 已收窄为 ChatModel） */
export type ChatModelInfo = (typeof PROVIDERS)[ProviderId]['models'][number]

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]

export const DEFAULT_PROVIDER: ProviderId = 'deepseek'

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && Object.hasOwn(PROVIDERS, value)

export const isChatModel = (value: unknown): value is ChatModel => {
  if (typeof value !== 'string') {
    return false
  }
  return PROVIDER_IDS.some((provider) =>
    PROVIDERS[provider].models.some((model) => model.id === value)
  )
}

export const getProviderInfo = (provider: ProviderId): ProviderInfo => PROVIDERS[provider]

export const getProviderModels = (provider: ProviderId): readonly ChatModelInfo[] =>
  PROVIDERS[provider].models

/** 该来源是否提供 Files API（上传附件） */
export const providerSupportsFiles = (provider: ProviderId): boolean =>
  PROVIDERS[provider].filesUrl !== null

/** 模型所属的来源；注册表保证每个 id 唯一，找不到时回落到默认来源 */
export const getProviderOfModel = (model: ChatModel): ProviderId => {
  for (const provider of PROVIDER_IDS) {
    if (PROVIDERS[provider].models.some((item) => item.id === model)) {
      return provider
    }
  }
  return DEFAULT_PROVIDER
}

export const getModelInfo = (model: ChatModel): ChatModelInfo => {
  for (const provider of PROVIDER_IDS) {
    const info = PROVIDERS[provider].models.find((item) => item.id === model)
    if (info) {
      return info
    }
  }
  return PROVIDERS[DEFAULT_PROVIDER].models[0]
}

/** 切换来源时选中的模型：优先该来源声明的默认值，配置错误时回落到第一个模型 */
export const getDefaultModel = (provider: ProviderId): ChatModel => {
  const { defaultModel, models } = PROVIDERS[provider]
  return models.some((item) => item.id === defaultModel) ? defaultModel : models[0].id
}

/** 当前模型是否能用 Files API 的 file_id 引用附件 */
export const modelSupportsFiles = (model: ChatModel): boolean =>
  providerSupportsFiles(getProviderOfModel(model))
