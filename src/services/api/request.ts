import { getModelInfo, type ChatModel } from './providers.js'
import type {
  CreateMessageRequest,
  DeepseekReadUrlTool,
  DeepseekWebSearchTool,
  MessageParam,
} from './types.js'

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean): (DeepseekWebSearchTool | DeepseekReadUrlTool)[] => {
  const tools: (DeepseekWebSearchTool | DeepseekReadUrlTool)[] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

export type MessageRequestOptions = {
  model: ChatModel
  system: string
  messages: MessageParam[]
  maxTokens: number
  /** 是否开启深度思考 */
  thinking: boolean
  /** 是否声明服务端搜索工具；模型不支持时忽略 */
  search: boolean
  /** 仅 DeepSeek 扩展使用 */
  safetyCheckLevel: 'low' | 'high'
}

/**
 * 按模型能力组装 Messages 请求体：
 * - DeepSeek：thinking、安全审核、output_config、服务端工具与 latest_reminder 等扩展；
 * - 其它来源（如 GLM）：只发送 Anthropic 标准字段。开启思考时按 Anthropic 协议附带
 *   budget_tokens；关闭时不发送，交给服务端默认行为。
 */
export const buildMessageRequest = ({
  model,
  system,
  messages,
  maxTokens,
  thinking,
  search,
  safetyCheckLevel,
}: MessageRequestOptions): CreateMessageRequest => {
  const info = getModelInfo(model)
  const body: CreateMessageRequest = {
    model,
    system,
    messages,
    max_tokens: maxTokens,
  }
  if (info.thinking) {
    if (info.deepseekExtensions) {
      body.thinking = thinking ? { type: 'enabled' } : { type: 'disabled' }
    } else if (thinking) {
      // budget_tokens 必须小于 max_tokens；过小的上限无法容纳思考预算时不发送
      const budgetTokens = Math.min(32768, maxTokens - 1)
      if (budgetTokens >= 1024) {
        body.thinking = { type: 'enabled', budget_tokens: budgetTokens }
      }
    }
  }
  if (info.deepseekExtensions) {
    body.safety_check = { level: safetyCheckLevel }
    body.output_config = { effort: 'max' }
    body.tools = info.serverTools ? serverTools(search) : []
  } else{
    body.reasoning_effort = "max"
    body.output_config = { effort: 'max' }
    body.temperature = 0.2
  }
  return body
}
