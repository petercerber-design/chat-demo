import { useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { verifyZhipuApiKey } from '../../services/api/zhipu.js'
import { classifyApiError } from '../../services/api/errors.js'
import { setApiKey } from '../../services/settings.js'
import type { ModelProvider } from '../../services/chat/models.js'
import { useTranslate } from '../../i18n/index.js'

/** 输入 API Key 后先调用服务商的校验接口，通过才保存 */
export const useApiKeyForm = (provider: ModelProvider, onSaved?: () => void) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      await (provider === 'zhipu' ? verifyZhipuApiKey(apiKey) : verifyApiKey(apiKey))
      setApiKey(provider, apiKey)
      setValue('')
      onSaved?.()
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setVerifying(false)
    }
  }

  return { value, setValue, verifying, error, submit }
}
