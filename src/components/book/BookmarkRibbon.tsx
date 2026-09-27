'use client'

interface BookmarkRibbonProps {
  /** 当前房间号（仅 1..20 显示） */
  artIndex: number | null
  /** 是否已标记为书签 */
  marked: boolean
  /** 侧别：桌面跨页时左侧房间用 left，右侧用 right；移动单页用 right */
  side: 'left' | 'right'
}

/**
 * 标记当前房间后，在书的页面顶部边缘插入的书签丝带。
 * 元素挂载时由 CSS 动画完成"插入下坠"的物理感；取消标记即卸载。
 */
export function BookmarkRibbon({ artIndex, marked, side }: BookmarkRibbonProps) {
  if (!marked || !artIndex || artIndex < 1 || artIndex > 20) return null

  return (
    <div className={`bookmark-ribbon bookmark-ribbon--${side}`} aria-hidden>
      <div className="bookmark-ribbon__tail" />
      <div className="bookmark-ribbon__tab">
        <span className="bookmark-ribbon__num">{String(artIndex).padStart(2, '0')}</span>
      </div>
    </div>
  )
}
