import { ZHIPU_MODEL } from '../api/types.js'
import {
  ZHIPU_MAX_OUTPUT_TOKENS,
  type ReasoningEffort,
  type ZhipuChatRequest,
  type ZhipuMessage,
  type ZhipuSearchEngine,
} from '../api/zhipu.js'
import { getContextRounds, getReplyText } from './reply.js'
import type { AssistantMessage, FileAttachment, Message, UserMessage } from './types.js'

/** 文件解析结果拼成一段文本；未解析成功的附件（本地无原件）不进入请求。 */
const fileSection = (file: FileAttachment) =>
  file.parsedText === undefined ? '' : `[${file.name}]\n${file.parsedText}`

/**
 * GLM-5.3 只接收文本：附件解析出的文本作为提问的一部分放在正文之前，
 * 与 DeepSeek 用 file_id 引用附件的请求结构完全不同。
 */
const toUserMessage = (user: UserMessage): ZhipuMessage | null => {
  const sections = user.files.map(fileSection).filter((text) => text !== '')
  if (user.content) {
    sections.push(user.content)
  }
  return sections.length > 0 ? { role: 'user', content: sections.join('\n\n') } : null
}

/** 历史回答只回传正文；思考与工具块不属于 OpenAI 兼容格式的上下文。 */
const toAssistantMessage = (reply: AssistantMessage): ZhipuMessage | null => {
  const content = getReplyText(reply)
  return content ? { role: 'assistant', content } : null
}

/**
 * 把会话转成 OpenAI 兼容的 messages：系统提示词由调用方单独传入，
 * 这里只保留成对的「提问 + 有回答的回复」，最后接上本轮提问。
 * 续写时末尾带上本轮已有回答作为 assistant 前缀。
 */
export const toZhipuMessages = (
  history: Message[],
  question: UserMessage,
  prefix?: AssistantMessage
): ZhipuMessage[] => {
  const messages: ZhipuMessage[] = []
  for (const [user, reply] of getContextRounds(history)) {
    const userMessage = toUserMessage(user)
    const assistantMessage = toAssistantMessage(reply)
    if (userMessage && assistantMessage) {
      messages.push(userMessage, assistantMessage)
    }
  }
  const current = toUserMessage(question)
  if (current) {
    messages.push(current)
  }
  if (prefix?.prefix) {
    const assistant = toAssistantMessage(prefix)
    if (assistant) {
      messages.push(assistant)
    }
  }
  return messages
}

/**
 * 组装智谱 OpenAI 兼容请求：
 * GLM-5.3 强制开启思考（thinking.type 只能传 enabled），推理程度由 reasoning_effort 控制；
 * 智能搜索对应内置 web_search 工具。
 */
export const createZhipuRequest = ({
  system,
  messages,
  temperature,
  reasoningEffort,
  maxTokens,
  search,
  searchEngine,
}: {
  system: string
  messages: ZhipuMessage[]
  temperature: number
  reasoningEffort: ReasoningEffort
  maxTokens: number
  search: boolean
  searchEngine: ZhipuSearchEngine
}): ZhipuChatRequest => ({
  model: ZHIPU_MODEL,
  messages: system.trim() ? [{ role: 'system', content: system }, ...messages] : messages,
  stream: true,
  thinking: { type: 'enabled' },
  reasoning_effort: reasoningEffort,
  temperature,
  max_tokens: Math.min(maxTokens, ZHIPU_MAX_OUTPUT_TOKENS),
  tools: search
    ? [
        {
          type: 'web_search',
          web_search: { enable: true, search_engine: searchEngine, search_result: true },
        },
      ]
    : undefined,
  stream_options: { chunk_include_usage: true },
})
