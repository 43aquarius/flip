import type { ComponentType } from 'react'
import type { ArtPageProps } from '@/components/art/types'
import Art01 from '@/components/art/art-01'
import Art02 from '@/components/art/art-02'
import Art03 from '@/components/art/art-03'
import Art04 from '@/components/art/art-04'
import Art05 from '@/components/art/art-05'
import Art06 from '@/components/art/art-06'
import Art07 from '@/components/art/art-07'
import Art08 from '@/components/art/art-08'
import Art09 from '@/components/art/art-09'
import Art10 from '@/components/art/art-10'
import Art11 from '@/components/art/art-11'
import Art12 from '@/components/art/art-12'
import Art13 from '@/components/art/art-13'
import Art14 from '@/components/art/art-14'
import Art15 from '@/components/art/art-15'
import Art16 from '@/components/art/art-16'
import Art17 from '@/components/art/art-17'
import Art18 from '@/components/art/art-18'
import Art19 from '@/components/art/art-19'
import Art20 from '@/components/art/art-20'

export type PageKind = 'cover' | 'inside' | 'toc' | 'art' | 'colophon' | 'insideback' | 'back'

export interface BookPage {
  id: string
  kind: PageKind
  /** 艺术页编号 1..20 */
  artIndex?: number
  title: string
  titleCn: string
  hint: string
  /** 目录色卡 / 徽章色 */
  accent: string
  /** 房间调色板三色（色票硬边分段用） */
  palette?: [string, string, string]
}

/**
 * 全书扁平表面数组（单一事实来源）：
 * 桌面跨页模式 —— leaf k = { front: P[2k], back: P[2k+1] }
 * 移动单页模式 —— leaf k = { front: P[k], back: 纸背 }
 */
