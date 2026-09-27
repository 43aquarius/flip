'use client'

import type { CSSProperties, ReactNode } from 'react'

interface LeafProps {
  /** 当前旋转角 0..-180 */
  deg: number
  /** 是否启用 CSS 过渡（拖拽跟手时关闭） */
  animating: boolean
  /** 过渡时长 ms */
  duration: number
  zIndex: number
  /** 移动端单页模式 */
  single: boolean
  /** 翻动中投到静态页上的阴影强度 0..1 */
  castShadow: number
  front: ReactNode
  back: ReactNode
  onSettled?: () => void
}

/**
 * 一张 3D 书页叶子：front = 未翻起时右页，back = 翻过后左页。
 * 阴影层次：沟影(静态) → 投影(动态) → 面阴影 → 光泽 → 纸纹
 */
export function Leaf({
  deg,
  animating,
  duration,
  zIndex,
  single,
  castShadow,
  front,
  back,
  onSettled,
}: LeafProps) {
  const t = Math.abs(deg) / 180
  const lift = Math.sin(t * Math.PI) // 0 → 1 → 0
  const frontShade = lift * 0.52
  const backShade = (1 - t) * 0.45
  const castOnFront = deg > -90 ? castShadow : 0
  const castOnBack = deg <= -90 ? castShadow : 0

  return (
    <div
      className={`book-leaf${single ? ' book-leaf--single' : ''}`}
      style={
        {
          zIndex,
          transform: `rotateY(${deg}deg)`,
          transitionDuration: animating ? `${duration}ms` : '0ms',
        } as CSSProperties
      }
      onTransitionEnd={(e) => {
        if (e.propertyName === 'transform' && e.currentTarget === e.target) onSettled?.()
      }}
    >
      <div className="leaf-face leaf-face--front">
        {front}
        <div className="leaf-gutter" aria-hidden />
        <div className="leaf-cast leaf-cast--front" style={{ opacity: castOnFront * 0.3 }} aria-hidden />
        <div className="leaf-shade leaf-shade--front" style={{ opacity: frontShade }} aria-hidden />
        <div className="leaf-gloss" style={{ opacity: lift * 0.7 }} aria-hidden />
        <div className="paper-tex" aria-hidden />
      </div>
      <div className="leaf-face leaf-face--back">
        {back}
        <div className="leaf-gutter leaf-gutter--back" aria-hidden />
        <div className="leaf-cast leaf-cast--back" style={{ opacity: castOnBack * 0.3 }} aria-hidden />
        <div className="leaf-shade leaf-shade--back" style={{ opacity: backShade }} aria-hidden />
        <div className="paper-tex" aria-hidden />
      </div>
    </div>
  )
}
