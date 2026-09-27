'use client'

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useBookStore } from '@/lib/book-store'
import { CLEARABLE_ROOMS, artFlatIndex, BOOK_PAGES } from '@/lib/book/pages'
import { playClearSound } from '@/lib/book/sound'
import { SealFace } from './SealMark'

/** 通关闪印从出现到消费（保持 + 消散，ms） */
const CLEAR_HOLD = 2100
const CLEAR_FADE = 650
/** 终章模式（五关齐破）加长展示 */
const FINALE_EXTRA = 900

interface ClearFlashProps {
  /** 当前可见的房间号（桌面跨页为 [左, 右]） */
  currentArts: number[]
  /** 桌面跨页 / 移动单页 */
  spread: boolean
}

/**
 * 房间通关闪印：clearRoom 达成的瞬间，一枚大「通」印砸在玩家眼前的书页上 ——
 * 落定回弹 + 印泥红晕扩散 + 五度双音，随后淡出消散。
 * 状态直接派生自 store.pendingClear（不落地本地 state）：
 * 展示计时结束调用 consumeClearFlash 归零，组件随之卸载。
 * 若这次通关恰好集齐全部五间可挑战房间 → 终章模式（金色 · 五关齐破）。
 */
export function ClearFlash({ currentArts, spread }: ClearFlashProps) {
  const pendingClear = useBookStore((s) => s.pendingClear)
  const consumeClearFlash = useBookStore((s) => s.consumeClearFlash)
  const cleared = useBookStore((s) => s.cleared)

  /* 这次通关是否集齐全部可挑战房间（clearRoom 先写 cleared 再写 pendingClear，同一 set） */
  const finale = pendingClear !== null && Array.from(CLEARABLE_ROOMS.keys()).every((n) => cleared.includes(n))

  useEffect(() => {
    if (!pendingClear) return
    playClearSound(0.85)
    const t = setTimeout(
      () => consumeClearFlash(),
      CLEAR_HOLD + CLEAR_FADE + (finale ? FINALE_EXTRA : 0),
    )
    return () => clearTimeout(t)
  }, [pendingClear, consumeClearFlash, finale])

  if (!pendingClear) return null

  const room = pendingClear.room
  const page = BOOK_PAGES[artFlatIndex(room)]
  if (!page) return null
  const challenge = CLEARABLE_ROOMS.get(room) ?? ''

  /* 闪印落点：桌面按房间的左 / 右页位，移动单页取页面中偏下 */
  const side =
    spread && currentArts.length === 2
      ? room === currentArts[1]
        ? 'right'
        : 'left'
      : 'single'
  const left = side === 'right' ? '75%' : side === 'left' ? '25%' : '55%'

  return (
    <div
      key={pendingClear.at}
      className={`clear-flash clear-flash--${side}${finale ? ' clear-flash--finale' : ''}`}
      style={{ left } as CSSProperties}
      role="status"
      aria-label={`房间 ${String(room).padStart(2, '0')} ${page.title} 通关${finale ? ' · 五关齐破' : ''}`}
    >
      <div className="clear-flash__seal">
        <SealFace glyph={finale ? '極' : '通'} />
      </div>
      <div className="clear-flash__text">
        <span className="clear-flash__kicker">
          {finale ? 'ALL FIVE CLEARED · 五关齐破' : 'ROOM CLEAR · 通关'}
        </span>
        <span className="clear-flash__room">
          №{String(room).padStart(2, '0')} {page.title} · {page.titleCn}
        </span>
        {challenge && <span className="clear-flash__challenge">{challenge} — 达成</span>}
        {finale && (
          <span className="clear-flash__finale-line">
            ✦ ✦ ✦ 引力剧场 · 生命 · 躲避线 · 色觉 · 白 — 全数破关
          </span>
        )}
      </div>
    </div>
  )
}
