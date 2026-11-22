import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { getProviderName, getSessionModel, getSessionProvider } from '../../services/chat/models.js'
import type { Session } from '../../services/chat/types.js'
import { ProviderIcon } from '../base/ProviderIcon.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const model = getSessionModel(session)
  const provider = getSessionProvider(session)
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} model={model} provider={provider} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div
            className={styles.model}
            title={`${t('settingsModelName')}: ${getProviderName(provider)} · ${model}`}
          >
            <ProviderIcon provider={provider} size={14} />
            <span className={styles.providerName}>{getProviderName(provider)}</span>
            <span className={styles.divider}>·</span>
            <span className={styles.modelName}>{model}</span>
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
