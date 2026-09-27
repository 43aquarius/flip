'use client'

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import { playStampSound } from '@/lib/book/sound'
import { SealFace } from './SealMark'

/**
 * 盖章提示：印章解锁瞬间右下角浮现，
 * 盖章动画（放大落定 + 轻微旋转）+ 低频闷击音效，
 * 3.8s 后自动消散；多枚印章依次排队展示。
 */
export function StampToast() {
  const pending = useBookStore((s) => s.pendingStamps)
  const dismiss = useBookStore((s) => s.dismissPendingStamp)
  const head = pending[0]
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!head) return
    playStampSound()
    timerRef.current = setTimeout(() => dismiss(), 3800)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [head, dismiss])

  if (!head) return null

  return (
    <div className="stamp-toast" role="status" aria-live="polite" key={head.id}>
      <span className="stamp-toast__seal" aria-hidden>
        <SealFace glyph={head.glyph} />
      </span>
      <span className="stamp-toast__body">
        <span className="stamp-toast__kicker">印章入谱 · STAMP ACQUIRED</span>
        <span className="stamp-toast__name">
          {head.name}
          <em>{head.en}</em>
        </span>
        <span className="stamp-toast__desc">{head.desc}</span>
      </span>
      {pending.length > 1 && (
        <span className="stamp-toast__queue" aria-hidden>
          +{pending.length - 1}
        </span>
      )}
    </div>
  )
}
