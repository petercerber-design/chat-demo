import type { ChatModel } from '../api/types.js'

/** 模型服务商；当前只有 DeepSeek。 */
export type ModelProvider = 'deepseek'

/** 没有记录模型的旧会话按 DeepSeek V4 Pro 处理。 */
export const DEFAULT_MODEL: ChatModel = 'deepseek-v4-pro'
export const DEFAULT_MODEL_PROVIDER: ModelProvider = 'deepseek'

export type ModelOption = {
  provider: ModelProvider
  providerName: string
  model: ChatModel
}

/** 可选模型及所属服务商，顺序即模型切换菜单的顺序。 */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-flash' },
  { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-v4-pro' },
]

const CHAT_MODELS: readonly string[] = MODEL_OPTIONS.map((option) => option.model)

export const MODEL_PROVIDER_NAMES: Record<ModelProvider, string> = {
  deepseek: 'DeepSeek',
}

export const isChatModel = (value: unknown): value is ChatModel =>
  typeof value === 'string' && CHAT_MODELS.includes(value)

/** 模型所属服务商；按模型查找，便于以后接入其他服务商。 */
export const providerOf = (model: ChatModel): ModelProvider =>
  MODEL_OPTIONS.find((option) => option.model === model)?.provider ?? DEFAULT_MODEL_PROVIDER

/** 旧会话缺省按 DeepSeek V4 Pro 处理。 */
export const getSessionModel = (session: { model?: ChatModel }): ChatModel =>
  session.model ?? DEFAULT_MODEL

export const getSessionProvider = (session: {
  provider?: ModelProvider
  model?: ChatModel
}): ModelProvider => session.provider ?? providerOf(getSessionModel(session))

export const getProviderName = (provider: ModelProvider): string =>
  MODEL_PROVIDER_NAMES[provider]
