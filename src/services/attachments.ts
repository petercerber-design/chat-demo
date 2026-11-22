import { create } from 'zustand'
import type { LinkedMessage, TranslationMessage } from '../i18n/index.js'
import { isUploadImageOversized } from '../utils/resizeUploadImage.js'
import { uploadFile } from './api/client.js'
import { classifyApiError, getUploadErrorInfo, isRetryableApiError } from './api/errors.js'
import type { FilePurpose } from './api/types.js'
import { parseZhipuFile } from './api/zhipu.js'
import type { ModelProvider } from './chat/models.js'
import { loadFile } from './chat/db.js'
import type { FileAttachment } from './chat/types.js'
import { ACCEPT_FILE_EXTS } from './uploadExts.js'

/** 允许上传的扩展名，按扩展名白名单过滤，清单见 uploadExts.ts */
export const ACCEPTED_EXTS = ACCEPT_FILE_EXTS
/** 选择文件对话框的过滤条件 */
export const ACCEPT = ACCEPTED_EXTS.map((ext) => `.${ext}`).join(',')
/** 单文件大小上限与 Files API 一致 */
export const MAX_SIZE_MB = 64
/** 按 user_data 上传的文件（纯文本、代码、表格、电子书）原文件上限更小 */
export const MAX_USER_DATA_SIZE_MB = 32
export const MAX_COUNT = 50
/** 同时上传的文件数 */
const MAX_CONCURRENT = 3

/** 文件扩展名（小写，不含点）；没有扩展名时为空 */
export const getFileExt = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isAcceptedExt = (name: string) => ACCEPTED_EXTS.includes(getFileExt(name))

/** 需要服务端做版面解析的文档；其余非图片文件（纯文本、代码、表格、电子书）无需解析 */
const LAYOUT_RECOGNITION_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx'])

/** 上传时的 purpose：图片不传，PDF 与 Word、PPT 做版面解析，其余按 user_data 上传 */
export const getUploadPurpose = (name: string, isImage: boolean): FilePurpose | null => {
  if (isImage) {
    return null
  }
  return LAYOUT_RECOGNITION_EXTS.has(getFileExt(name)) ? 'rich_layout_recognition' : 'user_data'
}

/** 智谱同步解析支持的格式；其余文件在本地按 UTF-8 文本读取 */
const ZHIPU_PARSER_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'bmp',
  'gif',
  'webp',
  'tif',
  'tiff',
  'heic',
  'heif',
])

const ZHIPU_OFFICE_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx'])
const ZHIPU_SMALL_EXTS = new Set(['md', 'txt', 'xls', 'xlsx', 'csv'])

/** 判断附件是否需要交给智谱解析接口；图片与文档需要，代码等纯文本在本地读取 */
const needsZhipuParsing = (name: string, isImage: boolean) =>
  isImage || ZHIPU_PARSER_EXTS.has(getFileExt(name))

/** 智谱同步解析：Office/PDF ≤100MB，文本与表格 ≤10MB，图片及其他 ≤20MB */
const getZhipuMaxSizeMB = (file: File) => {
  const ext = getFileExt(file.name)
  if (ZHIPU_OFFICE_EXTS.has(ext)) {
    return 100
  }
  return ZHIPU_SMALL_EXTS.has(ext) ? 10 : 20
}

/** 文件允许的最大体积（MB），按服务商与上传方式区分 */
const getMaxSizeMB = (file: File, provider: ModelProvider) =>
  provider === 'zhipu'
    ? getZhipuMaxSizeMB(file)
    : getUploadPurpose(file.name, isImage(resolveMimeType(file))) === 'user_data'
      ? MAX_USER_DATA_SIZE_MB
      : MAX_SIZE_MB

/** 添加前校验：格式 → 大小 → 数量，任一不满足即整批不添加 */
export const validateFiles = (
  files: File[],
  currentCount: number,
  provider: ModelProvider = 'deepseek'
): TranslationMessage | null => {
  if (files.some((file) => !isAcceptedExt(file.name))) {
    return { key: 'uploadUnsupportedFormat' }
  }
  const oversized = files.find((file) => file.size > getMaxSizeMB(file, provider) * 1024 * 1024)
  if (oversized) {
    return { key: 'uploadMaxMBSize', params: { size: getMaxSizeMB(oversized, provider) } }
  }
  if (currentCount + files.length > MAX_COUNT) {
    return { key: 'uploadMaxFiles', params: { count: MAX_COUNT } }
  }
  return null
}

