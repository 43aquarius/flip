import { create } from 'zustand'
import { STAMPS, validStampIds } from '@/lib/book/stamps'
import type { StampDef, StampState } from '@/lib/book/stamps'

const STORAGE_KEY = 'flip:book:v1'

/** 会话节奏日志最多保留的会话数 */
const SESSION_LOG_MAX = 24

/** 持久化的会话状态（写入 localStorage） */
interface PersistedState {
  muted: boolean
  /** 环境音（纸面底噪）开关 */
  ambient: boolean
  visited: number[]
  /** 书签：被标记的房间号（1..20） */
  bookmarks: number[]
  /** 上次阅读位置（艺术页编号 1..20，0 表示封面合上态、21 表示读毕） */
  lastArt: number
  /** 上次保存时间戳 */
  savedAt: number
  /** 上次访问累计的会话数 */
  sessions: number
  /** 累计阅读时长（毫秒，仅页面可见时累计） */
  readingMs: number
  /** 累计翻页次数（每翻动一张叶子计 1，riffle 按步计） */
  flips: number
  /** 已入谱印章 id */
  stamps: string[]
  /** 是否到达过读毕态（合上封底） */
  finished: boolean
  /** 是否曾在凌晨 0–5 点翻书 */
  nightTouched: boolean
  /** 已通关的挑战房间（可通关房间号，当前为 6/7/15/18/20） */
  cleared: number[]
  /** 每次翻开本书各翻动了几页（最近 N 次会话，末位为当前会话） */
  sessionLog: number[]
}

interface BookStore extends PersistedState {
  /** 是否已从 localStorage 注入持久化状态（避免 SSR 水合不一致） */
  hydrated: boolean
  hydrate: () => void
  /** 帮助浮层 */
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  /** 书签管理面板 */
  marksOpen: boolean
  setMarksOpen: (open: boolean) => void
  /** 待盖章展示的印章队列（不持久化） */
  pendingStamps: StampDef[]
  /** 消费队首印章（toast 展示完毕后调用） */
  dismissPendingStamp: () => void
  /** 待展示通关闪印的房间（不持久化，通关瞬间由房间内调用 clearRoom 写入） */
  pendingClear: { room: number; at: number } | null
  /** 消费通关闪印（ClearFlash 展示完毕后调用） */
  consumeClearFlash: () => void
  toggleMute: () => void
  toggleAmbient: () => void
  markVisited: (i: number) => void
  resetVisited: () => void
  toggleBookmark: (i: number) => void
  clearBookmarks: () => void
  saveSession: (art: number) => void
  clearSession: () => void
  addReadingMs: (ms: number) => void
  countFlip: (n?: number) => void
  /** 读毕态解锁（BookStage 在合上封底时调用） */
  unlockFinished: () => void
  /** 房间挑战通关（由各艺术房间在达成条件时调用，幂等） */
  clearRoom: (i: number) => void
}

const emptyPersist: PersistedState = {
  muted: false,
  ambient: true,
  visited: [],
  bookmarks: [],
  lastArt: 0,
  savedAt: 0,
  sessions: 0,
  readingMs: 0,
  flips: 0,
  stamps: [],
  finished: false,
  nightTouched: false,
  cleared: [],
  sessionLog: [],
}

const validArt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 20

