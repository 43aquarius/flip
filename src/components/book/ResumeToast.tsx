'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, RotateCcw, X } from 'lucide-react'
import { useBookStore } from '@/lib/book-store'
import { artFlatIndex, BOOK_PAGES } from '@/lib/book/pages'
import { RoomThumb } from './RoomThumb'

interface ResumeToastProps {
  /** 启动仪式完成时调用 */
  booted: boolean
  /** 用户已主动跳转过（不再询问） */
  userHasMoved: boolean
  onContinue: () => void
  onRestart: () => void
}

export function ResumeToast({ booted, userHasMoved, onContinue, onRestart }: ResumeToastProps) {
  const lastArt = useBookStore((s) => s.lastArt)
  const savedAt = useBookStore((s) => s.savedAt)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (userHasMoved) setDismissed(true)
  }, [userHasMoved])

  const show = booted && !dismissed && lastArt > 0 && lastArt <= 20 && !userHasMoved

  if (!show) return null

  const ageMin = savedAt ? Math.max(0, Math.round((Date.now() - savedAt) / 60000)) : 0
  const ageText = ageMin < 1 ? '刚刚' : ageMin < 60 ? `${ageMin} 分钟前` : `${Math.round(ageMin / 60)} 小时前`
  const artLabel = String(lastArt).padStart(2, '0')

  return (
    <div className="resume-toast" role="dialog" aria-label="继续上次阅读">
      <button
        type="button"
        className="resume-toast__close"
        onClick={() => setDismissed(true)}
        aria-label="关闭"
      >
        <X size={14} strokeWidth={2} />
      </button>
      <div className="resume-toast__head">
        <span className="resume-toast__kicker">CONTINUE · 续读</span>
        <span className="resume-toast__time">{ageText}</span>
      </div>
      <div className="resume-toast__body">
        <span className="resume-toast__thumb" aria-hidden>
          <RoomThumb room={lastArt} />
        </span>
        <span className="resume-toast__copy">
          上次合上书时，停在房间
          <strong className="resume-toast__art">{artLabel}</strong>
          <em className="resume-toast__title">
            {BOOK_PAGES[artFlatIndex(lastArt)]?.title ?? ''} · {BOOK_PAGES[artFlatIndex(lastArt)]?.titleCn ?? ''}
          </em>
        </span>
      </div>
      <div className="resume-toast__actions">
        <button
          type="button"
          className="resume-toast__btn resume-toast__btn--primary"
          onClick={() => {
            setDismissed(true)
            onContinue()
          }}
        >
          <ArrowRight size={14} strokeWidth={2.2} />
          <span>继续阅读</span>
        </button>
        <button
          type="button"
          className="resume-toast__btn resume-toast__btn--ghost"
          onClick={() => {
            setDismissed(true)
            onRestart()
          }}
        >
          <RotateCcw size={13} strokeWidth={2} />
          <span>从头开始</span>
        </button>
      </div>
    </div>
  )
}
