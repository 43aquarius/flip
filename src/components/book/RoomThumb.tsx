'use client'

import type { CSSProperties, ReactNode } from 'react'
import { artFlatIndex, BOOK_PAGES } from '@/lib/book/pages'

/**
 * 房间迷你缩略图：每个房间一枚 52×38 手工设计的 SVG 微图案，
 * 取自该房间的三色调色板与视觉母题（尘埃 / 字块 / 墨环 / 切片 / 光栅 …）。
 * 确定性渲染（无随机），用于书签面板、续读提示等需要「一眼认出房间」的位置。
 */

/** 简易确定性伪随机（mulberry32）——用于尘点 / 鸟群等散布母题 */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 52
const H = 38

/** 每个房间的微图案（viewBox 52×38） */
function motif(n: number, p: [string, string, string]): ReactNode {
  const [bg, a, b] = p
  switch (n) {
    case 1: {
      // GENESIS 尘之场：暗底 + 金尘散点 + 中心旋涡
      const rnd = seeded(11)
      const dots = Array.from({ length: 22 }, (_, i) => (
        <circle key={i} cx={4 + rnd() * 44} cy={3 + rnd() * 32} r={rnd() * 0.9 + 0.35} fill={i % 5 === 0 ? b : a} opacity={0.45 + rnd() * 0.55} />
      ))
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          {dots}
          <circle cx={26} cy={19} r={5.5} fill="none" stroke={a} strokeWidth={0.7} opacity={0.8} />
          <circle cx={26} cy={19} r={2.6} fill={a} opacity={0.9} />
        </>
      )
    }
    case 2:
      // TYPE RIOT 字暴：酸黄底 + 两枚黑色「字块」微倾
      return (
        <>
          <rect width={W} height={H} fill={a} />
          <rect x={7} y={7} width={13} height={17} fill={bg} transform="rotate(-7 13 15)" />
          <rect x={28} y={11} width={14} height={19} fill={bg} transform="rotate(6 35 20)" />
          <rect x={30} y={5} width={9} height={3} fill={b} />
        </>
      )
    case 3:
      // INK 墨池：纸底 + 墨环 + 朱砂点
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <circle cx={22} cy={20} r={11} fill="none" stroke={a} strokeWidth={1.1} />
          <circle cx={22} cy={20} r={7.5} fill="none" stroke={a} strokeWidth={0.7} opacity={0.7} />
          <circle cx={22} cy={20} r={4} fill={a} opacity={0.85} />
          <circle cx={38} cy={11} r={2.2} fill={b} />
          <circle cx={42} cy={27} r={1.2} fill={a} opacity={0.6} />
        </>
      )
    case 4:
      // GLITCH 故障花园：黑底 + 品红/绿错位切片
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <rect x={4} y={9} width={30} height={5} fill={a} />
          <rect x={10} y={9} width={34} height={5} fill={b} opacity={0.75} transform="translate(2 0)" />
          <rect x={6} y={19} width={24} height={4} fill={b} />
          <rect x={12} y={19} width={30} height={4} fill={a} opacity={0.8} />
          <rect x={8} y={27} width={36} height={2.4} fill="#f5f1e6" opacity={0.85} />
        </>
      )
    case 5: {
      // MOIRÉ 干涉：白底 + 两族竖线光栅（不同间距产生条纹）
      const l1 = Array.from({ length: 9 }, (_, i) => (
        <rect key={`a${i}`} x={4 + i * 5.4} y={2} width={1.5} height={H - 4} fill={a} />
      ))
      const l2 = Array.from({ length: 8 }, (_, i) => (
        <rect key={`b${i}`} x={7 + i * 6.1} y={2} width={1.5} height={H - 4} fill={a} opacity={0.55} />
      ))
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          {l1}
          {l2}
        </>
      )
    }
    case 6:
      // ORBIT 引力剧场：深空 + 恒星 + 两道轨道
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <ellipse cx={26} cy={19} rx={17} ry={8} fill="none" stroke={b} strokeWidth={0.6} opacity={0.55} strokeDasharray="2 2" />
          <ellipse cx={26} cy={19} rx={11} ry={13} fill="none" stroke={b} strokeWidth={0.6} opacity={0.4} strokeDasharray="2 2" transform="rotate(-18 26 19)" />
          <circle cx={26} cy={19} r={2.6} fill={a} />
          <circle cx={26} cy={19} r={5} fill={a} opacity={0.22} />
          <circle cx={41} cy={14} r={1.5} fill={b} />
          <circle cx={14} cy={27} r={1.2} fill={b} />
        </>
      )
    case 7: {
      // LIFE 生命游戏：纸底 + 滑翔机细胞阵
      const cells: Array<[number, number]> = [
        [10, 8], [12, 8], [14, 8], [16, 8],
        [10, 10], [16, 10],
        [16, 12],
        [12, 14], [14, 14], [16, 14],
        [24, 10], [26, 10],
        [24, 12], [28, 12],
        [24, 14], [26, 14],
        [34, 8], [38, 8], [36, 10], [36, 12], [36, 14],
      ]
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          {cells.map(([x, y], i) => (
            <rect key={i} x={x} y={y} width={3.4} height={3.4} fill={i < 11 ? a : b} opacity={i < 11 ? 0.85 : 0.9} />
          ))}
        </>
      )
    }
    case 8:
      // THE WELL 井：黑底 + 桃红透视方环
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <rect x={5} y={5} width={42} height={28} fill="none" stroke={a} strokeWidth={0.9} opacity={0.9} />
          <rect x={10} y={7.6} width={32} height={22.8} fill="none" stroke={a} strokeWidth={0.8} opacity={0.75} />
          <rect x={15} y={10.2} width={22} height={17.6} fill="none" stroke={a} strokeWidth={0.7} opacity={0.6} />
          <rect x={20} y={12.6} width={12} height={12.8} fill="none" stroke={b} strokeWidth={0.7} opacity={0.8} />
        </>
      )
    case 9:
      // SOUND POND 声之池：暗绿 + 涟漪三环
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <circle cx={26} cy={19} r={14} fill="none" stroke={a} strokeWidth={0.6} opacity={0.45} />
          <circle cx={26} cy={19} r={9} fill="none" stroke={a} strokeWidth={0.8} opacity={0.7} />
          <circle cx={26} cy={19} r={4.5} fill="none" stroke={a} strokeWidth={1} opacity={0.95} />
          <circle cx={26} cy={19} r={1.4} fill={b} />
        </>
      )
    case 10: {
      // FLOCK 群鸟：白底 + 燕形折线群 + 红色领头鸟
      const rnd = seeded(77)
      const birds = Array.from({ length: 7 }, (_, i) => {
        const x = 6 + rnd() * 38
        const y = 6 + rnd() * 26
        const s = 0.7 + rnd() * 0.6
        return (
          <path key={i} d={`M${x} ${y} l${2.6 * s} ${1.8 * s} l${-2.6 * s} ${1.8 * s}`} fill="none" stroke={a} strokeWidth={1} strokeLinecap="round" />
        )
      })
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          {birds}
          <path d="M34 9 l4 2.8 l-4 2.8" fill="none" stroke={b} strokeWidth={1.6} strokeLinecap="round" />
        </>
      )
    }
    case 11: {
      // TERMINAL 终端之环：磷绿字符环（点阵圆环）
      const pts = Array.from({ length: 26 }, (_, i) => {
        const ang = (i / 26) * Math.PI * 2
        const r = 12
        const cx = 26 + Math.cos(ang) * r
        const cy = 19 + Math.sin(ang) * r * 0.82
        const depth = (Math.sin(ang) + 1) / 2
        return (
          <rect key={i} x={cx - 0.9} y={cy - 1.3} width={1.8} height={2.6} fill={a} opacity={0.35 + depth * 0.65} />
        )
      })
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          {pts}
        </>
      )
    }
    case 12:
      // FERROFLUID 磁流：奶油纸底 + 标本皿 + 黑色铁磁流体尖峰簇（指向磁铁）
      return (
        <>
          <rect width={W} height={H} fill={a} />
          <circle cx={26} cy={22} r={12.5} fill="none" stroke={bg} strokeWidth={1.1} opacity={0.5} />
          <path d="M15 24 Q19 22 22 25 Q25 28 29 24 Q32 21 37 25 L37 27 Q37 33 26 33 Q15 33 15 27 Z" fill={bg} />
          <path d="M20 24 L21.5 14.5 L23 24 Z" fill={bg} />
          <path d="M24 25 L26 10 L28 25 Z" fill={bg} />
          <path d="M29 24 L31 14 L32.5 24 Z" fill={bg} />
          <rect x={30} y={4} width={4} height={4} fill={b} />
          <line x1={32} y1={8.5} x2={27} y2={13} stroke={b} strokeWidth={0.7} strokeDasharray="1.4 1.4" opacity={0.8} />
        </>
      )
    case 13:
      // MANDELBROT 无限海岸：暗底 + 橙色自相似螺旋点
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <path d="M6 30 Q14 30 16 24 Q18 18 24 18 Q30 18 30 12 Q30 6 37 7 Q44 8 44 15" fill="none" stroke={a} strokeWidth={1.4} />
          <path d="M16 24 Q20 24 20 20 Q20 16 25 16" fill="none" stroke={b} strokeWidth={0.8} opacity={0.7} />
          <circle cx={44} cy={15} r={1.6} fill={b} />
          <circle cx={37} cy={7} r={1} fill={a} />
        </>
      )
    case 14:
      // BLOOM 开花：纸底 + 分形枝 + 红蕊
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <path d="M26 36 L26 22 M26 28 L18 20 M26 28 L34 19 M26 23 L21 14 M26 23 L31 13" fill="none" stroke={a} strokeWidth={1.1} strokeLinecap="round" />
          <path d="M21 14 L17 10 M21 14 L24 9 M31 13 L28 8 M31 13 L35 9 M18 20 L14 16 M34 19 L38 15" fill="none" stroke={a} strokeWidth={0.7} strokeLinecap="round" opacity={0.8} />
          <circle cx={17} cy={10} r={1} fill={b} />
          <circle cx={24} cy={9} r={1} fill={b} />
          <circle cx={28} cy={8} r={1} fill={b} />
          <circle cx={35} cy={9} r={1} fill={b} />
          <circle cx={14} cy={16} r={0.8} fill={b} opacity={0.8} />
          <circle cx={38} cy={15} r={0.8} fill={b} opacity={0.8} />
        </>
      )
    case 15:
      // DODGE 躲避线：CRT 绿 + 竖墙与缺口 + 折线弹道
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <rect x={8} y={3} width={2} height={14} fill={a} />
          <rect x={8} y={25} width={2} height={10} fill={a} />
          <rect x={40} y={3} width={2} height={8} fill={a} />
          <rect x={40} y={19} width={2} height={16} fill={a} />
          <path d="M12 30 L20 24 L26 28 L34 16 L44 12" fill="none" stroke={b} strokeWidth={1.3} strokeLinecap="round" />
          <circle cx={44} cy={12} r={1.4} fill={a} />
        </>
      )
    case 16:
      // PHOSPHENE 磷光：黑底 + 闭眼视像（同心环 + 放射辐条 + 白热核心）
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <circle cx={26} cy={19} r={5} fill="none" stroke={a} strokeWidth={0.8} opacity={0.95} />
          <circle cx={26} cy={19} r={9} fill="none" stroke={a} strokeWidth={0.6} opacity={0.55} />
          <circle cx={26} cy={19} r={13} fill="none" stroke={b} strokeWidth={0.7} opacity={0.5} />
          <circle cx={26} cy={19} r={16.5} fill="none" stroke={b} strokeWidth={0.5} opacity={0.35} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const rad = (deg * Math.PI) / 180
            return (
              <line
                key={deg}
                x1={26 + Math.cos(rad) * 4}
                y1={19 + Math.sin(rad) * 4}
                x2={26 + Math.cos(rad) * 15.5}
                y2={19 + Math.sin(rad) * 15.5}
                stroke={a}
                strokeWidth={0.5}
                opacity={0.5}
              />
            )
          })}
          <circle cx={26} cy={19} r={1.4} fill="#fff2dc" />
        </>
      )
    case 17: {
      // VERTIGO 眩晕文字：酸黄底 + 环形刻度字环（椭圆透视）
      const ticks = Array.from({ length: 20 }, (_, i) => {
        const ang = (i / 20) * Math.PI * 2
        const r1 = 8
        const r2 = i % 4 === 0 ? 14 : 12
        return (
          <line
            key={i}
            x1={26 + Math.cos(ang) * r1}
            y1={19 + Math.sin(ang) * r1 * 0.78}
            x2={26 + Math.cos(ang) * r2}
            y2={19 + Math.sin(ang) * r2 * 0.78}
            stroke={a}
            strokeWidth={i % 4 === 0 ? 1.5 : 0.8}
            opacity={0.85}
          />
        )
      })
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          {ticks}
        </>
      )
    }
    case 18: {
      // CHROMA 色觉：底色网格 + 一枚异色块
      const cells = Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={7 + (i % 3) * 13} y={6 + Math.floor(i / 3) * 9.4} width={11.6} height={8.2} fill={i === 4 ? b : a} opacity={i === 4 ? 1 : 0.92} />
      ))
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          {cells}
        </>
      )
    }
    case 19:
      // VOICEPRINT 声纹：暗底 + 琥珀波形 + 扫描亮线
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <path d="M3 19 L7 19 L9 12 L11 26 L13 8 L15 30 L17 15 L19 22 L22 19 L26 19 L28 13 L30 25 L32 10 L34 28 L36 17 L38 21 L41 19 L49 19" fill="none" stroke={a} strokeWidth={1} strokeLinejoin="round" />
          <line x1={30} y1={3} x2={30} y2={35} stroke={b} strokeWidth={0.8} opacity={0.6} />
        </>
      )
    case 20:
      // WHITE 白：纯白 + 单枚黑点
      return (
        <>
          <rect width={W} height={H} fill={bg} />
          <circle cx={26} cy={19} r={2.4} fill={a} />
          <rect x={2} y={2} width={W - 4} height={H - 4} fill="none" stroke={b} strokeWidth={0.5} opacity={0.35} />
        </>
      )
    default:
      return <rect width={W} height={H} fill={bg} />
  }
}

interface RoomThumbProps {
  /** 房间号 1..20 */
  room: number
  /** 附加类名 */
  className?: string
  style?: CSSProperties
}

export function RoomThumb({ room, className = '', style }: RoomThumbProps) {
  const page = BOOK_PAGES[artFlatIndex(room)]
  const palette: [string, string, string] = page?.palette ?? ['#17150f', '#f5f1e6', '#d8ff3e']
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`room-thumb${className ? ` ${className}` : ''}`}
      style={style}
      role="img"
      aria-label={`房间 ${String(room).padStart(2, '0')} ${page?.title ?? ''} 缩略图`}
      preserveAspectRatio="none"
    >
      {motif(room, palette)}
    </svg>
  )
}