/** 从 localStorage 读取持久化状态（仅客户端） */
function loadPersisted(): { state: PersistedState; hadStampsField: boolean } {
  if (typeof window === 'undefined') return { state: emptyPersist, hadStampsField: false }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { state: emptyPersist, hadStampsField: false }
    const p = JSON.parse(raw) as Partial<PersistedState>
    return {
      state: {
        muted: Boolean(p.muted),
        ambient: p.ambient === undefined ? true : Boolean(p.ambient),
        visited: Array.isArray(p.visited) ? p.visited.filter(validArt) : [],
        bookmarks: Array.isArray(p.bookmarks) ? p.bookmarks.filter(validArt) : [],
        lastArt: Number.isInteger(p.lastArt) && p.lastArt! >= 0 && p.lastArt! <= 21 ? p.lastArt! : 0,
        savedAt: Number.isFinite(p.savedAt) ? p.savedAt! : 0,
        sessions: Number.isInteger(p.sessions) ? p.sessions! : 0,
        readingMs: Number.isFinite(p.readingMs) && p.readingMs! >= 0 ? Math.min(p.readingMs!, 3.15e10) : 0,
        flips: Number.isInteger(p.flips) && p.flips! >= 0 ? Math.min(p.flips!, 1e6) : 0,
        stamps: validStampIds(p.stamps),
        finished: Boolean(p.finished),
        nightTouched: Boolean(p.nightTouched),
        cleared: Array.isArray(p.cleared) ? p.cleared.filter(validArt) : [],
        sessionLog: validSessionLog(p.sessionLog),
      },
      hadStampsField: Array.isArray(p.stamps),
    }
  } catch {
    return { state: emptyPersist, hadStampsField: false }
  }
}

function savePersisted(s: PersistedState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        muted: s.muted,
        ambient: s.ambient,
        visited: s.visited,
        bookmarks: s.bookmarks,
        lastArt: s.lastArt,
        savedAt: s.savedAt,
        sessions: s.sessions,
        readingMs: s.readingMs,
        flips: s.flips,
        stamps: s.stamps,
        finished: s.finished,
        nightTouched: s.nightTouched,
        cleared: s.cleared,
        sessionLog: s.sessionLog,
      }),
    )
  } catch {
    /* 配额 / 隐私模式：忽略 */
  }
}

/** 从当前 store 状态抽取持久化切片并写盘 */
function persist(get: () => BookStore, patch: Partial<PersistedState>) {
  const s = get()
  savePersisted({
    muted: s.muted,
    ambient: s.ambient,
    visited: s.visited,
    bookmarks: s.bookmarks,
    lastArt: s.lastArt,
    savedAt: s.savedAt,
    sessions: s.sessions,
    readingMs: s.readingMs,
    flips: s.flips,
    stamps: s.stamps,
    finished: s.finished,
    nightTouched: s.nightTouched,
    cleared: s.cleared,
    sessionLog: s.sessionLog,
    ...patch,
  })
}

/** 校验会话节奏日志（读 localStorage 防污染） */
function validSessionLog(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is number => Number.isFinite(x) && x >= 0 && x <= 1e6)
    .slice(-SESSION_LOG_MAX)
}

/** 从 store 当前统计快照构造印章判定状态 */
function stampStateOf(get: () => BookStore): StampState {
  const s = get()
  return {
    flips: s.flips,
    visitedCount: s.visited.length,
    bookmarksCount: s.bookmarks.length,
    readingMs: s.readingMs,
    sessions: s.sessions,
    finished: s.finished,
    nightTouched: s.nightTouched,
    clearedCount: s.cleared.length,
  }
}

/**
 * 结算印章：test 通过且未入谱者解锁。
 * silent=true 时静默入谱（升级老数据），否则推入待盖章队列。
 */
function evaluateStamps(
  set: (p: Partial<BookStore>) => void,
  get: () => BookStore,
  silent = false,
) {
  const s = get()
  const snap = stampStateOf(get)
  const fresh: StampDef[] = STAMPS.filter((st) => !s.stamps.includes(st.id) && st.test(snap))
  if (fresh.length === 0) return
  const stamps = [...s.stamps, ...fresh.map((f) => f.id)]
  persist(get, { stamps })
  if (silent) {
    set({ stamps })
  } else {
    set({ stamps, pendingStamps: [...s.pendingStamps, ...fresh] })
  }
}

const initial = emptyPersist

/** 本次页面加载是否已计入会话数（每次访问只计一次） */
let sessionCounted = false

/** 本次页面加载是否已在节奏日志中开新档（首次翻页 / 首次保存时） */
let logOpened = false

