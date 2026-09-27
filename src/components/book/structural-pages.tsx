'use client'

import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { Github } from 'lucide-react'
import { useBookStore } from '@/lib/book-store'
import { ART_COUNT, BOOK_PAGES, CLEARABLE_ROOMS } from '@/lib/book/pages'
import { GITHUB_REPO_LABEL, GITHUB_REPO_URL } from '@/lib/github'
import { STAMPS, STAMP_COUNT, type StampState } from '@/lib/book/stamps'
import { SealSlot } from './SealMark'
import { RoomThumb } from './RoomThumb'

/** 阅读时长友好格式：分钟 / 小时 / 天 */
function formatReadingMs(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '不足一分钟'
  if (min < 60) return `${min} 分钟`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时 ${min % 60 > 0 ? `${min % 60} 分` : ''}`.trim()
  const day = Math.floor(hr / 24)
  return `${day} 天 ${hr % 24 > 0 ? `${hr % 24} 小时` : ''}`.trim()
}

/* ============ 封面 ============ */

export function CoverPage({ onOpen }: { onOpen?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)

  const handleMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.setProperty('--ry', `${(px - 0.5) * 9}deg`)
    el.style.setProperty('--rx', `${(0.5 - py) * 7}deg`)
    el.style.setProperty('--mx', `${px * 100}%`)
    el.style.setProperty('--my', `${py * 100}%`)
  }

  const handleLeave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--ry', '0deg')
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--mx', '50%')
    el.style.setProperty('--my', '30%')
  }

  return (
    <button
      ref={ref}
      type="button"
      className="struct-page cover-page"
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      onClick={onOpen}
      aria-label="翻开这本书"
    >
      <div className="cover-inner">
        <div className="cover-frame" aria-hidden />
        <div className="cover-light" aria-hidden />
        <div className="cover-top">
          <span>Z.AI PRESS · 实验出版物</span>
          <span>№ 001 / ∞</span>
        </div>
        <div className="cover-glyph" aria-hidden>
          翻
        </div>
        <div className="cover-sub">
          <div className="cover-sub__en">FLIP</div>
          <div className="cover-sub__cn">一本没有文字义务的书 · 二十个可进入的房间</div>
        </div>
        <svg className="cover-stamp" viewBox="0 0 120 120" aria-hidden>
          <defs>
            <path id="cover-stamp-circle" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" />
          </defs>
          <circle cx="60" cy="60" r="56" fill="none" stroke="rgba(216,255,62,0.28)" strokeWidth="1" />
          <circle cx="60" cy="60" r="33" fill="none" stroke="rgba(216,255,62,0.28)" strokeWidth="1" />
          <text>
            <textPath href="#cover-stamp-circle">
              AN EXPERIMENTAL BOOK · TWENTY ROOMS · MMXXV ·
            </textPath>
          </text>
          <text className="cover-stamp__center" x="60" y="71" textAnchor="middle">
            翻
          </text>
        </svg>
        <div className="cover-hint">
          <span>点击任意处翻开</span>
          <span>CLICK TO OPEN</span>
          <span className="cover-hint__dot" aria-hidden />
        </div>
      </div>
    </button>
  )
}

/* ============ 扉页 ============ */

export function InsideCoverPage() {
  return (
    <div className="struct-page inside-page">
      <div className="inside-page__wrap">
        <div className="inside-page__kicker">EX LIBRIS · 扉页</div>
        <div className="inside-page__title">
          这本书
          <br />
          没有文字的义务。
        </div>
        <div className="inside-page__body">
          每一页是一个房间。
          <br />
          你可以随意进出，不必按顺序，
          <br />
          也不必读完。
          <br />
          合上书之后，房间仍在运转。
        </div>
        <div className="inside-page__seal" aria-hidden>
          翻
        </div>
        <div className="inside-page__belong">本书属于 ____________ 所有 · 借阅请自觉留下指纹</div>
      </div>
    </div>
  )
}

/* ============ 目次 ============ */

export function TocPage({
  onJumpToArt,
  onJumpToFlat,
}: {
  onJumpToArt?: (artIndex: number) => void
  /** 按扁平页索引跳转（用于目次 → 版权页印谱） */
  onJumpToFlat?: (flat: number) => void
}) {
  const visited = useBookStore((s) => s.visited)
  const bookmarks = useBookStore((s) => s.bookmarks)
  const sessions = useBookStore((s) => s.sessions)
  const readingMs = useBookStore((s) => s.readingMs)
  const flips = useBookStore((s) => s.flips)
  const lastArt = useBookStore((s) => s.lastArt)
  const stamps = useBookStore((s) => s.stamps)
  const sessionLog = useBookStore((s) => s.sessionLog)
  const cleared = useBookStore((s) => s.cleared)
  const artPages = BOOK_PAGES.filter((p) => p.kind === 'art')
  const colophonFlat = BOOK_PAGES.findIndex((p) => p.kind === 'colophon')

  const seenCount = visited.length
  const clearedCount = CLEARABLE_ROOMS.size
  const clearedDone = cleared.filter((n) => CLEARABLE_ROOMS.has(n)).length
  const pct = seenCount / ART_COUNT
  // 进度环参数（r=15 的圆，周长 ≈ 94.25）
  const R = 15
  const CIRC = 2 * Math.PI * R
  // 节奏图：以日志内最大值为满分归一化
  const logMax = sessionLog.reduce((m, n) => Math.max(m, n), 0)

  return (
    <div className="struct-page toc-page">
      <div className="toc-page__wrap">
        <div className="toc-page__head">
          <span className="toc-page__title">目次 INDEX</span>
          <span className="toc-page__count">
            <svg className="toc-ring" viewBox="0 0 36 36" aria-hidden>
              <circle className="toc-ring__track" cx="18" cy="18" r={R} fill="none" />
              <circle
                className="toc-ring__bar"
                cx="18"
                cy="18"
                r={R}
                fill="none"
                strokeDasharray={`${(CIRC * pct).toFixed(2)} ${CIRC.toFixed(2)}`}
              />
            </svg>
            {seenCount}/{ART_COUNT} ROOMS
          </span>
        </div>
        <div className="toc-list thin-scroll">
          {artPages.map((p) => {
            const i = p.artIndex ?? 0
            const seen = visited.includes(i)
            const marked = bookmarks.includes(i)
            const isLast = lastArt === i
            const roomClear = cleared.includes(i)
            const clearable = CLEARABLE_ROOMS.has(i)
            return (
              <button
                key={p.id}
                type="button"
                className={`toc-row${marked ? ' toc-row--marked' : ''}${isLast ? ' toc-row--last' : ''}${roomClear ? ' toc-row--cleared' : ''}`}
                onClick={() => onJumpToArt?.(i)}
                aria-label={`跳转到 ${String(i).padStart(2, '0')} ${p.title} ${p.titleCn}${marked ? '（已标记）' : ''}${isLast ? '（上次停留）' : ''}${roomClear ? '（已通关）' : clearable ? `（可通关：${CLEARABLE_ROOMS.get(i)}）` : ''}`}
                data-hint={p.hint}
              >
                <span className="toc-row__num">{String(i).padStart(2, '0')}</span>
                <span className="toc-row__en">{p.title}</span>
                <span className="toc-row__cn">{p.titleCn}</span>
                <span className="toc-row__leader" aria-hidden />
                {isLast && (
                  <span className="toc-row__lastmark" title="上次停留">
                    ◐
                  </span>
                )}
                {roomClear ? (
                  <span className="toc-row__clear" title={`已通关 · ${CLEARABLE_ROOMS.get(i)}`}>
                    ✦
                  </span>
                ) : (
                  clearable && (
                    <span className="toc-row__clearable" title={`可通关 · ${CLEARABLE_ROOMS.get(i)}`}>
                      ✧
                    </span>
                  )
                )}
                <span
                  className="toc-row__chip"
                  style={
                    (p.palette
                      ? { background: `linear-gradient(120deg, ${p.palette[0]} 0 34%, ${p.palette[1]} 34% 67%, ${p.palette[2]} 67% 100%)` }
                      : { background: p.accent }) as CSSProperties
                  }
                  aria-hidden
                />
                {seen && !marked && !isLast && !roomClear && (
                  <span className="toc-row__visited" title="已探索">
                    ✓
                  </span>
                )}
                {marked && (
                  <span className="toc-row__mark" title="书签 · 再点 HUD 书签钮可取消">
                    ▼
                  </span>
                )}
                <span className="toc-row__hint" aria-hidden>
                  <span className="toc-row__hint-thumb">
                    <RoomThumb room={i} />
                  </span>
                  <span className="toc-row__hint-text">{p.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
        {(sessions > 0 || readingMs > 0 || flips > 0) && (
          <div className="toc-dossier" data-stamp={String(Math.max(1, sessions)).padStart(3, '0')}>
            <div className="toc-dossier__head">
              <span>READING DOSSIER · 阅读档案</span>
              <button
                type="button"
                className="toc-dossier__seals toc-dossier__seals--link"
                onClick={() => onJumpToFlat?.(colophonFlat)}
                disabled={!onJumpToFlat}
                title="翻到版权页查看印谱"
                aria-label={`查看印谱，已入谱 ${stamps.length} 枚，共 ${STAMP_COUNT} 枚，翻到版权页`}
              >
                ◈ 印 {stamps.length}/{STAMP_COUNT} ↦
              </button>
              <span
                className={`toc-dossier__clears${clearedDone === clearedCount ? ' toc-dossier__clears--all' : ''}`}
                title={clearedDone === clearedCount ? '五间可挑战房间全数通关 · 五关齐破' : clearedDone > 0 ? `已通关：${cleared.filter((n) => CLEARABLE_ROOMS.has(n)).join('、')} 号房间` : '五间可挑战房间：06 引力剧场 · 07 生命 · 15 躲避线 · 18 色觉 · 20 白'}
              >
                ✦ 通 {clearedDone}/{clearedCount}
                {clearedDone === clearedCount && ' · 齐破'}
              </span>
            </div>
            <div className="toc-dossier__grid">
              <div className="toc-dossier__cell">
                <span className="toc-dossier__v">{formatReadingMs(readingMs)}</span>
                <span className="toc-dossier__k">共处时长</span>
              </div>
              <div className="toc-dossier__cell">
                <span className="toc-dossier__v">{flips}</span>
                <span className="toc-dossier__k">翻动页数</span>
              </div>
              <div className="toc-dossier__cell">
                <span className="toc-dossier__v">
                  {seenCount}
                  <em>/{ART_COUNT}</em>
                </span>
                <span className="toc-dossier__k">探索房间</span>
              </div>
              <div className="toc-dossier__cell">
                <span className="toc-dossier__v">{Math.max(1, sessions)}</span>
                <span className="toc-dossier__k">翻开次数</span>
              </div>
            </div>
            {sessionLog.length > 0 && (
              <div
                className="toc-rhythm"
                aria-label={`翻书节奏：最近 ${sessionLog.length} 次翻开，各翻动 ${sessionLog.join('、')} 页`}
              >
                <span className="toc-rhythm__label">翻书节奏 RHYTHM</span>
                <span className="toc-rhythm__sub">近 {sessionLog.length} 次</span>
                <div className="toc-rhythm__bars" aria-hidden>
                  {sessionLog.map((n, i) => {
                    const h = logMax > 0 ? Math.max(8, Math.round((n / logMax) * 100)) : 8
                    const isNow = i === sessionLog.length - 1
                    return (
                      <span
                        key={i}
                        className={`toc-rhythm__bar${isNow ? ' toc-rhythm__bar--now' : ''}`}
                        style={{ height: `${h}%`, animationDelay: `${i * 45}ms` }}
                      />
                    )
                  })}
                </div>
                <span className="toc-rhythm__note" aria-hidden>
                  每格一次翻开 · 高度 = 当次翻页数
                </span>
              </div>
            )}
          </div>
        )}
        <div className="toc-page__foot">
          <span>顺序是读者的幻觉 · 翻页：页角 / 拖拽 / ← → / 滚轮</span>
          {sessions > 1 && <span className="toc-page__sessions">你已第 {sessions} 次翻开这本书</span>}
          <a
            className="toc-gh"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 源码仓库"
            title="GitHub · 43aquarius/flip"
          >
            <Github size={12} strokeWidth={1.8} aria-hidden />
            源码 · {GITHUB_REPO_LABEL} ↗
          </a>
        </div>
      </div>
    </div>
  )
}

/* ============ 版权页 ============ */

export function ColophonPage() {
  const readingMs = useBookStore((s) => s.readingMs)
  const flips = useBookStore((s) => s.flips)
  const visited = useBookStore((s) => s.visited)
  const stamps = useBookStore((s) => s.stamps)
  const bookmarks = useBookStore((s) => s.bookmarks)
  const sessions = useBookStore((s) => s.sessions)
  const finished = useBookStore((s) => s.finished)
  const nightTouched = useBookStore((s) => s.nightTouched)
  const cleared = useBookStore((s) => s.cleared)

  // 印章判定快照（与 store 结算器同构）
  const snap: StampState = {
    flips,
    visitedCount: visited.length,
    bookmarksCount: bookmarks.length,
    readingMs,
    sessions,
    finished,
    nightTouched,
    clearedCount: cleared.length,
  }

  // 五间可挑战房间全数通关 → 印谱终章金辉
  const allCleared = Array.from(CLEARABLE_ROOMS.keys()).every((n) => cleared.includes(n))

  return (
    <div className="struct-page colophon-page">
      <div className="colophon-page__wrap">
        <div className="colophon-page__title">版权页 COLOPHON</div>
        <div className="colophon-page__row">
          <span>书名</span>
          <span>《翻》FLIP · 二十个房间</span>
        </div>
        <div className="colophon-page__row">
          <span>版次</span>
          <span>第一版 · 第一印 · MMXXV</span>
        </div>
        <div className="colophon-page__row">
          <span>印数</span>
          <span>∞ 册</span>
        </div>
        <div className="colophon-page__row">
          <span>纸张</span>
          <span>无机玻璃与光</span>
        </div>
        <div className="colophon-page__row">
          <span>字体</span>
          <span>Archivo Black / Space Mono / 系统字库</span>
        </div>
        <div className="colophon-page__row">
          <span>出版</span>
          <span>Z.AI PRESS · 虚构出版部</span>
        </div>
        <div className="colophon-page__row">
          <span>源码</span>
          <span>
            <a
              className="colophon-gh"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              title="GitHub · 43aquarius/flip"
            >
              <Github size={12} strokeWidth={1.8} aria-hidden />
              {GITHUB_REPO_LABEL} ↗
            </a>
          </span>
        </div>
        {(readingMs > 0 || flips > 0) && (
          <div className="colophon-dossier">
            <div className="colophon-dossier__label">本册阅读档案 · YOUR COPY</div>
            <div className="colophon-dossier__text">
              这册书在你手中停留了 {formatReadingMs(readingMs)}，
              翻动 {flips} 页，到访 {visited.length} 个房间。
            </div>
          </div>
        )}
        <div className={`seal-album${allCleared ? ' seal-album--complete' : ''}`}>
          <div className="seal-album__head">
            <span className="seal-album__title">印谱 SEAL ALBUM</span>
            <span className={`seal-album__count${allCleared ? ' seal-album__count--gold' : ''}`}>
              {stamps.length}/{STAMP_COUNT}
            </span>
          </div>
          <div className="seal-album__grid">
            {STAMPS.map((st) => (
              <SealSlot
                key={st.id}
                stamp={st}
                unlocked={stamps.includes(st.id)}
                progress={stamps.includes(st.id) ? null : st.progress?.(snap) ?? null}
                gold={allCleared && st.id === 'all-clear'}
              />
            ))}
          </div>
          {allCleared && (
            <div className="seal-album__finale">
              ✦ ✦ ✦ 五关齐破 · ALL FIVE CLEARED ✦ ✦ ✦
            </div>
          )}
        </div>
        <div className="colophon-barcode" aria-hidden />
        <div className="colophon-page__note">印谱藏于本页 · 未入谱的印章印着离下一枚的距离</div>
      </div>
    </div>
  )
}

/* ============ 封底内页（诚实的空白） ============ */

export function InsideBackPage() {
  return (
    <div className="struct-page blank-page">
      <div className="blank-page__ring" aria-hidden />
      <div className="blank-page__text">这是一页诚实的空白</div>
    </div>
  )
}

/* ============ 封底 ============ */

export function BackCoverPage({ onBack }: { onBack?: () => void }) {
  return (
    <div className="struct-page backcover-page">
      <button type="button" className="backcover-page__flip" onClick={onBack} aria-label="翻回书里">
        <div className="backcover-page__frame" aria-hidden />
        <div className="backcover-page__wrap">
          <div className="backcover-page__blurb">
            一本需要用手翻阅的书。
            <br />
            没有必读的顺序，<em>没有读完的义务</em>。
            <br />
            二十个房间，每一个都在你
            <br />
            合上书之后继续存在。
          </div>
          <div className="backcover-page__foot">
            <div>
              <div className="backcover-page__price">∞ 元</div>
              <div className="backcover-page__hint" style={{ marginTop: '1cqh' }}>
                Z.AI PRESS · MMXXV
              </div>
            </div>
            <div className="backcover-page__hint">点击回翻 · FLIP BACK</div>
          </div>
        </div>
      </button>
      <a
        className="backcover-gh"
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub 源码仓库 43aquarius/flip"
        title="GitHub · 43aquarius/flip"
      >
        <Github size={14} strokeWidth={1.8} aria-hidden />
        <span>43aquarius/flip</span>
      </a>
    </div>
  )
}

/* ============ 纸背（移动端叶子背面） ============ */

export function PaperBack() {
  return (
    <div className="paperback" aria-hidden>
      <div className="paperback__mark">翻</div>
      <div className="paperback__tag">VERSO · 纸背</div>
    </div>
  )
}
