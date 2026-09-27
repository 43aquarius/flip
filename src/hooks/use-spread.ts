'use client'

import { useEffect, useState } from 'react'

/**
 * 桌面端（≥1024px）使用双页跨页模式，移动端使用单页模式。
 * 返回 null 表示尚未完成首屏测量（SSR 安全）。
 */
export function useIsSpread(): boolean | null {
  const [spread, setSpread] = useState<boolean | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => setSpread(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return spread
}
