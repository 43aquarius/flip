'use client'

interface PageBadgeProps {
  /** 房间号 1..20 */
  n: number
  total: number
  side: 'left' | 'right' | 'single'
  title: string
}

/** 设计感页码：巨型描边数字 + 房间信息，difference 混合自动适应任何底色 */
export function PageBadge({ n, total, side, title }: PageBadgeProps) {
  return (
    <div className={`page-badge page-badge--${side}`} aria-label={`房间 ${n}，共 ${total} 个`}>
      <span className="page-badge__num">{String(n).padStart(2, '0')}</span>
      <span className="page-badge__meta">
        <span>ROOM·{String(n).padStart(2, '0')}</span>
        <span className="page-badge__bar" />
        <span className="page-badge__title">{title}</span>
      </span>
    </div>
  )
}
