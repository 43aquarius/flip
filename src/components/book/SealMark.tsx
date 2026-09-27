'use client'

import type { StampDef, StampProgress } from '@/lib/book/stamps'

/**
 * 印面（白文印）：朱砂印泥方块 + 纸色印文。
 * 毛边质感来自文档级 SVG 滤镜 #seal-rough（BookStage 挂载一次）。
 */
export function SealFace({ glyph }: { glyph: string }) {
  return (
    <svg viewBox="0 0 64 64" className="seal-face" aria-hidden focusable="false">
      <g filter="url(#seal-rough)">
        <rect x="6" y="6" width="52" height="52" rx="3" className="seal-face__block" />
        <text x="32" y="46" textAnchor="middle" className="seal-face__glyph">
          {glyph}
        </text>
      </g>
    </svg>
  )
}

/**
 * 印谱格：已入谱 = 朱红印章；未入谱 = 虚线空位。
 * 可量化条件附带进度细条与文本（如 46/50），悬停提示印章来历。
 * gold：终章金印模式（五关齐破时的「通」印转金）。
 */
export function SealSlot({
  stamp,
  unlocked,
  progress,
  gold = false,
}: {
  stamp: StampDef
  unlocked: boolean
  /** 未解锁印章的当前进度（已解锁或二值条件为 null） */
  progress?: StampProgress | null
  /** 终章金印（五关齐破的「通」印以鎏金呈现） */
  gold?: boolean
}) {
  const showBar = !unlocked && progress != null && progress.ratio > 0
  const tip = gold
    ? `${stamp.name} · ${stamp.en} — ${stamp.desc} · 五关齐破`
    : unlocked
      ? `${stamp.name} · ${stamp.en} — ${stamp.desc}`
      : progress
        ? `未解锁 — ${stamp.desc}（当前 ${progress.text}）`
        : `未解锁 — ${stamp.desc}`

  return (
    <div
      className={`seal-slot${unlocked ? ' seal-slot--on' : ''}${gold ? ' seal-slot--gold' : ''}`}
      title={tip}
    >
      <span className="seal-slot__face">
        {unlocked ? <SealFace glyph={stamp.glyph} /> : <span className="seal-slot__q" aria-hidden>？</span>}
      </span>
      <span className="seal-slot__name">{stamp.name}</span>
      {showBar && (
        <span className="seal-slot__prog" aria-hidden>
          <span className="seal-slot__track" aria-hidden>
            <span className="seal-slot__fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </span>
          <span className="seal-slot__ptext">{progress.text}</span>
        </span>
      )}
      {!unlocked && <span className="sr-only">未解锁：{stamp.desc}</span>}
    </div>
  )
}
