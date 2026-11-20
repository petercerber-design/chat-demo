import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Message, Session, UserMessage as UserMessageType } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

/** 快速导航卡片一次展示的最近用户消息数，更早的消息通过悬停滚动查看 */
const NAV_VISIBLE_COUNT = 10
/** 卡片中每行摘要的字符数 */
const NAV_ROW_LENGTH = 50
/** 悬停某行时气泡里摘要的字符数 */
const NAV_TOOLTIP_LENGTH = 200
/** 跳转后消息顶部与滚动区域顶部的间距 */
const NAV_SCROLL_MARGIN = 16
/** 判定当前消息时的顶部偏移，略大于跳转间距，避免跳转后标记错位 */
const NAV_ACTIVE_OFFSET = 24

/** 用户消息的纯文本摘要：合并空白后截取前 length 个字符；没有文字时退回附件名 */
const toMessagePreview = (message: UserMessageType, length: number) => {
  const text = (message.content || message.files.map((file) => file.name).join(', '))
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length > length ? `${chars.slice(0, length).join('')}…` : text
}

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = getVisibleMessages(session)
  const userMessages = messages.filter(
    (message): message is UserMessageType => message.role === 'user'
  )
  const userMessageCount = userMessages.length
  const userMessageKey = userMessages.map((message) => message.id).join()
  /** 导航窗口最多停在这一项，保证最后一条始终可见 */
  const maxNavStart = Math.max(0, userMessageCount - NAV_VISIBLE_COUNT)
  const [navStartOverride, setNavStartOverride] = useState<number | null>(null)
  const navStart = Math.min(navStartOverride ?? maxNavStart, maxNavStart)
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  // 快速导航：点击标记把对应的用户消息滚到顶部附近。
  const scrollToMessage = useCallback((messageId: string) => {
    const scroller = scrollRef.current
    if (!scroller) {
      return
    }
    const target = scroller.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    )
    if (!target) {
      return
    }
    // 跳转后不再跟随底部，避免流式内容把阅读位置拉回最新消息。
    stickyRef.current = false
    scroller.scrollTop +=
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - NAV_SCROLL_MARGIN
    scrollTopRef.current = scroller.scrollTop
  }, [])

  /** 平移导航窗口；step 为负时查看更早的消息 */
  const shiftNavWindow = useCallback(
    (step: number) => {
      setNavStartOverride((previous) => {
        const current = Math.min(previous ?? maxNavStart, maxNavStart)
        return Math.max(0, Math.min(current + step, maxNavStart))
      })
    },
    [maxNavStart]
  )

  // 切换会话或消息数量变化后，重新回到最新的一批标记。
  useEffect(() => {
    setNavStartOverride(null)
  }, [session.id, userMessageCount])

  // 悬停导航条时用滚轮切换更早的标记；非 passive 才能阻止消息列表跟着滚动。
  useEffect(() => {
    const nav = navRef.current
    if (isMobile || maxNavStart <= 0 || !nav) {
      return
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return
      }
      event.preventDefault()
      shiftNavWindow(event.deltaY < 0 ? -1 : 1)
    }
    nav.addEventListener('wheel', onWheel, { passive: false })
    return () => nav.removeEventListener('wheel', onWheel)
  }, [isMobile, maxNavStart, shiftNavWindow])

  // 跟随滚动位置高亮当前阅读的消息；消息列表变化后重新测量。
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (isMobile || !scroller) {
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const items = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'))
      const lastId = items.at(-1)?.dataset.messageId ?? null
      if (items.length === 0) {
        setActiveMessageId(null)
        return
      }
      // 在底部时当前消息就是最新一条，避免回答较短时高亮停在上一条。
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < STICKY_THRESHOLD) {
        setActiveMessageId(lastId)
        return
      }
      const top = scroller.getBoundingClientRect().top + NAV_ACTIVE_OFFSET
      let active = items[0].dataset.messageId ?? null
      for (const item of items) {
        if (item.getBoundingClientRect().top > top) {
          break
        }
        active = item.dataset.messageId ?? active
      }
      setActiveMessageId(active)
    }
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update)
      }
    }
    update()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [isMobile, userMessageKey])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  const navItems = userMessages.slice(navStart, navStart + NAV_VISIBLE_COUNT)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div className={styles.wrapper}>
        <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
          <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
            <div ref={contentRef} className={styles.column}>
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    retryUploadId={uploadRetryId}
                    isFirst={index === 0}
                    isLast={index === lastIndex || index === lastIndex - 1}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    sessionId={session.id}
                    message={message}
                    isLast={index === lastIndex}
                    streaming={streaming && index === lastIndex}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )
              )}
            </div>
          </div>
          {footer}
        </div>
        {isMobile || userMessages.length === 0 ? null : (
          <nav
            ref={navRef}
            className={styles.nav}
            aria-label={t('messageNav')}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                shiftNavWindow(-1)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                shiftNavWindow(1)
              }
            }}
          >
            {navItems.map((message, index) => {
              const active = message.id === activeMessageId
              const label = toMessagePreview(message, NAV_ROW_LENGTH)
              const tooltip = toMessagePreview(message, NAV_TOOLTIP_LENGTH)
              return (
                <button
                  key={index}
                  type="button"
                  className={clsx(styles.navItem, active && styles.navItemActive)}
                  aria-label={label || t('messageNav')}
                  aria-current={active ? 'location' : undefined}
                  onClick={(event) => {
                    // 鼠标点击后收起卡片；键盘操作保留焦点，便于继续用方向键切换。
                    if (event.detail > 0) {
                      event.currentTarget.blur()
                    }
                    scrollToMessage(message.id)
                  }}
                >
                  <span className={styles.navLabel}>{label}</span>
                  <span className={styles.navIndicator} aria-hidden="true" />
                  {tooltip ? (
                    <span className={styles.navPreview} aria-hidden="true">
                      {tooltip}
                    </span>
                  ) : null}
                </button>
              )
            })}
            {maxNavStart > 0 ? (
              <span className={styles.navHint}>{t('messageNavScrollHint')}</span>
            ) : null}
          </nav>
        )}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
