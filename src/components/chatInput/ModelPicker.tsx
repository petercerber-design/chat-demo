import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { MODEL_OPTIONS, providerOf } from '../../services/chat/models.js'
import { setSessionModel } from '../../services/chat/store.js'
import type { ChatModel } from '../../services/api/types.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { ProviderIcon } from '../base/ProviderIcon.js'
import styles from './ModelPicker.module.css'

/** 输入框右下角的模型切换：显示服务商图标与当前模型，选择后同时更新会话与新对话默认值。 */
export const ModelPicker = ({
  sessionId,
  model,
  disabled = false,
}: {
  sessionId: string | null
  model: ChatModel
  disabled?: boolean
}) => {
  const t = useTranslate()
  return (
    <Menu
      options={MODEL_OPTIONS.map((option) => ({
        key: option.model,
        label: `${option.providerName} · ${option.model}`,
        icon: <ProviderIcon provider={option.provider} size={14} />,
        onSelect: () => setSessionModel(sessionId, option.model),
      }))}
    >
      {({ open, toggle }) => (
        <button
          type="button"
          className={clsx(styles.trigger, open && styles.open)}
          title={`${t('settingsModelName')}: ${model}`}
          aria-label={`${t('settingsModelName')}: ${model}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={toggle}
        >
          <ProviderIcon provider={providerOf(model)} size={14} />
          <span className={styles.label}>{model}</span>
          <span className={styles.chevron}>
            <IconChevronDownOutline14 />
          </span>
        </button>
      )}
    </Menu>
  )
}
