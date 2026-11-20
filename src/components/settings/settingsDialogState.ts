import { create } from 'zustand'
import { useModelConfig } from '../../services/chat/config.js'
import { getApiKey } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 模型设置 / 数据管理 */
export type SettingsSection = 'general' | 'model' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/**
 * 没有当前模型来源的 API Key 时打开「模型设置」（Key 与模型来源在一起设置），返回是否已有 Key。
 * 每个来源的 Key 分开保存，切换来源后需要各自的 Key。
 */
export const ensureApiKey = () => {
  if (getApiKey(useModelConfig.getState().provider)) {
    return true
  }
  openSettings('model')
  return false
}
