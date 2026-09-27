'use client'

import { useEffect, useRef, useState } from 'react'

interface CoverPeelProps {
  /** 书合上且静止时为 true（此时预掀角生效） */
  active: boolean
}

/**
 * 封面预掀角 —— 合上的书，指针越靠近右下页角，
 * 页角越被「掀」起（纸背三角 + 投影），暗示这本书可以翻开。
 * 纯视觉层（pointer-events: none），不拦截开书交互；
 * 仅在支持 hover 的设备上启用。
 */
export function CoverPeel({ active }: CoverPeelProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)

  /* 仅指针设备启用（hover 媒体查询；老内核回退：无触摸点即视为桌面） */
  useEffect(() => {
    const update = () => {
      const fine =
        window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches
      const noTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints === 0
      setEnabled(Boolean(fine || noTouch))
    }
    update()
  }, [])

  /* 指针趋近驱动 --lift（0..1，smoothstep） */
  useEffect(() => {
    if (!enabled) return
    const el = rootRef.current
    if (!el) return

    const INFLUENCE = 340 // 影响半径（px）
    let raf = 0
    let target = 0
    let current = 0
    let running = false

    const tick = () => {
      // 阻尼趋近： lift 缓慢追随目标，避免指针抖动导致的机械感
      current += (target - current) * 0.18
      if (Math.abs(target - current) < 0.002) current = target
      el.style.setProperty('--lift', current.toFixed(3))
      if (current !== target || target !== 0) {
        raf = requestAnimationFrame(tick)
      } else {
        running = false
      }
    }

    const wake = () => {
      if (!running) {
        running = true
        raf = requestAnimationFrame(tick)
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!active) return
      // 从父级（.book-body）取矩形：根元素是 0×0 锚点，页角 = 书体右下角
      const host = el.parentElement
      if (!host) return
      const r = host.getBoundingClientRect()
      if (r.width < 60 || r.height < 80) return
      // 右下页角坐标
      const cx = r.right
      const cy = r.bottom
      const d = Math.hypot(e.clientX - cx, e.clientY - cy)
      let t = 1 - d / INFLUENCE
      t = t < 0 ? 0 : t > 1 ? 1 : t
      // smoothstep：远处更含蓄，近处更明显
      target = t * t * (3 - 2 * t)
      wake()
    }

    const onLeave = () => {
      target = 0
      wake()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onLeave, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onLeave)
      document.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(raf)
    }
  }, [active, enabled])

  if (!enabled) return null

  return (
    <div
      ref={rootRef}
      className={`cover-peel${active ? ' cover-peel--on' : ''}`}
      style={{ '--lift': 0 } as React.CSSProperties}
      aria-hidden
    >
      {/* 掀起后页角在封面上投下的影 */}
      <div className="cover-peel__cast" />
      {/* 掀起的纸背角（折痕高光 + 投影） */}
      <div className="cover-peel__fold" />
    </div>
  )
}