export const useBookStore = create<BookStore>((set, get) => ({
  ...initial,
  hydrated: false,
  /** 挂载后注入 localStorage 状态（避免 SSR 水合不一致） */
  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return
    const { state: p, hadStampsField } = loadPersisted()
    if (hadStampsField) {
      set({ ...p, hydrated: true })
    } else {
      // 旧版本数据（无印章字段）：把已达成的印章静默入谱，不弹提示
      set({ ...p, hydrated: true })
      evaluateStamps(set, get, true)
    }
  },
  helpOpen: false,
  setHelpOpen: (open) => set({ helpOpen: open }),
  marksOpen: false,
  setMarksOpen: (open) => set({ marksOpen: open }),
  pendingStamps: [],
  dismissPendingStamp: () => {
    const rest = get().pendingStamps.slice(1)
    set({ pendingStamps: rest })
  },
  pendingClear: null,
  consumeClearFlash: () => {
    if (get().pendingClear) set({ pendingClear: null })
  },
  toggleMute: () => {
    const muted = !get().muted
    persist(get, { muted })
    set({ muted })
  },
  toggleAmbient: () => {
    const ambient = !get().ambient
    persist(get, { ambient })
    set({ ambient })
  },
  markVisited: (i) => {
    const s = get()
    if (s.visited.includes(i)) return
    const visited = [...s.visited, i]
    persist(get, { visited })
    set({ visited })
    evaluateStamps(set, get)
  },
  resetVisited: () => {
    persist(get, { visited: [] })
    set({ visited: [] })
  },
  toggleBookmark: (i) => {
    const s = get()
    const bookmarks = s.bookmarks.includes(i)
      ? s.bookmarks.filter((n) => n !== i)
      : [...s.bookmarks, i].sort((a, b) => a - b)
    persist(get, { bookmarks })
    set({ bookmarks })
    evaluateStamps(set, get)
  },
  clearBookmarks: () => {
    persist(get, { bookmarks: [] })
    set({ bookmarks: [] })
  },
  saveSession: (art) => {
    const now = Date.now()
    const s = get()
    const sessions = sessionCounted ? s.sessions : s.sessions + 1
    sessionCounted = true
    // 节奏日志：本次会话尚未开档则补一行（纯阅读不翻页也会留下记号）
    const sessionLog = logOpened ? s.sessionLog : [...s.sessionLog, 0].slice(-SESSION_LOG_MAX)
    logOpened = true
    persist(get, { lastArt: art, savedAt: now, sessions, sessionLog })
    set({ lastArt: art, savedAt: now, sessions, sessionLog })
    evaluateStamps(set, get)
  },
  clearSession: () => {
    persist(get, { lastArt: 0, savedAt: 0 })
    set({ lastArt: 0, savedAt: 0 })
  },
  addReadingMs: (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return
    const readingMs = get().readingMs + ms
    persist(get, { readingMs })
    set({ readingMs })
    evaluateStamps(set, get)
  },
  countFlip: (n = 1) => {
    if (!Number.isFinite(n) || n <= 0) return
    const s = get()
    const flips = s.flips + Math.round(n)
    // 夜读者：凌晨 0–5 点翻过书即达成
    const h = new Date().getHours()
    const nightTouched = s.nightTouched || (h >= 0 && h < 5)
    // 节奏日志：首次翻页开新档，随后计入末行
    let sessionLog = s.sessionLog
    if (!logOpened) {
      sessionLog = [...sessionLog, 0].slice(-SESSION_LOG_MAX)
      logOpened = true
    }
    const last = sessionLog.length ? sessionLog[sessionLog.length - 1] + Math.round(n) : Math.round(n)
    sessionLog = [...sessionLog.slice(0, -1), Math.min(1e6, last)]
    persist(get, { flips, nightTouched, sessionLog })
    set({ flips, nightTouched, sessionLog })
    evaluateStamps(set, get)
  },
  unlockFinished: () => {
    if (get().finished) return
    persist(get, { finished: true })
    set({ finished: true })
    evaluateStamps(set, get)
  },
  clearRoom: (i) => {
    const s = get()
    if (s.cleared.includes(i)) return
    const cleared = [...s.cleared, i].sort((a, b) => a - b)
    persist(get, { cleared })
    set({ cleared, pendingClear: { room: i, at: Date.now() } })
    evaluateStamps(set, get)
  },
}))
