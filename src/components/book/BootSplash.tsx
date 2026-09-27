'use client'

import { useEffect, useState } from 'react'

/** 开机仪式：黑幕 + 巨型「翻」字扫光，随后淡出 */
export function BootSplash({ visible }: { visible: boolean }) {
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (visible) return
    const t = setTimeout(() => setGone(true), 750)
    return () => clearTimeout(t)
  }, [visible])

  if (gone) return null

  return (
    <div className={`boot-splash${visible ? '' : ' boot-splash--hide'}`} aria-hidden={visible ? undefined : true}>
      <div className="boot-splash__glyph">翻</div>
      <div className="boot-splash__text">BINDING · 正在装订二十个房间</div>
    </div>
  )
}
