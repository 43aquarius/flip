'use client'

import { Bookmark, Trash2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useBookStore } from '@/lib/book-store'
import { artFlatIndex, BOOK_PAGES } from '@/lib/book/pages'
import { RoomThumb } from './RoomThumb'

interface BookmarksPanelProps {
  onJumpToArt: (i: number) => void
}

/** 书签管理面板：列出全部书签，跳转 / 移除 / 清空 */
export function BookmarksPanel({ onJumpToArt }: BookmarksPanelProps) {
  const marksOpen = useBookStore((s) => s.marksOpen)
  const setMarksOpen = useBookStore((s) => s.setMarksOpen)
  const bookmarks = useBookStore((s) => s.bookmarks)
  const toggleBookmark = useBookStore((s) => s.toggleBookmark)
  const clearBookmarks = useBookStore((s) => s.clearBookmarks)
  const visited = useBookStore((s) => s.visited)
  const cleared = useBookStore((s) => s.cleared)

  const rows = bookmarks
    .map((n) => ({ n, page: BOOK_PAGES[artFlatIndex(n)] }))
    .filter((r) => r.page)

  return (
    <Dialog open={marksOpen} onOpenChange={setMarksOpen}>
      <DialogContent className="marks-card max-w-[92vw] sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="marks-card__title">
            <Bookmark size={15} strokeWidth={2.2} className="inline-block mr-1.5 -mt-0.5" />
            书签 BOOKMARKS
          </DialogTitle>
          <DialogDescription className="text-[12px] text-bone/60">
            插在书页间的丝带 · 点击直达房间
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="marks-card__empty">
            <span>还没有任何书签。</span>
            <span className="marks-card__empty-sub">
              在任意房间按 <kbd>B</kbd> 或点 HUD 书签钮，即可把丝带插入书页。
            </span>
          </div>
        ) : (
          <div className="marks-list thin-scroll">
            {rows.map(({ n, page }) => {
              const seen = visited.includes(n)
              return (
                <div key={n} className="marks-row">
                  <button
                    type="button"
                    className="marks-row__jump"
                    onClick={() => {
                      setMarksOpen(false)
                      onJumpToArt(n)
                    }}
                    aria-label={`跳转到 ${String(n).padStart(2, '0')} ${page.title}`}
                  >
                    <span className="marks-row__num">{String(n).padStart(2, '0')}</span>
                    <span className="marks-row__thumb" aria-hidden>
                      <RoomThumb room={n} />
                      <span
                        className="marks-row__thumb-edge"
                        style={page.palette ? { background: `linear-gradient(90deg, ${page.palette[0]} 0 34%, ${page.palette[1]} 34% 67%, ${page.palette[2]} 67% 100%)` } : { background: page.accent }}
                      />
                    </span>
                    <span className="marks-row__name">{page.title}</span>
                    <span className="marks-row__cn">{page.titleCn}</span>
                    <span className="marks-row__hint">{page.hint}</span>
                    {cleared.includes(n) && (
                      <span className="marks-row__clear" title="已通关">
                        ✦ 通
                      </span>
                    )}
                    {seen && <span className="marks-row__seen">已读</span>}
                  </button>
                  <button
                    type="button"
                    className="marks-row__remove"
                    onClick={() => toggleBookmark(n)}
                    aria-label={`移除书签 ${String(n).padStart(2, '0')} ${page.title}`}
                    title="拔出这枚书签"
                  >
                    <X size={14} strokeWidth={2.2} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-bone/15 pt-3.5">
            <span className="font-attitude text-[10px] tracking-[0.2em] text-bone/55">
              {rows.length} 枚书签插在书中
            </span>
            <button
              type="button"
              className="marks-card__clear"
              onClick={() => clearBookmarks()}
            >
              <Trash2 size={12} strokeWidth={2} />
              <span>拔出全部</span>
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
