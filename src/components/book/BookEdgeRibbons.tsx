'use client'

import { artFlatIndex, BOOK_PAGES } from '@/lib/book/pages'

interface BookEdgeRibbonsProps {
  /** 已标记书签的房间号（1..20） */
  bookmarks: number[]
  /** 当前跨页可见的房间号（这些由大丝带负责，边缘簇跳过） */
  currentArts: number[]
  /** 书是否处于翻开状态（合上时书签藏进书里） */
  open: boolean
  /** 读毕塔缩态：书页堆塔缩至左半侧，丝带应聚拢在左半边顶边 */
  collapsed?: boolean
  /** 单页模式：书签簇聚拢到书脊侧（左边缘窄带），避免横跨单页中部遮挡画面 */
  single?: boolean
  onJump: (art: number) => void
}

/**
 * 书脊边缘书签簇：所有书签按其在书中的实际位置，
 * 从书的顶边露出小截丝带（像真实的多枚书签插在书里）。
 * 悬停放大并显示房间号，点击直达。
 * 读毕塔缩时书页堆在左半侧，丝带位置相应聚拢；
 * 单页模式下聚拢到左侧书脊窄带，不再横跨页面中部。
 */
export function BookEdgeRibbons({ bookmarks, currentArts, open, collapsed, single, onJump }: BookEdgeRibbonsProps) {
  const marks = bookmarks.filter((n) => !currentArts.includes(n))
  if (marks.length === 0) return null

  return (
    <div
      className={`edge-ribbons${open ? ' edge-ribbons--open' : ''}${single ? ' edge-ribbons--single' : ''}`}
      aria-label={`书签 ${marks.length} 枚`}
    >
      {marks.map((n) => {
        const page = BOOK_PAGES[artFlatIndex(n)]
        const basePos = ((2 + n) / 25) * 100
        const pos = collapsed
          ? 3 + (basePos / 100) * 44
          : single
            ? 4 + (n / 20) * 27
            : basePos
        return (
          <button
            key={n}
            type="button"
            className="edge-ribbon"
            style={{ left: `${pos}%` }}
            onClick={() => onJump(n)}
            aria-label={`跳转到书签 ${String(n).padStart(2, '0')} ${page?.title ?? ''}`}
            title={`${String(n).padStart(2, '0')} · ${page?.title ?? ''} ${page?.titleCn ?? ''}`}
          >
            <span className="edge-ribbon__cloth" aria-hidden />
            <span className="edge-ribbon__label" aria-hidden>
              {String(n).padStart(2, '0')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
