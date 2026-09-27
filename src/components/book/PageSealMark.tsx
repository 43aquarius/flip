'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useBookStore } from '@/lib/book-store'
import { stampById } from '@/lib/book/stamps'
import { playStampSound } from '@/lib/book/sound'
import { SealFace } from './SealMark'

/** 落在书页上的一枚钤印 */
interface PageSeal {
  stampId: string
  /** 落印时所在页（跨页位置 key），翻走隐藏、翻回重现 */
  pageKey: string
  /** 预设钤印位索引 */
  slot: number
  /** 随机微旋转 deg */
  rot: number
  /** 落印时刻（用于 key，触发落印动画） */
  born: number
}

/** 桌面跨页钤印位（百分比相对 book-body；避让页码徽章与翻页热区） */
const SPOTS_DESK = [
  { left: '75%', top: '71%' }, // 右页右下 · 主位
  { left: '20%', top: '68%' }, // 左页左下
  { left: '77%', top: '23%' }, // 右页右上
  { left: '23%', top: '32%' }, // 左页中部
]

/** 移动单页钤印位 */
const SPOTS_MOBILE = [
  { left: '72%', top: '72%' },
  { left: '25%', top: '66%' },
  { left: '70%', top: '25%' },
  { left: '27%', top: '33%' },
]

/** 最多同时落在页面上的印章数（更多只走 toast + 印谱） */
const MAX_PAGE_SEALS = 4

/** toast 队首展示后印章才开始落纸（ms），多枚依次错开 */
const SEAL_DELAY = 1600
const SEAL_STAGGER = 620

interface PageSealMarkProps {
  /** 当前跨页位置 key（flipped + 模式），变化 = 翻页 */
  pageKey: string
  /** 桌面跨页 / 移动单页 */
  spread: boolean
}

/**
 * 页面钤印：印章解锁时（toast 先行）延迟把朱红印盖在当前书页上——
 * 落印动画（放大落定 + 印泥红晕）+ 轻声闷击；印随页留存，
 * 翻走隐藏、翻回重现；点击印章查看来历小卡。
 */
export function PageSealMark({ pageKey, spread }: PageSealMarkProps) {
  const stamps = useBookStore((s) => s.stamps)
  const [seals, setSeals] = useState<PageSeal[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const prevRef = useRef<string[]>(stamps)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const slotRef = useRef(0)

  /* 新解锁印章 → 延迟落印 */
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = stamps
    const fresh = stamps.filter((id) => !prev.includes(id))
    if (fresh.length === 0) return
    const keyAtUnlock = pageKey
    fresh.forEach((id, i) => {
      const t = setTimeout(() => {
        setSeals((s) => {
          if (s.length >= MAX_PAGE_SEALS) return s
          const slot = slotRef.current % Math.min(SPOTS_DESK.length, MAX_PAGE_SEALS)
          slotRef.current = (slotRef.current + 1) % Math.min(SPOTS_DESK.length, MAX_PAGE_SEALS)
          playStampSound(0.45)
          return [
            ...s,
            {
              stampId: id,
              pageKey: keyAtUnlock,
              slot,
              rot: (Math.random() * 2 - 1) * 7,
              born: Date.now() + i,
            },
          ]
        })
      }, SEAL_DELAY + i * SEAL_STAGGER)
      timersRef.current.push(t)
    })
  }, [stamps])

  /* 卸载时清理全部落印定时器 */
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
  }, [])

  const visible = seals.filter((s) => s.pageKey === pageKey)
  const spots = spread ? SPOTS_DESK : SPOTS_MOBILE

  return (
    <div className="page-seals" aria-label="本页钤印">
      {visible.map((s) => {
        const def = stampById(s.stampId)
        if (!def) return null
        const spot = spots[s.slot] ?? spots[0]
        const open = openId === s.stampId
        return (
          <div
            key={s.stampId}
            className={`page-seal${open ? ' page-seal--open' : ''}`}
            style={{ left: spot.left, top: spot.top, '--seal-rot': `${s.rot}deg` } as CSSProperties}
          >
            <button
              type="button"
              className="page-seal__hit"
              onClick={() => setOpenId(open ? null : s.stampId)}
              aria-label={`钤印 · ${def.name}（${def.desc}）`}
              aria-expanded={open}
            >
              <span className="page-seal__face">
                <SealFace glyph={def.glyph} />
              </span>
            </button>
            {open && (
              <div className="page-seal__card" role="note">
                <span className="page-seal__kicker">钤印 · SEALED</span>
                <span className="page-seal__name">
                  {def.name}
                  <em>{def.en}</em>
                </span>
                <span className="page-seal__desc">{def.desc}</span>
                <span className="page-seal__foot">已录入版权页印谱</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
