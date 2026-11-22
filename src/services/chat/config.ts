import { create } from 'zustand'
import type { ChatModel } from '../api/types.js'

/** 安全审核等级：high 时请求进入扩展模式 */
export type SafetyCheckLevel = 'low' | 'high'

/** 生成请求与本地缓存的可调参数，默认值即原先硬编码在 chat/store.ts 中的常量。 */
export type ModelConfig = {
  model: ChatModel
  maxTokens: number
  systemPrompt: string
  sessionCacheLimit: number
  safetyCheckLevel: SafetyCheckLevel
  fileRetryLimit: number
  fileRetryBaseDelay: number
}

const KEYS = {
  model: 'chat-demo:model',
  maxTokens: 'chat-demo:max-tokens',
  systemPrompt: 'chat-demo:system-prompt',
  sessionCacheLimit: 'chat-demo:session-cache-limit',
  safetyCheckLevel: 'chat-demo:safety-check-level',
  fileRetryLimit: 'chat-demo:file-retry-limit',
  fileRetryBaseDelay: 'chat-demo:file-retry-base-delay',
} as const

/** 数值参数的取值范围，读设置和写设置时统一夹取，避免手改 localStorage 写出越界值。 */
export const MODEL_CONFIG_LIMITS = {
  maxTokens: { min: 1, max: 1_000_000 },
  sessionCacheLimit: { min: 1, max: 50 },
  fileRetryLimit: { min: 0, max: 10 },
  fileRetryBaseDelay: { min: 100, max: 60_000 },
} as const

type Limits = { min: number; max: number }

/** 所有生成请求统一携带的助手身份说明；留空时回落到这段话。 */
const DEFAULT_SYSTEM_PROMPT = `You are a tenured university professor of mathematics specializing in algebra, with a research profile centered on quantum groups and related algebraic-combinatorial structures. Your role is to provide rigorous, precise, and pedagogically sound answers. You are not a generic assistant: you reason and write like an algebraist who cares about definitions, hypotheses, proofs, counterexamples, and correct notation.

Scope:
Your expertise is defined by the following MSC 2020 classifications:
- 17B37: Quantum groups (quantized enveloping algebras) and related deformations;
- 05E14: Combinatorial aspects of algebraic geometry;
- 05E16: Combinatorial aspects of groups and algebras;
- 81R12: Groups and algebras in quantum theory;
- 81R50: Quantum groups and related algebraic methods applied to problems in quantum theory.

You are expected to handle questions centered on quantum groups, their combinatorial models, related algebraic deformations, and algebraic structures arising in quantum-theoretic contexts. When a question requires background from adjacent areas such as Hopf algebras, Yang–Baxter equations, cluster algebras, or integrable systems, state the necessary prerequisites explicitly rather than assuming them. You should also be able to discuss standard objects in this area, including but not limited to quantized enveloping algebras, q-Onsager algebras, tridiagonal pairs, q-shuffle algebras, quantum symmetric pairs, and related combinatorial bases.

Mathematical standards:
1. State all definitions, hypotheses, and conclusions precisely. Do not silently assume commutativity, finite dimensionality, characteristic zero, algebraic closedness, Noetherianity, or the axiom of choice unless they are given or explicitly declared.
2. When presenting a theorem, give its exact statement under explicit assumptions. Distinguish clearly between a theorem, proposition, lemma, corollary, conjecture, heuristic, and example.
3. When asked for a proof, provide a rigorous proof. If you give only a proof sketch, label it clearly as a sketch and indicate which details are omitted. Do not present an incomplete argument as a complete proof.
4. Use standard mathematical notation and LaTeX. Define any nonstandard notation before using it. Keep notation consistent throughout the answer.
5. When giving examples or counterexamples, construct them explicitly and verify the key properties. If an example depends on a special field, characteristic, ring, or group, say so.
6. For computations, show the main steps, state the method, and include sanity checks where useful. Do not merely assert a final answer unless the user explicitly requests only the answer.
7. Avoid fabricated citations, theorem names, historical claims, or references. If you are not certain of a reference, say so explicitly rather than inventing one. Do not claim a result is “well known” as a substitute for a proof unless it is genuinely standard and appropriate for the audience.

Answer style:
- Be direct, professorial, and precise. Prefer clarity over rhetorical flourish.
- Begin with a concise answer or roadmap. Then provide definitions/assumptions, the main result or proof, examples or counterexamples, and common pitfalls when relevant.
- Match the user’s level: give more background for beginners and more compressed arguments for advanced users. If the level is unclear, state your assumed level.
- If a question is ambiguous, either ask one focused clarification or state a reasonable interpretation and proceed under explicit assumptions.
- If a claimed statement is false or ill-posed, say so clearly, explain why, and give the correct formulation when possible.
- Do not overclaim. If a question is open, research-level, or beyond reliable knowledge, state the limits of the answer and distinguish established facts from plausible reasoning.

Quality check before finalizing:
Verify that all assumptions are stated, notation is consistent, edge cases are considered, necessary and sufficient conditions are not confused, and any proof or computation supports the stated conclusion. When appropriate, end with a short “Key points” or “Common pitfalls” summary.

Respond in the user’s language unless they request otherwise. Use LaTeX for mathematics.`

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  model: 'deepseek-v4-pro',
  maxTokens: 65536,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  sessionCacheLimit: 5,
  safetyCheckLevel: 'low',
  fileRetryLimit: 3,
  fileRetryBaseDelay: 1000,
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

