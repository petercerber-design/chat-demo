import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { getProviderName, providerOf, type ModelProvider } from '../../services/chat/models.js'
import { newChat } from '../../services/chat/store.js'
import type { ChatModel } from '../../services/api/types.js'
import { IconButton } from '../base/IconButton.js'
import { ProviderIcon } from '../base/ProviderIcon.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题、模型与开启新对话 */
export const MobileHeader = ({
  title,
  model,
  provider,
}: {
  title?: string
  model?: ChatModel
  provider?: ModelProvider
}) => {
  const t = useTranslate()
  const modelProvider = model === undefined ? undefined : (provider ?? providerOf(model))
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : (
        <>
          <div className={styles.titles}>
            <div className={styles.title}>{title}</div>
            {model === undefined || modelProvider === undefined ? null : (
              <div
                className={styles.model}
                title={`${t('settingsModelName')}: ${getProviderName(modelProvider)} · ${model}`}
              >
                <ProviderIcon provider={modelProvider} size={12} />
                <span className={styles.modelName}>{model}</span>
                <span className={styles.providerName}>{getProviderName(modelProvider)}</span>
              </div>
            )}
          </div>
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={newChat}
          />
        </>
      )}
    </div>
  )
}
