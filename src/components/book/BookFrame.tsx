'use client'

import type { ReactNode } from 'react'

interface BookFrameProps {
  /** 桌面跨页 / 移动单页 */
  spread: boolean
  /** 翻阅进度 0..1 */
  progress: number
  /** 合上于封面侧 */
  spineStart: boolean
  /** 合上于封底侧（桌面端读毕） */
  spineEnd: boolean
  children: ReactNode
}

/**
 * 书的物理框架：底座、页堆厚度边缘（随进度变化）、书脊。
 * children = .book-body（叶子与翻页热区）
 */
export function BookFrame({ progress, spineStart, spineEnd, children }: BookFrameProps) {
  const leftFrac = Math.min(1, Math.max(0, progress))
  const rightFrac = 1 - leftFrac

  return (
    <>
      <div className="book-base" aria-hidden />
      <div className="book-edge book-edge--left" style={{ height: `${leftFrac * 98}%` }} aria-hidden />
      <div className="book-edge book-edge--right" style={{ height: `${rightFrac * 98}%` }} aria-hidden />
      <div className="book-edge book-edge--bottom" aria-hidden />
      <div
        className="book-spine book-spine--start"
        style={{ opacity: spineStart ? 1 : 0 }}
        aria-hidden
      >
        <span className="book-spine__text">FLIP · 翻 · Z.AI PRESS</span>
      </div>
      <div
        className="book-spine book-spine--end"
        style={{ opacity: spineEnd ? 1 : 0 }}
        aria-hidden
      >
        <span className="book-spine__text">MMXXV · 二十个房间</span>
      </div>
      {children}
    </>
  )
}