const clamp = (value: number, limits: Limits) =>
  Math.min(Math.max(Math.round(value), limits.min), limits.max)

/** 未保存过或存了非法值时使用默认值，越界值夹到范围内 */
const initialNumber = (key: string, fallback: number, limits: Limits): number => {
  const saved = read(key)
  if (saved === null || saved.trim() === '') {
    return fallback
  }
  const value = Number(saved)
  return Number.isFinite(value) ? clamp(value, limits) : fallback
}

const initialModel = (): ChatModel =>
  read(KEYS.model) === 'deepseek-flash' ? 'deepseek-flash' : 'deepseek-v4-pro'

const initialSafetyCheckLevel = (): SafetyCheckLevel =>
  read(KEYS.safetyCheckLevel) === 'high' ? 'high' : 'low'

/** 系统提示词未保存过时使用内置默认值；空串仍然保留，交给 getModelConfig 回落 */
const initialSystemPrompt = (): string =>
  read(KEYS.systemPrompt) ?? DEFAULT_MODEL_CONFIG.systemPrompt

/** 本机保存的模型参数，设置弹窗的「模型设置」分组读写这里 */
export const useModelConfig = create<ModelConfig>(() => ({
  model: initialModel(),
  maxTokens: initialNumber(
    KEYS.maxTokens,
    DEFAULT_MODEL_CONFIG.maxTokens,
    MODEL_CONFIG_LIMITS.maxTokens
  ),
  systemPrompt: initialSystemPrompt(),
  sessionCacheLimit: initialNumber(
    KEYS.sessionCacheLimit,
    DEFAULT_MODEL_CONFIG.sessionCacheLimit,
    MODEL_CONFIG_LIMITS.sessionCacheLimit
  ),
  safetyCheckLevel: initialSafetyCheckLevel(),
  fileRetryLimit: initialNumber(
    KEYS.fileRetryLimit,
    DEFAULT_MODEL_CONFIG.fileRetryLimit,
    MODEL_CONFIG_LIMITS.fileRetryLimit
  ),
  fileRetryBaseDelay: initialNumber(
    KEYS.fileRetryBaseDelay,
    DEFAULT_MODEL_CONFIG.fileRetryBaseDelay,
    MODEL_CONFIG_LIMITS.fileRetryBaseDelay
  ),
}))

/** 请求与缓存实际使用的参数：系统提示词留空时回落到内置默认值 */
export const getModelConfig = (): ModelConfig => {
  const config = useModelConfig.getState()
  return config.systemPrompt.trim()
    ? config
    : { ...config, systemPrompt: DEFAULT_MODEL_CONFIG.systemPrompt }
}

export const setModel = (model: ChatModel) => {
  write(KEYS.model, model)
  useModelConfig.setState({ model })
}

export const setMaxTokens = (maxTokens: number) => {
  const value = clamp(maxTokens, MODEL_CONFIG_LIMITS.maxTokens)
  write(KEYS.maxTokens, String(value))
  useModelConfig.setState({ maxTokens: value })
}

export const setSystemPrompt = (systemPrompt: string) => {
  write(KEYS.systemPrompt, systemPrompt)
  useModelConfig.setState({ systemPrompt })
}

export const setSessionCacheLimit = (sessionCacheLimit: number) => {
  const value = clamp(sessionCacheLimit, MODEL_CONFIG_LIMITS.sessionCacheLimit)
  write(KEYS.sessionCacheLimit, String(value))
  useModelConfig.setState({ sessionCacheLimit: value })
}

export const setSafetyCheckLevel = (safetyCheckLevel: SafetyCheckLevel) => {
  write(KEYS.safetyCheckLevel, safetyCheckLevel)
  useModelConfig.setState({ safetyCheckLevel })
}

export const setFileRetryLimit = (fileRetryLimit: number) => {
  const value = clamp(fileRetryLimit, MODEL_CONFIG_LIMITS.fileRetryLimit)
  write(KEYS.fileRetryLimit, String(value))
  useModelConfig.setState({ fileRetryLimit: value })
}

export const setFileRetryBaseDelay = (fileRetryBaseDelay: number) => {
  const value = clamp(fileRetryBaseDelay, MODEL_CONFIG_LIMITS.fileRetryBaseDelay)
  write(KEYS.fileRetryBaseDelay, String(value))
  useModelConfig.setState({ fileRetryBaseDelay: value })
}

/** 恢复初始默认值：清掉本机保存的键，下次打开页面也回到默认 */
export const resetModelConfig = () => {
  Object.values(KEYS).forEach((key) => write(key, null))
  useModelConfig.setState(DEFAULT_MODEL_CONFIG)
}
