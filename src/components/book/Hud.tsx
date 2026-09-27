'use client'

import { useEffect, useState } from 'react'
import {
  AudioWaveform,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Github,
  HelpCircle,
  List,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { ART_COUNT, artFlatIndex, BOOK_PAGES } from '@/lib/book/pages'
import { GITHUB_REPO_URL } from '@/lib/github'
import { useBookStore } from '@/lib/book-store'

interface HudProps {
  canPrev: boolean
  canNext: boolean
  /** 主标签，如 "01–02/20" */
  labelMain: string
  /** 副标签，如 "GENESIS × TYPE RIOT" */
  labelSub: string
  /** 当前可见的房间号（可同时两个） */
  currentArts: number[]
  /** 当前阅读进度 0..1（基于 leaf / leafCount） */
  progress: number
  /** 当前是否已处于读毕态 */
  atEnd: boolean
  /** 当前是否处于封面合上态 */
  atStart: boolean
  onPrev: () => void
  onNext: () => void
  onToc: () => void
  onToggleBookmark: () => void
  onJumpToArt: (i: number) => void
}

export function Hud({
  canPrev,
  canNext,
  labelMain,
  labelSub,
  currentArts,
  progress,
  atEnd,
  atStart,
  onPrev,
  onNext,
  onToc,
  onToggleBookmark,
  onJumpToArt,
}: HudProps) {
  const muted = useBookStore((s) => s.muted)
  const toggleMute = useBookStore((s) => s.toggleMute)
  const ambient = useBookStore((s) => s.ambient)
  const toggleAmbient = useBookStore((s) => s.toggleAmbient)
  const setHelpOpen = useBookStore((s) => s.setHelpOpen)
  const setMarksOpen = useBookStore((s) => s.setMarksOpen)
  const visited = useBookStore((s) => s.visited)
  const bookmarks = useBookStore((s) => s.bookmarks)
  const cleared = useBookStore((s) => s.cleared)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const hasBookmarkOnCurrent = currentArts.some((n) => bookmarks.includes(n))

  return (
    <nav className="hud" aria-label="翻阅控制">
      <div className="hud__nav">
        <button
          type="button"
          className="hud-btn hud-btn--nav"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="上一页"
          aria-keyshortcuts="ArrowLeft PageUp"
        >
          <ChevronLeft size={20} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="hud-btn hud-btn--nav"
          onClick={onNext}
          disabled={!canNext}
          aria-label="下一页"
          aria-keyshortcuts="ArrowRight PageDown"
        >
          <ChevronRight size={20} strokeWidth={1.8} />
        </button>
      </div>

      <div className="hud__center">
        <span className="hud__label-main" aria-live="polite">
          <strong>{labelMain}</strong> — {labelSub}
        </span>
        <div
          className="hud__rail"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={ART_COUNT}
          aria-valuenow={currentArts[0] ?? 0}
          aria-label="阅读进度"
        >
          {/* 段落标签 */}
          <span className="hud__rail-section hud__rail-section--cover" aria-hidden>
            {atStart ? '封面' : ''}
          </span>
          <span className="hud__rail-section hud__rail-section--arts" aria-hidden>
            {/* 20 个房间刻度 */}
            {Array.from({ length: ART_COUNT }, (_, idx) => {
              const n = idx + 1
              const isCurrent = currentArts.includes(n)
              const isVisited = visited.includes(n)
              const isBookmarked = bookmarks.includes(n)
              const isCleared = cleared.includes(n)
              const cls = [
                'hud__tick',
                isCurrent ? 'hud__tick--current' : '',
                isVisited && !isCurrent ? 'hud__tick--visited' : '',
                isBookmarked ? 'hud__tick--marked' : '',
                isCleared ? 'hud__tick--cleared' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={n}
                  type="button"
                  className={cls}
                  onClick={() => onJumpToArt(n)}
                  aria-label={`跳转到房间 ${String(n).padStart(2, '0')} ${BOOK_PAGES[artFlatIndex(n)]?.title ?? ''}${isCleared ? ' · 已通关' : ''}`}
                  title={`${String(n).padStart(2, '0')} ${BOOK_PAGES[artFlatIndex(n)]?.title ?? ''}${isBookmarked ? ' · 已标记' : ''}${isCleared ? ' · ✦ 已通关' : ''}`}
                />
              )
            })}
          </span>
          <span className="hud__rail-section hud__rail-section--back" aria-hidden>
            {atEnd ? '读毕' : ''}
          </span>
          {/* 进度游标 */}
          <span
            className="hud__rail-cursor"
            style={{ left: `${Math.max(2, Math.min(98, progress * 100))}%` }}
            aria-hidden
          />
        </div>
      </div>

      <div className="hud__tools">
        <button
          type="button"
          className={`hud-btn${hasBookmarkOnCurrent ? ' hud-btn--active' : ''}`}
          onClick={onToggleBookmark}
          disabled={currentArts.length === 0}
          aria-label={hasBookmarkOnCurrent ? '取消书签' : '加入书签'}
          aria-keyshortcuts="b"
          title={hasBookmarkOnCurrent ? '已标记 · 再点取消' : '标记当前房间（B）'}
        >
          {hasBookmarkOnCurrent ? (
            <BookmarkCheck size={17} strokeWidth={1.8} />
          ) : (
            <Bookmark size={17} strokeWidth={1.8} />
          )}
        </button>
        {bookmarks.length > 0 && (
          <button
            type="button"
            className="hud-marks-chip"
            onClick={() => setMarksOpen(true)}
            aria-label={`打开书签面板（共 ${bookmarks.length} 枚）`}
            aria-keyshortcuts="m"
            title="书签列表"
          >
            <span className="hud-marks-chip__n">{bookmarks.length}</span>
            <span className="hud-marks-chip__t">书签</span>
          </button>
        )}
        <button
          type="button"
          className={`hud-btn${ambient ? ' hud-btn--active hud-btn--live' : ''}`}
          onClick={toggleAmbient}
          disabled={muted}
          aria-label={ambient ? '关闭环境音' : '开启环境音'}
          title={muted ? '环境音（需先开声）' : ambient ? '环境音：房间呼吸 · 开' : '环境音：关'}
        >
          <AudioWaveform size={17} strokeWidth={1.8} />
        </button>
        <button type="button" className="hud-btn" onClick={onToc} aria-label="回到目次" title="目次">
          <List size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="hud-btn"
          onClick={toggleMute}
          aria-label={muted ? '开启声音' : '静音'}
          title={muted ? '声音：关' : '声音：开'}
        >
          {muted ? <VolumeX size={17} strokeWidth={1.8} /> : <Volume2 size={17} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className="hud-btn"
          onClick={() => setHelpOpen(true)}
          aria-label="如何翻阅"
          title="如何翻阅"
        >
          <HelpCircle size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="hud-btn"
          onClick={toggleFullscreen}
          aria-label="全屏"
          title="全屏"
        >
          {fullscreen ? <Minimize size={17} strokeWidth={1.8} /> : <Maximize size={17} strokeWidth={1.8} />}
        </button>
        <a
          className="hud-btn hud-btn--gh"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub 源码仓库"
          title="GitHub · 43aquarius/flip"
        >
          <Github size={17} strokeWidth={1.8} />
        </a>
      </div>
    </nav>
  )
}
