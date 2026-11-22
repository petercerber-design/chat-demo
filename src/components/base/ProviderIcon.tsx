import type { ModelProvider } from '../../services/chat/models.js'
import { IconDeepseek } from './icons.js'

const ICONS: Record<ModelProvider, typeof IconDeepseek> = {
  deepseek: IconDeepseek,
}

/** 模型服务商小图标；只作装饰，服务商名称由旁边的文字或 title 提供。 */
export const ProviderIcon = ({
  provider,
  size = 14,
}: {
  provider: ModelProvider
  size?: number
}) => {
  const Icon = ICONS[provider]
  return <Icon size={size} />
}
