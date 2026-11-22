import { ApiError, request } from './client.js'
import { readServerSentEvents } from './sse.js'
import { ZHIPU_MODEL, type MessageStreamEvent, type MessageUsage, type StopReason } from './types.js'

/**
 * 智谱 OpenAI 兼容接口：
 * - 对话：POST /chat/completions（流式，SSE 以 `data: [DONE]` 结束）
 * - 文件解析：POST /files/parser/sync（prime-sync，一次返回解析文本）
 * - 鉴权：Authorization: Bearer {API Key}
 * 默认 https://open.bigmodel.cn/api/paas/v4；本地开发可用开发服务器代理覆盖。
 */
export const ZHIPU_API_ORIGIN = __ZHIPU_API_ORIGIN__

export type ZhipuModel = typeof ZHIPU_MODEL

/** GLM-5.3 的最大输出 Token 数 */
export const ZHIPU_MAX_OUTPUT_TOKENS = 131_072

/** GLM-5.3 的推理程度：max 深度推理（默认）、high 增强推理 */
export type ReasoningEffort = 'max' | 'high'

/** GLM-5.3 只接收文本消息；文件在发送前已由文件解析接口转成文本 */
export type ZhipuMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

export type ZhipuWebSearchTool = {
  type: 'web_search'
  web_search: { enable: true; search_result: true ,search_engine:"search_std"}
}

export type ZhipuChatRequest = {
  model: ZhipuModel
  messages: ZhipuMessage[]
  /** 与 OpenAI 一致，固定开启流式 */
  stream: true
  /** GLM-5.3 不支持关闭思考 */
  thinking: { type: 'enabled' }
  reasoning_effort: ReasoningEffort
  temperature: number
  max_tokens?: number
  tools?: ZhipuWebSearchTool[]
  /** 逐块返回累计用量，回复结束时取最后一个值 */
  stream_options?: { chunk_include_usage: true }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 非 2xx 响应体与流中的错误帧：{ error: { code, message } } */
const isErrorBody = (value: unknown): value is { error: { message: string } } =>
  isRecord(value) &&
  isRecord(value.error) &&
  typeof (value.error as { message?: unknown }).message === 'string'

/**
 * 智谱不提供模型列表接口：先用不产生费用的文件列表校验 API Key。
 * 受限 Key（如 GLM Coding Plan）只能调用对话接口，文件接口返回 401/403 时改用一次最小对话请求校验。
 */
export const verifyZhipuApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  try {
    await request(`${ZHIPU_API_ORIGIN}/files?purpose=batch&limit=1`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) {
      throw error
    }
    await request(`${ZHIPU_API_ORIGIN}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ZHIPU_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 64,
        stream: false,
      }),
      signal,
    })
  }
}

export type ParsedZhipuFile = {
  /** 解析任务 id；没有返回时为 null */
  taskId: string | null
  /** 解析出的纯文本 */
  text: string
}

/** 文件扩展名（大写）；智谱的 file_type 参数按扩展名给出，如 PDF、DOCX、PNG。 */
const fileType = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : 'TXT'
}

/**
 * POST /files/parser/sync（prime-sync）：上传文件并同步返回解析文本。
 * 支持 PDF / Word / PPT / 表格 / 图片等；解析失败或结果为空按上传失败处理。
 */
export const parseZhipuFile = async (
  apiKey: string,
  file: File,
  signal?: AbortSignal
): Promise<ParsedZhipuFile> => {
  const form = new FormData()
  form.append('file', file)
  form.append('tool_type', 'prime-sync')
  form.append('file_type', fileType(file.name))
  const response = await request(`${ZHIPU_API_ORIGIN}/files/parser/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  })
  const raw = await response.text()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new ApiError('protocol', raw)
  }
  if (!isRecord(body)) {
    throw new ApiError('protocol', raw)
  }
  const message = typeof body.message === 'string' ? body.message : raw
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (body.status !== undefined && body.status !== 'succeeded') {
    throw new ApiError('http', message, response.status)
  }
  if (!content) {
    throw new ApiError('http', message || raw, response.status)
  }
  return {
    taskId: typeof body.task_id === 'string' && body.task_id ? body.task_id : null,
    text: content,
  }
}

const toUsage = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const prompt = typeof value.prompt_tokens === 'number' ? value.prompt_tokens : undefined
  const completion = typeof value.completion_tokens === 'number' ? value.completion_tokens : undefined
  if (prompt === undefined || completion === undefined) {
    return undefined
  }
  const details = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : undefined
  const cached =
    details && typeof details.cached_tokens === 'number' && details.cached_tokens > 0
      ? details.cached_tokens
      : 0
  return {
    // 与内部用量结构对齐：未命中缓存的输入、缓存读取、缓存写入与输出
    input_tokens: Math.max(0, prompt - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: completion,
  }
}

const toStopReason = (value: unknown): StopReason | undefined => {
  switch (value) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'sensitive':
      return 'refusal'
    default:
      return undefined
  }
}

/**
 * POST /chat/completions（stream: true），把 OpenAI 兼容的增量帧转换成内部流式事件：
 * reasoning_content → thinking 块，content → text 块，finish_reason 与累计 usage 收尾。
 * 收到 `[DONE]` 结束；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamZhipuMessage(
  apiKey: string,
  body: ZhipuChatRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${ZHIPU_API_ORIGIN}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw new ApiError('protocol', await response.text().catch(() => ''))
  }

  let started = false
  let thinkingIndex: number | null = null
  let thinkingClosed = false
  let textIndex: number | null = null
  let nextIndex = 0
  let stopReason: StopReason | undefined
  let usage: MessageUsage | undefined
  let done = false

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data.trim() === '[DONE]') {
      done = true
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (!isRecord(payload)) {
      continue
    }
    if (!started) {
      started = true
      yield {
        type: 'message_start',
        message: {
          id: typeof payload.id === 'string' ? payload.id : '',
          model: body.model,
        },
      }
    }
    // usage 是累计值，先记录再处理内容；最后一个数据块里是最终值。
    usage = toUsage(payload.usage) ?? usage
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
    if (!isRecord(choice)) {
      continue
    }
    const delta = isRecord(choice.delta) ? choice.delta : {}
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : ''
    if (reasoning) {
      if (thinkingIndex === null) {
        thinkingIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    const content = typeof delta.content === 'string' ? delta.content : ''
    if (content) {
      if (thinkingIndex !== null && !thinkingClosed) {
        thinkingClosed = true
        yield { type: 'content_block_stop', index: thinkingIndex }
      }
      if (textIndex === null) {
        textIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: content },
      }
    }
    stopReason = toStopReason(choice.finish_reason) ?? stopReason
  }

  // 没有 [DONE] 也没有结束原因：按断流处理，已收到的内容由调用方决定是否保留。
  if (!done && !stopReason) {
    throw new ApiError('interrupted', '')
  }
  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  }
  if (thinkingIndex !== null && !thinkingClosed) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}
