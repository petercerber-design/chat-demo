import { create } from 'zustand'
import { getProviderApiKey, useSettings } from '../../services/settings.js'
import type { ModelProvider } from '../../services/chat/models.js'

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

/** 当前模型所属服务商没有 API Key 时，打开设置并选中「数据管理」，返回是否已有 Key */
export const ensureApiKey = (provider: ModelProvider = 'deepseek') => {
  const state = useSettings.getState()
  if (getProviderApiKey(state, provider)) {
    return true
  }
  openSettings('data')
  return false
}

/** 首次打开：两家服务商至少配置一个 Key 即可开始使用 */
export const ensureAnyApiKey = () => {
  const state = useSettings.getState()
  if (state.apiKey || state.zhipuApiKey) {
    return true
  }
  openSettings('data')
  return false
}