export const BOOK_PAGES: BookPage[] = [
  { id: 'cover', kind: 'cover', title: 'FLIP', titleCn: '翻', hint: '点击翻开', accent: '#d8ff3e' },
  { id: 'inside', kind: 'inside', title: 'EX LIBRIS', titleCn: '扉页', hint: '', accent: '#b5482e' },
  { id: 'toc', kind: 'toc', title: 'INDEX', titleCn: '目次', hint: '点击条目快速跳转', accent: '#17150f' },

  { id: 'art-01', kind: 'art', artIndex: 1, title: 'GENESIS', titleCn: '尘之场', hint: '移动指针 · 扰动尘埃', accent: '#d9c88f', palette: ['#0a0908', '#d9c88f', '#6b5a2e'] },
  { id: 'art-02', kind: 'art', artIndex: 2, title: 'TYPE RIOT', titleCn: '字暴', hint: '移动 / 点击 · 击散文字', accent: '#e8ff2a', palette: ['#e8ff2a', '#141414', '#f5f1e6'] },
  { id: 'art-03', kind: 'art', artIndex: 3, title: 'INK', titleCn: '墨池', hint: '搅动墨海 · 点击墨爆 · 按住泉眼', accent: '#c0392b', palette: ['#f5f1e6', '#17150f', '#c0392b'] },
  { id: 'art-04', kind: 'art', artIndex: 4, title: 'GLITCH GARDEN', titleCn: '故障花园', hint: '点击栽种 · 按住腐蚀', accent: '#ff2ea6', palette: ['#ff2ea6', '#39ff6e', '#101010'] },
  { id: 'art-05', kind: 'art', artIndex: 5, title: 'MOIRÉ', titleCn: '干涉', hint: '拖动/甩动圆盘 · 点击换纹样', accent: '#111111', palette: ['#111111', '#f5f1e6', '#8a8272'] },
  { id: 'art-06', kind: 'art', artIndex: 6, title: 'ORBIT', titleCn: '引力剧场', hint: '拖拽发射 ×3 · 可通关', accent: '#ff9f1c', palette: ['#0c0a09', '#ff9f1c', '#f5e8d0'] },
  { id: 'art-07', kind: 'art', artIndex: 7, title: 'LIFE', titleCn: '生命游戏', hint: '看全四种图案 · 可通关', accent: '#2b2b2b', palette: ['#efe9db', '#232323', '#e03131'] },
  { id: 'art-08', kind: 'art', artIndex: 8, title: 'THE WELL', titleCn: '井', hint: '按住疾坠 · 轻点冲击波', accent: '#ff2e88', palette: ['#0a0206', '#ff2e88', '#ffb3d1'] },
  { id: 'art-09', kind: 'art', artIndex: 9, title: 'SOUND POND', titleCn: '声之池', hint: '点击水面 · 声音涟漪', accent: '#57ff9a', palette: ['#051008', '#57ff9a', '#0e2a1a'] },
  { id: 'art-10', kind: 'art', artIndex: 10, title: 'FLOCK', titleCn: '群鸟', hint: '移动指针 · 扰动鸟群', accent: '#ff3b30', palette: ['#f2efe9', '#131313', '#ff3b30'] },
  { id: 'art-11', kind: 'art', artIndex: 11, title: 'TERMINAL', titleCn: '终端之环', hint: '拖动旋转 · 移动光源 · 点击换形态', accent: '#33ff66', palette: ['#04120a', '#33ff66', '#0d2818'] },
  { id: 'art-12', kind: 'art', artIndex: 12, title: 'FERROFLUID', titleCn: '磁流', hint: '指针即磁体 · 按住聚峰 · 点击滴溅', accent: '#c8ff3d', palette: ['#0e0d10', '#efeae0', '#c8ff3d'] },
  { id: 'art-13', kind: 'art', artIndex: 13, title: 'MANDELBROT', titleCn: '无限海岸', hint: '点击缩放 · 拖拽平移', accent: '#ff6b1a', palette: ['#0d0906', '#ff6b1a', '#f5f1e6'] },
  { id: 'art-14', kind: 'art', artIndex: 14, title: 'BLOOM', titleCn: '开花', hint: '点击 · 四季轮回 — 长按重植', accent: '#e0455a', palette: ['#f5f1e6', '#1c1a16', '#e0455a'] },
  { id: 'art-15', kind: 'art', artIndex: 15, title: 'DODGE LINE', titleCn: '躲避线', hint: '疾驰躲避 · 得分 15 · 可通关', accent: '#3dff6e', palette: ['#02120a', '#3dff6e', '#0a3a1e'] },
  { id: 'art-16', kind: 'art', artIndex: 16, title: 'PHOSPHENE', titleCn: '磷光', hint: '按住 · 闭眼之光 — 移动 · 牵引视像', accent: '#ffb03a', palette: ['#060409', '#ffb03a', '#8a6cff'] },
  { id: 'art-17', kind: 'art', artIndex: 17, title: 'VERTIGO', titleCn: '眩晕文字', hint: '移动 · 潜入字涡 — 点击 · 冲击波 — 按住 · 引力井', accent: '#f2ff1f', palette: ['#0c0c08', '#f2ff1f', '#191913'] },
  { id: 'art-18', kind: 'art', artIndex: 18, title: 'CHROMA', titleCn: '色觉', hint: '连过十关 · 可通关', accent: '#ff5c00', palette: ['#ff5c00', '#ffd23f', '#0f7f8f'] },
  { id: 'art-19', kind: 'art', artIndex: 19, title: 'VOICEPRINT', titleCn: '声纹', hint: '移动指针 · 演奏声纹', accent: '#ffd23f', palette: ['#0a0806', '#ffb646', '#ffd23f'] },
  { id: 'art-20', kind: 'art', artIndex: 20, title: 'WHITE', titleCn: '白', hint: '点击两次 · 可通关', accent: '#ffffff', palette: ['#ffffff', '#111111', '#d9d2c0'] },

  { id: 'colophon', kind: 'colophon', title: 'COLOPHON', titleCn: '版权页', hint: '', accent: '#8a8272' },
  { id: 'insideback', kind: 'insideback', title: 'HONEST BLANK', titleCn: '诚实的空白', hint: '', accent: '#d9d2c0' },
  { id: 'back', kind: 'back', title: 'FLIP', titleCn: '封底', hint: '点击回翻', accent: '#d8ff3e' },
]

export const ART_COUNT = 20

/** 可通关（有明确挑战目标）的房间及其挑战描述 */
export const CLEARABLE_ROOMS: ReadonlyMap<number, string> = new Map([
  [6, '发射三颗行星'],
  [7, '看全四种图案'],
  [15, '得分达到 15'],
  [18, '连过十关'],
  [20, '拼出「完」'],
])

export const ART_COMPONENTS: Record<number, ComponentType<ArtPageProps>> = {
  1: Art01,
  2: Art02,
  3: Art03,
  4: Art04,
  5: Art05,
  6: Art06,
  7: Art07,
  8: Art08,
  9: Art09,
  10: Art10,
  11: Art11,
  12: Art12,
  13: Art13,
  14: Art14,
  15: Art15,
  16: Art16,
  17: Art17,
  18: Art18,
  19: Art19,
  20: Art20,
}

/** 艺术页 i (1..20) 的扁平索引 */
export function artFlatIndex(i: number): number {
  return 2 + i
}
