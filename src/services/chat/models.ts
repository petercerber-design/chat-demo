import type { ChatModel } from '../api/types.js'
import { ZHIPU_MODEL } from '../api/types.js'

/** 模型服务商：DeepSeek 与智谱（OpenAI 兼容接口）。 */
export type ModelProvider = 'deepseek' | 'zhipu'

/** 没有记录模型的旧会话按 DeepSeek V4 Pro 处理。 */
export const DEFAULT_MODEL: ChatModel = 'deepseek-v4-pro'
export const DEFAULT_MODEL_PROVIDER: ModelProvider = 'deepseek'

export type ModelOption = {
  provider: ModelProvider
  providerName: string
  model: ChatModel
}

/** 可选模型及所属服务商，顺序即模型切换菜单的顺序。智谱接入 GLM-5.3 / GLM-5.3-FlashX。 */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-flash' },
  { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-v4-pro' },
  { provider: 'zhipu', providerName: '智谱', model: ZHIPU_MODEL },
  { provider: 'zhipu', providerName: '智谱', model: 'glm-5.3-flashx' },
]

const CHAT_MODELS: readonly string[] = MODEL_OPTIONS.map((option) => option.model)

export const MODEL_PROVIDER_NAMES: Record<ModelProvider, string> = {
  deepseek: 'DeepSeek',
  zhipu: '智谱',
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
