/**
 * 印谱 —— 印章收集成就系统
 *
 * 读者在翻阅过程中以行为「解锁」朱红印章（开卷 / 半百 / 夜读者……），
 * 解锁瞬间右下角盖章提示，全部印章陈列于版权页印谱。
 * 印章一经入谱永久保留（清书签 / 清进度不影响）。
 *
 * 可量化条件附带 progress（ratio + 文本），未解锁印章在印谱中
 * 显示进度细条，读者能看见「离下一枚印还有多远」。
 */

export interface StampState {
  /** 累计翻页数 */
  flips: number
  /** 已探索房间数 */
  visitedCount: number
  /** 当前书签数 */
  bookmarksCount: number
  /** 累计阅读毫秒 */
  readingMs: number
  /** 累计翻开本书次数 */
  sessions: number
  /** 是否到达过读毕态（合上封底） */
  finished: boolean
  /** 是否曾在凌晨 0–5 点翻书 */
  nightTouched: boolean
  /** 已通关的挑战房间数（可通关房间共 5 间） */
  clearedCount: number
}

/** 印章进度：ratio ∈ [0,1]，text 为印谱展示文本（如 "46/50"） */
export interface StampProgress {
  ratio: number
  text: string
}

export interface StampDef {
  /** 唯一 id（持久化用） */
  id: string
  /** 印面单字（篆刻印文） */
  glyph: string
  /** 中文名 */
  name: string
  /** 英文名 */
  en: string
  /** 解锁条件描述（印谱悬浮提示 / 盖章 toast 副文） */
  desc: string
  /** 解锁判定 */
  test: (s: StampState) => boolean
  /** 进度（可量化条件；二值条件缺省为无进度） */
  progress?: (s: StampState) => StampProgress | null
}

/** 分母约定的进度工厂 */
function ratioOf(cur: number, max: number, fmt: (c: number, m: number) => string): StampProgress {
  return { ratio: Math.max(0, Math.min(1, cur / max)), text: fmt(Math.min(cur, max), max) }
}

/** 分钟数友好格式（印章进度用） */
function shortMin(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return m >= 60 ? `${(m / 60).toFixed(1)} 时` : `${m} 分`
}

export const STAMPS: StampDef[] = [
  {
    id: 'open',
    glyph: '开',
    name: '开卷',
    en: 'FIRST FLIP',
    desc: '翻动了第一页',
    test: (s) => s.flips >= 1,
    progress: (s) => ratioOf(s.flips, 1, (c, m) => `${c}/${m}`),
  },
  {
    id: 'half',
    glyph: '半',
    name: '半百',
    en: 'FIFTY FLIPS',
    desc: '累计翻页五十次',
    test: (s) => s.flips >= 50,
    progress: (s) => ratioOf(s.flips, 50, (c, m) => `${c}/${m}`),
  },
  {
    id: 'pages',
    glyph: '页',
    name: '二百页',
    en: 'TWO HUNDRED',
    desc: '累计翻页二百次',
    test: (s) => s.flips >= 200,
    progress: (s) => ratioOf(s.flips, 200, (c, m) => `${c}/${m}`),
  },
  {
    id: 'wanderer',
    glyph: '串',
    name: '串门',
    en: 'WANDERER',
    desc: '探索了五个房间',
    test: (s) => s.visitedCount >= 5,
    progress: (s) => ratioOf(s.visitedCount, 5, (c, m) => `${c}/${m} 间`),
  },
  {
    id: 'every-room',
    glyph: '遍',
    name: '全踏遍',
    en: 'EVERY ROOM',
    desc: '踏遍全部二十个房间',
    test: (s) => s.visitedCount >= 20,
    progress: (s) => ratioOf(s.visitedCount, 20, (c, m) => `${c}/${m} 间`),
  },
  {
    id: 'ribbon',
    glyph: '签',
    name: '插签',
    en: 'RIBBON',
    desc: '插下了第一枚书签',
    test: (s) => s.bookmarksCount >= 1,
    progress: (s) => ratioOf(s.bookmarksCount, 1, (c, m) => `${c}/${m}`),
  },
  {
    id: 'archivist',
    glyph: '藏',
    name: '藏签家',
    en: 'ARCHIVIST',
    desc: '同时保有五枚书签',
    test: (s) => s.bookmarksCount >= 5,
    progress: (s) => ratioOf(s.bookmarksCount, 5, (c, m) => `${c}/${m}`),
  },
  {
    id: 'stillness',
    glyph: '静',
    name: '静观',
    en: 'STILLNESS',
    desc: '与书共处十分钟',
    test: (s) => s.readingMs >= 10 * 60_000,
    progress: (s) => ratioOf(s.readingMs, 10 * 60_000, (c) => `${shortMin(c)}/10 分`),
  },
  {
    id: 'long-read',
    glyph: '久',
    name: '久读',
    en: 'LONG READER',
    desc: '与书共处一小时',
    test: (s) => s.readingMs >= 60 * 60_000,
    progress: (s) => ratioOf(s.readingMs, 60 * 60_000, (c) => `${shortMin(c)}/60 分`),
  },
  {
    id: 'friend',
    glyph: '友',
    name: '老朋友',
    en: 'OLD FRIEND',
    desc: '第五次翻开这本书',
    test: (s) => s.sessions >= 5,
    progress: (s) => ratioOf(s.sessions, 5, (c, m) => `${c}/${m} 次`),
  },
  {
    id: 'fin',
    glyph: '毕',
    name: '读毕',
    en: 'FIN',
    desc: '翻到封底，合上了书',
    test: (s) => s.finished,
  },
  {
    id: 'night-owl',
    glyph: '夜',
    name: '夜读者',
    en: 'NIGHT OWL',
    desc: '在凌晨零点至五点间翻书',
    test: (s) => s.nightTouched,
  },
  {
    id: 'first-clear',
    glyph: '破',
    name: '破关',
    en: 'FIRST CLEAR',
    desc: '在一间可挑战的房间里达成通关',
    test: (s) => s.clearedCount >= 1,
    progress: (s) => ratioOf(s.clearedCount, 1, (c, m) => `${c}/${m} 关`),
  },
  {
    id: 'all-clear',
    glyph: '通',
    name: '全通关',
    en: 'ROOM CLEAR',
    desc: '五间可挑战房间全部通关（引力剧场 / 生命 / 躲避线 / 色觉 / 白）',
    test: (s) => s.clearedCount >= 5,
    progress: (s) => ratioOf(s.clearedCount, 5, (c, m) => `${c}/${m} 关`),
  },
]

export const STAMP_COUNT = STAMPS.length

const VALID_IDS = new Set(STAMPS.map((s) => s.id))

/** 过滤出合法的印章 id（读 localStorage 防污染） */
export function validStampIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && VALID_IDS.has(x))
}

/** 按 id 取印章定义 */
export function stampById(id: string): StampDef | undefined {
  return STAMPS.find((s) => s.id === id)
}