/**
 * 上传失败在附件上显示的文案：与设计稿状态对应的用具体原因，其余统一「上传失败」。
 * 服务端原文多为英文且较长，不直接展示。
 */
export const describeUploadError = (error: unknown): TranslationMessage => {
  if (classifyApiError(error) === 'serverBusy') {
    return { key: 'uploadServerBusy' }
  }
  if (getUploadErrorInfo(error)?.code === 'parseFailed') {
    return { key: 'uploadParseFailed' }
  }
  return { key: 'uploadFileStatusFailed' }
}

type NoticeListener = (notice: LinkedMessage) => void
const noticeListeners = new Set<NoticeListener>()

/** 订阅需要额外提示的上传失败（配额达到上限），由界面层转成 toast */
export const onUploadNotice = (listener: NoticeListener) => {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

/** 删除已上传文件的接口文档 */
const DELETE_FILE_DOCS_URL = 'https://api-docs.deepseek.com/api/delete-file'

/** 文件数或存储空间达到上限：附件上只放得下「上传失败」，原因另用 toast 说明并引导删除旧文件 */
export const describeUploadQuota = (error: unknown): LinkedMessage | undefined => {
  const info = getUploadErrorInfo(error)
  const link = { key: 'uploadDeleteFiles', href: DELETE_FILE_DOCS_URL } as const
  if (info?.code === 'fileCountLimit') {
    return { type: 'error', key: 'uploadFileCountLimit', params: { limit: info.limit ?? '' }, link }
  }
  if (info?.code === 'storageLimit') {
    return { type: 'error', key: 'uploadStorageLimit', params: { limit: info.limit ?? '' }, link }
  }
  return undefined
}

type Job = () => Promise<void>
const queue: Job[] = []
let running = 0

const next = () => {
  while (running < MAX_CONCURRENT) {
    const job = queue.shift()
    if (!job) {
      return
    }
    running++
    void job().finally(() => {
      running--
      next()
    })
  }
}

/** 一次附件上传的结果：DeepSeek 为 Files API 的 file_id；智谱只有解析文本 */
export type UploadedFile = { serverId: string | null; text?: string }

/** DeepSeek：图片先缩放后按 purpose 上传；智谱：文档/图片交给同步解析，其余按本地文本读取 */
const uploadWithProvider = async (
  provider: ModelProvider,
  apiKey: string,
  file: File,
  name: string,
  isImage: boolean,
  signal: AbortSignal
): Promise<UploadedFile> => {
  if (provider === 'zhipu') {
    if (needsZhipuParsing(name, isImage)) {
      const parsed = await parseZhipuFile(apiKey, file, signal)
      return { serverId: null, text: parsed.text }
    }
    signal.throwIfAborted()
    return { serverId: null, text: await file.text() }
  }
  const object = await uploadFile(apiKey, file, getUploadPurpose(name, isImage), signal)
  return { serverId: object.id }
}

/** 排队上传，最多同时上传 MAX_CONCURRENT 个；排队期间中止的任务不会发出请求 */
const enqueueUpload = (
  apiKey: string,
  file: Blob,
  name: string,
  isImage: boolean,
  signal: AbortSignal,
  provider: ModelProvider
) =>
  new Promise<UploadedFile>((resolve, reject) => {
    queue.push(async () => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      try {
        const body = file instanceof File ? file : new File([file], name, { type: file.type })
        resolve(await uploadWithProvider(provider, apiKey, body, name, isImage, signal))
      } catch (error) {
        reject(error)
      }
    })
    next()
  })

/**
 * 上传任务按附件的本地 id 登记：输入框选中即开始上传，全部成功后携带结果发送，
 * 不会重复上传；导入的历史附件没有任务，发送前按本地原件补传。
 * 任务只在内存里，历史附件补传未完成时，刷新后会在下次请求前重新上传。
 * provider 记录结果所属服务商，切换模型后需要按新服务商重新上传。
 */
export type UploadTask =
  | { status: 'uploading' }
  | { status: 'done'; provider: ModelProvider; serverId: string | null; text?: string }
  | { status: 'error'; error: TranslationMessage; retryable: boolean }

type UploadState = { tasks: Record<string, UploadTask> }

export const useUploads = create<UploadState>(() => ({ tasks: {} }))

const setTask = (id: string, task: UploadTask | null) =>
  useUploads.setState((state) => ({
    tasks: task
      ? { ...state.tasks, [id]: task }
      : Object.fromEntries(Object.entries(state.tasks).filter(([key]) => key !== id)),
  }))

const pending = new Map<
  string,
  { promise: Promise<UploadedFile>; controller: AbortController; provider: ModelProvider }
>()
/** 每个附件当前有效的上传服务商；旧任务返回时不覆盖新任务的状态 */
const activeUploads = new Map<string, ModelProvider>()

/** 开始（或复用同一服务商进行中的）上传；失败时任务记为 error 并抛出原错误 */
export const uploadAttachment = (
  apiKey: string,
  id: string,
  blob: Blob,
  name: string,
  isImage: boolean,
  provider: ModelProvider
): Promise<UploadedFile> => {
  const current = pending.get(id)
  if (current?.provider === provider) {
    return current.promise
  }
  // 换服务商后旧结果不可复用：中止旧任务，按新服务商重新上传
  current?.controller.abort()
  const controller = new AbortController()
  activeUploads.set(id, provider)
  setTask(id, { status: 'uploading' })
  const promise = enqueueUpload(apiKey, blob, name, isImage, controller.signal, provider)
    .then((uploaded) => {
      if (activeUploads.get(id) === provider) {
        setTask(id, {
          status: 'done',
          provider,
          serverId: uploaded.serverId,
          text: uploaded.text,
        })
      }
      return uploaded
    })
    .catch((error: unknown) => {
      if (activeUploads.get(id) === provider) {
        if (controller.signal.aborted) {
          setTask(id, null)
        } else {
          setTask(id, {
            status: 'error',
            error: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          const notice = describeUploadQuota(error)
          if (notice) {
            for (const listener of noticeListeners) {
              listener(notice)
            }
          }
        }
      }
      throw error
    })
    .finally(() => {
      if (pending.get(id)?.controller === controller) {
        pending.delete(id)
      }
    })
  pending.set(id, { promise, controller, provider })
  return promise
}

export const cancelUpload = (id: string) => {
  pending.get(id)?.controller.abort()
  pending.delete(id)
  activeUploads.delete(id)
  setTask(id, null)
}

/** 检查旧图片的 file_id。超限返回 null 以触发补传，无法读取原件时保留原 ID。 */
export const checkImageFileIds = async (files: FileAttachment[], signal: AbortSignal) => {
  const checked = new Map<string, string | null>()
  for (const file of files) {
    if (!file.isImage || !file.serverId || file.imageSizeChecked || checked.has(file.id)) {
      continue
    }
    signal.throwIfAborted()
    const oversized = await loadFile(file.id)
      .then((blob) => blob && isUploadImageOversized(blob))
      .catch(() => undefined)
    if (oversized === undefined) {
      continue
    }
    signal.throwIfAborted()
    const task = useUploads.getState().tasks[file.id]
    if (oversized && task?.status === 'done' && task.serverId === file.serverId) {
      cancelUpload(file.id)
    }
    checked.set(file.id, oversized ? null : file.serverId)
  }
  return checked
}

/** 各扩展名对应的 MIME：部分系统（如 Windows）给不出 file.type，按扩展名补齐 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const VIEW_MIME_BY_EXT: Record<string, string> = {
  ...MIME_BY_EXT,
  apng: 'image/png',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  pjp: 'image/jpeg',
  pjpeg: 'image/jpeg',
  bmp: 'image/bmp',
  dib: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  avif: 'image/avif',
  avifs: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

/** 展示附件时只按后缀确定类型。 */
export const getFileViewType = (name: string) => {
  const ext = getFileExt(name)
  return Object.hasOwn(VIEW_MIME_BY_EXT, ext) ? VIEW_MIME_BY_EXT[ext] : ''
}

/** 取文件的 MIME：优先用浏览器给出的类型，缺失时按扩展名推断 */
export const resolveMimeType = (file: File) => file.type || MIME_BY_EXT[getFileExt(file.name)] || ''

export const isImage = (mimeType: string) => mimeType.startsWith('image/')

/** 文件扩展名（大写），用于卡片元信息 */
export const getExtension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : ''
}

export const formatSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
