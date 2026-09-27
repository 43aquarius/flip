'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ART_COUNT, artFlatIndex, BOOK_PAGES } from '@/lib/book/pages'
import { useBookStore } from '@/lib/book-store'
import { useIsSpread } from '@/hooks/use-spread'
import { playFlipSound, setRoomTone, syncAmbience } from '@/lib/book/sound'
import { BookFrame } from './BookFrame'
import { Leaf } from './Leaf'
import { PageSurface, PaperBack } from './PageSurface'
import { Hud } from './Hud'
import { HelpOverlay } from './HelpOverlay'
import { BootSplash } from './BootSplash'
import { ResumeToast } from './ResumeToast'
import { BookmarkRibbon } from './BookmarkRibbon'
import { BookEdgeRibbons } from './BookEdgeRibbons'
import { BookmarksPanel } from './BookmarksPanel'
import { StampToast } from './StampToast'
import { PageSealMark } from './PageSealMark'
import { CoverPeel } from './CoverPeel'
import { ClearFlash } from './ClearFlash'

type Motion =
  | { type: 'idle' }
  | { type: 'anim'; leaf: number; dir: 1 | -1; to: number; current: number }
  | { type: 'drag'; leaf: number; dir: 1 | -1; current: number }

const FLIP_MS = 760
const RIFFLE_MS = 300
const RIFFLE_STEP = 95

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

const DEFAULT_TITLE = '《翻》FLIP — 二十个房间 · 实验数字艺术书'

/** 绘制动态 favicon：书页折叠小图标，折叠角使用当前房间强调色 */
function drawFavicon(accent: string | null): void {
  if (typeof document === 'undefined') return
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const c = canvas.getContext('2d')
  if (!c) return
  // 深纸底 + 细边框
  c.fillStyle = '#17150f'
  c.fillRect(0, 0, size, size)
  c.strokeStyle = 'rgba(245,241,230,0.28)'
  c.lineWidth = 3
  c.strokeRect(4, 4, size - 8, size - 8)
  // 折角：右下三角（书页翻折）
  c.fillStyle = accent ?? '#d8ff3e'
  c.beginPath()
  c.moveTo(size - 6, size - 26)
  c.lineTo(size - 26, size - 6)
  c.lineTo(size - 6, size - 6)
  c.closePath()
  c.fill()
  // 翻折后的纸背（亮色小三角）
  c.fillStyle = 'rgba(245,241,230,0.92)'
  c.beginPath()
  c.moveTo(size - 6, size - 26)
  c.lineTo(size - 26, size - 6)
  c.lineTo(size - 26, size - 14)
  c.closePath()
  c.fill()
  const url = canvas.toDataURL('image/png')
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/png'
  link.href = url
}

export default function BookStage() {
  const spread = useIsSpread()
  const [flipped, setFlipped] = useState(0)
  const [motion, setMotion] = useState<Motion>({ type: 'idle' })
  const [riffle, setRiffle] = useState(false)
  const [booted, setBooted] = useState(false)
  /** 用户已主动翻页（用于续读提示的显隐与会话保存的启动） */
  const [userMoved, setUserMoved] = useState(false)
  /** 开书仪式（从封面翻开第一叶时光影扫过 + 书壳呼吸） */
  const [openingFx, setOpeningFx] = useState(false)
  /** 合书仪式（翻回封面时书壳轻沉回弹） */
  const [closingFx, setClosingFx] = useState(false)

  const motionRef = useRef<Motion>({ type: 'idle' })
  const flippedRef = useRef(0)
  const riffleRef = useRef(false)
  const riffleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bookmarks = useBookStore((s) => s.bookmarks)

  const len = BOOK_PAGES.length
  const leafCount = spread ? Math.ceil(len / 2) : len
  const maxFlipped = spread ? leafCount : leafCount - 1

  const applyMotion = useCallback((m: Motion) => {
    motionRef.current = m
    setMotion(m)
  }, [])

  /* 开书 / 合书仪式：flipped 跨越 0 边界时触发（在唯一入口 setFlippedBoth 内驱动） */
  const fxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openingFxRef = useRef(false)
  const triggerOpeningFx = useCallback(() => {
    // flip() 已提前触发时（动画结束 settle 再入）不重启，避免光带扫两次
    if (openingFxRef.current) return
    openingFxRef.current = true
    setOpeningFx(true)
    if (fxTimerRef.current) clearTimeout(fxTimerRef.current)
    fxTimerRef.current = setTimeout(() => {
      openingFxRef.current = false
      setOpeningFx(false)
    }, 1500)
  }, [])
  const setFlippedBoth = useCallback((v: number) => {
    const prev = flippedRef.current
    flippedRef.current = v
    setFlipped(v)
    if (prev === 0 && v > 0) {
      triggerOpeningFx()
    } else if (prev > 0 && v === 0) {
      setClosingFx(true)
      if (fxTimerRef.current) clearTimeout(fxTimerRef.current)
      fxTimerRef.current = setTimeout(() => setClosingFx(false), 1000)
    }
  }, [triggerOpeningFx])

  useEffect(() => {
    return () => {
      if (fxTimerRef.current) clearTimeout(fxTimerRef.current)
    }
  }, [])

  /* ---------- 开机仪式 + 注入持久化状态 ---------- */
  useEffect(() => {
    useBookStore.getState().hydrate()
    const t = setTimeout(() => setBooted(true), 1500)
    return () => clearTimeout(t)
  }, [])

  /* ---------- 环境音：跟随 muted / ambient / 手势解锁 ---------- */
  useEffect(() => {
    syncAmbience()
    const unsub = useBookStore.subscribe(() => syncAmbience())
    const onVis = () => syncAmbience()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  /* ---------- 模式切换（桌面跨页 <-> 移动单页）时重映射进度 ---------- */
  const prevSpread = useRef<boolean | null>(null)
  useEffect(() => {
    const prev = prevSpread.current
    prevSpread.current = spread
    if (spread === null || prev === null || prev === spread) return
    const t = setTimeout(() => {
      applyMotion({ type: 'idle' })
      const f = flippedRef.current
      const next = spread ? Math.min(Math.ceil(f / 2), Math.ceil(len / 2)) : Math.min(f * 2, len - 1)
      setFlippedBoth(next)
    }, 0)
    return () => clearTimeout(t)
  }, [spread, len, applyMotion, setFlippedBoth])

  /* ---------- 落定：提交翻页 ---------- */
  const settle = useCallback(() => {
    const m = motionRef.current
    if (m.type !== 'anim' || m.current !== m.to) return
    if (m.dir === 1 && m.to === 1) setFlippedBoth(flippedRef.current + 1)
    else if (m.dir === -1 && m.to === 0) setFlippedBoth(flippedRef.current - 1)
    applyMotion({ type: 'idle' })
  }, [applyMotion, setFlippedBoth])

  const handleLeafSettled = useCallback(
    (leafIdx: number) => {
      const m = motionRef.current
      if (m.type === 'anim' && m.leaf === leafIdx) settle()
    },
    [settle],
  )

  /* ---------- 兜底定时器：transitionend 丢失时强制落定 ---------- */
  useEffect(() => {
    if (motion.type !== 'anim') return
    const timer = setTimeout(() => {
      const m = motionRef.current
      if (m.type !== 'anim') return
      if (m.current !== m.to) {
        applyMotion({ ...m, current: m.to })
        setTimeout(() => {
          if (motionRef.current.type === 'anim') settle()
        }, 80)
      } else {
        settle()
      }
    }, FLIP_MS + 160)
    return () => clearTimeout(timer)
  }, [motion, settle, applyMotion])

  /* ---------- 单次翻页 ---------- */
  const flip = useCallback(
    (dir: 1 | -1) => {
      if (motionRef.current.type !== 'idle' || riffleRef.current) return
      const f = flippedRef.current
      if (dir === 1 && f >= maxFlipped) return
      if (dir === -1 && f <= 0) return
      setUserMoved(true)
      const leaf = dir === 1 ? f : f - 1
      // 开书仪式：从封面翻开第一叶的瞬间即开始（不等动画结束）
      if (dir === 1 && f === 0) triggerOpeningFx()
      playFlipSound()
      useBookStore.getState().countFlip()
      const to = dir === 1 ? 1 : 0
      applyMotion({ type: 'anim', leaf, dir, to, current: to === 1 ? 0 : 1 })
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const m = motionRef.current
          if (m.type === 'anim' && m.leaf === leaf && m.to === to) {
            applyMotion({ ...m, current: to })
          }
        }),
      )
    },
    [applyMotion, maxFlipped, triggerOpeningFx],
  )

  /* ---------- 跳转（riffle 连翻） ---------- */
  const jumpTo = useCallback(
    (target: number) => {
      if (motionRef.current.type !== 'idle' || riffleRef.current) return
      const t = Math.max(0, Math.min(Math.round(target), maxFlipped))
      const f = flippedRef.current
      if (t === f) return
      setUserMoved(true)
      if (Math.abs(t - f) === 1) {
        flip(t > f ? 1 : -1)
        return
      }
      riffleRef.current = true
      setRiffle(true)
      let cur = f
      let step = 0
      riffleTimerRef.current = setInterval(() => {
        if (cur === t) {
          if (riffleTimerRef.current) clearInterval(riffleTimerRef.current)
          riffleTimerRef.current = null
          riffleRef.current = false
          setRiffle(false)
          return
        }
        cur += Math.sign(t - cur)
        setFlippedBoth(cur)
        useBookStore.getState().countFlip()
        if (step % 2 === 0) playFlipSound(0.35)
        step += 1
      }, RIFFLE_STEP)
    },
    [flip, maxFlipped, setFlippedBoth],
  )

  useEffect(() => {
    return () => {
      if (riffleTimerRef.current) clearInterval(riffleTimerRef.current)
    }
  }, [])

  const jumpToFlat = useCallback(
    (flat: number) => {
      jumpTo(spread ? Math.ceil(flat / 2) : flat)
    },
    [jumpTo, spread],
  )

  const jumpToArt = useCallback(
    (i: number) => {
      jumpToFlat(2 + i)
    },
    [jumpToFlat],
  )

  /* ---------- 书签：标记/取消当前房间 ---------- */
  const toggleBookmarkCurrent = useCallback(() => {
    if (spread === null) return
    const arts: number[] = []
    const flats = spread ? [2 * flippedRef.current - 1, 2 * flippedRef.current] : [flippedRef.current]
    for (const f of flats) {
      const p = BOOK_PAGES[f]
      if (p?.kind === 'art' && p.artIndex) arts.push(p.artIndex)
    }
    if (arts.length === 0) return
    const { bookmarks: marks, toggleBookmark } = useBookStore.getState()
    const anyMarked = arts.some((n) => marks.includes(n))
    for (const n of arts) {
      const isMarked = marks.includes(n)
      if (anyMarked ? isMarked : !isMarked) toggleBookmark(n)
    }
  }, [spread])

  /* ---------- 续读 / 重来 ---------- */
  const resumeFromSaved = useCallback(
    (art: number) => {
      if (art >= 1 && art <= 20) jumpToArt(art)
      else if (art === 21) jumpTo(maxFlipped)
    },
    [jumpToArt, jumpTo, maxFlipped],
  )

  const restartFromCover = useCallback(() => {
    useBookStore.getState().clearSession()
  }, [])

  /* ---------- 会话持久化：位置变化后防抖保存 ---------- */
  useEffect(() => {
    if (!userMoved || spread === null) return
    if (motion.type !== 'idle' || riffle) return
    let art = 0
    if (spread && flipped === leafCount) {
      art = 21
    } else {
      const flats = spread ? [2 * flipped - 1, 2 * flipped] : [flipped]
      for (const f of flats) {
        const p = BOOK_PAGES[f]
        if (p?.kind === 'art' && p.artIndex) {
          art = p.artIndex
          break
        }
      }
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      useBookStore.getState().saveSession(art)
    }, 700)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [flipped, spread, motion.type, riffle, leafCount, userMoved])

  /* ---------- 页面隐藏时立即保存 ---------- */
  useEffect(() => {
    const flush = () => {
      if (!userMoved || spread === null) return
      const flats = spread ? [2 * flippedRef.current - 1, 2 * flippedRef.current] : [flippedRef.current]
      let art = 0
      if (spread && flippedRef.current === leafCount) art = 21
      else {
        for (const f of flats) {
          const p = BOOK_PAGES[f]
          if (p?.kind === 'art' && p.artIndex) {
            art = p.artIndex
            break
          }
        }
      }
      useBookStore.getState().saveSession(art)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [userMoved, spread, leafCount])

  /* ---------- 拖拽翻页（跟手） ---------- */
  const startDrag = useCallback(
    (dir: 1 | -1) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (motionRef.current.type !== 'idle' || riffleRef.current) return
      const f = flippedRef.current
      if (dir === 1 && f >= maxFlipped) return
      if (dir === -1 && f <= 0) return
      const leaf = dir === 1 ? f : f - 1
      if (leaf < 0 || leaf >= leafCount) return

      const startX = e.clientX
      const startY = e.clientY
      const startTime = performance.now()
      const rect = bodyRef.current?.getBoundingClientRect()
      const pageW = rect ? (spread ? rect.width / 2 : rect.width) : 320
      let lastX = startX
      let lastT = startTime
      let vx = 0
      let moved = 0

      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* 忽略 */
      }

      const move = (ev: PointerEvent) => {
        const dxDir = dir === 1 ? startX - ev.clientX : ev.clientX - startX
        moved = Math.max(moved, Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY))
        const now = performance.now()
        const dt = Math.max(1, now - lastT)
        vx = (ev.clientX - lastX) / dt
        lastX = ev.clientX
        lastT = now
        applyMotion({ type: 'drag', leaf, dir, current: clamp01(dxDir / (pageW * 0.72)) })
      }

      const finish = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', cancel)
        const m = motionRef.current
        if (m.type !== 'drag' || m.leaf !== leaf || m.dir !== dir) return
        const dt = performance.now() - startTime
        const fling = dir === 1 ? vx < -0.45 : vx > 0.45
        const tap = moved < 8 && dt < 350
        const go = tap || fling || m.current > 0.33
        const to = go ? (dir === 1 ? 1 : 0) : dir === 1 ? 0 : 1
        if (go) {
          playFlipSound()
          useBookStore.getState().countFlip()
        }
        applyMotion({ type: 'anim', leaf, dir, to, current: m.current })
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const mm = motionRef.current
            if (mm.type === 'anim' && mm.leaf === leaf && mm.to === to) {
              applyMotion({ ...mm, current: to })
            }
          }),
        )
      }

      const cancel = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', cancel)
        const m = motionRef.current
        if (m.type === 'drag' && m.leaf === leaf) {
          const to = dir === 1 ? 0 : 1
          applyMotion({ type: 'anim', leaf, dir, to, current: m.current })
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const mm = motionRef.current
              if (mm.type === 'anim' && mm.leaf === leaf) applyMotion({ ...mm, current: mm.to })
            }),
          )
        }
      }

      window.addEventListener('pointermove', move, { passive: true })
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', cancel)
    },
    [applyMotion, leafCount, maxFlipped, spread],
  )

  /* ---------- 键盘 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        flip(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        flip(-1)
      } else if (e.key === 'Home') {
        jumpTo(0)
      } else if (e.key === 'End') {
        jumpTo(maxFlipped)
      } else if (e.key === 'b' || e.key === 'B') {
        toggleBookmarkCurrent()
      } else if (e.key === 'm' || e.key === 'M') {
        const { marksOpen, setMarksOpen } = useBookStore.getState()
        setMarksOpen(!marksOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip, jumpTo, maxFlipped, toggleBookmarkCurrent])

  /* ---------- 滚轮 ---------- */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    let acc = 0
    let locked = false
    let lockTimer: ReturnType<typeof setTimeout> | null = null
    const onWheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (locked) return
      acc += d
      if (Math.abs(acc) > 68) {
        const dir = acc > 0 ? 1 : -1
        acc = 0
        locked = true
        flip(dir)
        lockTimer = setTimeout(() => {
          locked = false
        }, 780)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (lockTimer) clearTimeout(lockTimer)
    }
  }, [flip])

  /* ---------- 已访问房间记录 ---------- */
  useEffect(() => {
    const flats = spread ? [2 * flipped - 1, 2 * flipped] : [flipped]
    const { markVisited } = useBookStore.getState()
    for (const f of flats) {
      const p = BOOK_PAGES[f]
      if (p?.kind === 'art' && p.artIndex) markVisited(p.artIndex)
    }
  }, [flipped, spread])

  /* ---------- 读毕印章：合上封底时解锁 ---------- */
  const atEnd = spread !== null && (spread ? flipped === leafCount : flipped >= maxFlipped)
  useEffect(() => {
    if (atEnd) useBookStore.getState().unlockFinished()
  }, [atEnd])

  /* ---------- 叶子几何 ---------- */
  const leafDeg = useCallback(
    (k: number) => {
      const m = motion
      if ((m.type === 'anim' || m.type === 'drag') && m.leaf === k) return -180 * m.current
      return k < flipped ? -180 : 0
    },
    [motion, flipped],
  )

  const leafZ = useCallback(
    (k: number) => {
      const m = motion
      if ((m.type === 'anim' || m.type === 'drag') && m.leaf === k) return leafCount + 24
      return k < flipped ? k : leafCount - k
    },
    [motion, flipped, leafCount],
  )

  /* ---------- 渲染范围（性能：只渲染附近叶子） ---------- */
  const leavesToRender = useMemo(() => {
    const arr: number[] = []
    const lo = Math.max(0, flipped - 2)
    const hi = Math.min(leafCount - 1, flipped + 1)
    for (let k = lo; k <= hi; k++) arr.push(k)
    const m = motion
    if ((m.type === 'anim' || m.type === 'drag') && !arr.includes(m.leaf)) arr.push(m.leaf)
    return arr
  }, [flipped, leafCount, motion])

  /* ---------- active 页面集合（riffle 时冻结全部动画） ---------- */
  const activeFlats = useMemo(() => {
    const s = new Set<number>()
    if (riffle) return s
    if (spread) {
      for (let k = Math.max(0, flipped - 1); k <= Math.min(leafCount - 1, flipped + 1); k++) {
        s.add(2 * k)
        s.add(2 * k + 1)
      }
    } else {
      for (let f = Math.max(0, flipped - 1); f <= Math.min(len - 1, flipped + 1); f++) s.add(f)
    }
    return s
  }, [flipped, spread, riffle, leafCount, len])

  /* ---------- HUD 标签 ---------- */
  const hudInfo = useMemo(() => {
    const rightIdx = spread ? 2 * flipped : flipped
    const leftIdx = spread ? 2 * flipped - 1 : flipped - 1
    const rightPage = BOOK_PAGES[rightIdx]
    const leftPage = spread ? BOOK_PAGES[leftIdx] : undefined
    const pad = (n: number) => String(n).padStart(2, '0')

    if (spread && flipped === leafCount) {
      return { main: '读毕 · FIN', sub: '合上了。也是开始。', currentArts: [] as number[] }
    }

    const rightArt = rightPage?.kind === 'art' ? rightPage.artIndex ?? null : null
    const leftArt = leftPage?.kind === 'art' ? leftPage.artIndex ?? null : null

    if (rightArt && leftArt && leftPage && rightPage) {
      return {
        main: `${pad(leftArt)}–${pad(rightArt)}/${ART_COUNT}`,
        sub: `${leftPage.title} × ${rightPage.title}`,
        currentArts: [leftArt, rightArt],
      }
    }
    if (rightArt && rightPage) {
      return {
        main: `${pad(rightArt)}/${ART_COUNT}`,
        sub: `${rightPage.title} · ${rightPage.titleCn}`,
        currentArts: [rightArt],
      }
    }
    if (leftArt && leftPage) {
      return {
        main: `${pad(leftArt)}/${ART_COUNT}`,
        sub: `${leftPage.title} · ${leftPage.titleCn}`,
        currentArts: [leftArt],
      }
    }

    const names: Record<string, string> = {
      cover: '封面 · COVER',
      inside: '扉页 · EX LIBRIS',
      toc: '目次 · INDEX',
      colophon: '版权页 · COLOPHON',
      insideback: '空白 · BLANK',
      back: '封底 · BACK',
      art: '',
    }
    const page = rightPage ?? leftPage ?? BOOK_PAGES[0]
    return {
      main: names[page.kind] ?? '',
      sub: page.hint || page.title,
      currentArts: [] as number[],
    }
  }, [flipped, spread, leafCount])

  /* ---------- 阅读时长：页面可见时累计，隐藏/离开时补记 ---------- */
  useEffect(() => {
    let last = Date.now()
    const tick = () => {
      const now = Date.now()
      const delta = now - last
      last = now
      if (document.visibilityState === 'visible' && delta < 60_000) {
        useBookStore.getState().addReadingMs(delta)
      }
    }
    const timer = setInterval(tick, 5000)
    window.addEventListener('pagehide', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', tick)
    }
  }, [])

  /* ---------- 标签页标题 + 动态 favicon：随当前房间/页面变化 ---------- */
  const lastAccentRef = useRef<string | null>(null)
  useEffect(() => {
    const arts = hudInfo.currentArts
    if (arts.length > 0) {
      const art = arts[arts.length - 1]
      const page = BOOK_PAGES[artFlatIndex(art)]
      const num = arts.length > 1 ? `${String(arts[0]).padStart(2, '0')}–${String(art).padStart(2, '0')}` : String(art).padStart(2, '0')
      document.title = `${num} ${page.title} · ${page.titleCn} — 《翻》FLIP`
      if (page.accent !== lastAccentRef.current) {
        lastAccentRef.current = page.accent
        drawFavicon(page.accent)
      }
    } else if (hudInfo.main === '读毕 · FIN') {
      document.title = `读毕 · FIN — 《翻》FLIP`
      if ('fin' !== lastAccentRef.current) {
        lastAccentRef.current = 'fin'
        drawFavicon('#f5f1e6')
      }
    } else {
      document.title = DEFAULT_TITLE
      if ('default' !== lastAccentRef.current) {
        lastAccentRef.current = 'default'
        drawFavicon('#d8ff3e')
      }
    }
  }, [hudInfo])

  /* ---------- 环境音房间音色：跟随当前房间（右页优先） ---------- */
  useEffect(() => {
    const arts = hudInfo.currentArts
    setRoomTone(arts.length > 0 ? arts[arts.length - 1] : 0)
  }, [hudInfo])

  /* ---------- 渲染 ---------- */
  const collapse = spread
    ? flipped === 0
      ? '-25%'
      : flipped === leafCount
        ? '25%'
        : '0%'
    : '0%'

  const progress = leafCount > 0 ? flipped / leafCount : 0

  const leftRibbonArt = hudInfo.currentArts[0] ?? null
  const rightRibbonArt = hudInfo.currentArts[1] ?? hudInfo.currentArts[0] ?? null

  return (
    <div ref={stageRef} className="flip-stage" role="application" aria-label="《翻》FLIP — 二十个房间，交互数字艺术书">
      {/* 印章毛边滤镜（文档级，一次定义多处引用） */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
        <defs>
          <filter id="seal-rough" x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.8" />
          </filter>
        </defs>
      </svg>
      <div className="desk-grain" aria-hidden />
      <div className="desk-vignette" aria-hidden />

      <header className="stage-brand">
        <span className="stage-brand__mark">《翻》FLIP</span>
        <span className="stage-brand__sub">An experimental book · Z.AI PRESS · MMXXV</span>
      </header>

      {spread !== null && (
        <div className="book-viewport">
          <div
            className={`book-shell${spread ? '' : ' book-shell--single'}${openingFx ? ' book-shell--opening' : ''}${closingFx ? ' book-shell--closing' : ''}`}
            style={{ '--collapse': collapse } as CSSProperties}
          >
            <BookFrame
              spread={spread}
              progress={progress}
              spineStart={flipped === 0}
              spineEnd={spread && flipped === leafCount}
            >
              <div
                ref={bodyRef}
                className={`book-body${flipped === 0 ? ' book-body--closed' : ''}`}
              >
                {/* 封面预掀角（合上时指针趋近右下角 → 页角掀起） */}
                <CoverPeel
                  active={flipped === 0 && motion.type === 'idle' && !riffle && booted}
                />
                {/* 书脊边缘书签簇（所有书签按实际位置露出顶边；单页模式聚拢到书脊侧） */}
                <BookEdgeRibbons
                  bookmarks={bookmarks}
                  currentArts={hudInfo.currentArts}
                  open={flipped > 0}
                  collapsed={spread ? flipped === leafCount : false}
                  single={!spread}
                  onJump={jumpToArt}
                />
                {/* 当前房间大丝带（标记后插入；移动单页只显示右侧一枚） */}
                {spread ? (
                  <>
                    <BookmarkRibbon
                      artIndex={leftRibbonArt}
                      marked={leftRibbonArt != null && bookmarks.includes(leftRibbonArt)}
                      side="left"
                    />
                    <BookmarkRibbon
                      artIndex={rightRibbonArt}
                      marked={rightRibbonArt != null && bookmarks.includes(rightRibbonArt)}
                      side="right"
                    />
                  </>
                ) : (
                  <BookmarkRibbon
                    artIndex={leftRibbonArt}
                    marked={leftRibbonArt != null && bookmarks.includes(leftRibbonArt)}
                    side="right"
                  />
                )}
                {leavesToRender.map((k) => {
                  const m = motion
                  const isMotionLeaf =
                    (m.type === 'anim' || m.type === 'drag') && m.leaf === k
                  const castShadow =
                    m.type !== 'idle' && !isMotionLeaf && (k === flipped || k === flipped - 1)
                      ? Math.sin(Math.PI * m.current)
                      : 0
                  const front = spread ? (
                    <PageSurface
                      page={BOOK_PAGES[2 * k]}
                      side="right"
                      active={activeFlats.has(2 * k)}
                      onOpenCover={() => flip(1)}
                      onBackCover={() => flip(-1)}
                      onJumpToArt={jumpToArt}
                      onJumpToFlat={jumpToFlat}
                    />
                  ) : (
                    <PageSurface
                      page={BOOK_PAGES[k]}
                      side="single"
                      active={activeFlats.has(k)}
                      onOpenCover={() => flip(1)}
                      onBackCover={() => flip(-1)}
                      onJumpToArt={jumpToArt}
                      onJumpToFlat={jumpToFlat}
                    />
                  )
                  const backPage = spread ? BOOK_PAGES[2 * k + 1] : undefined
                  const back = backPage ? (
                    <PageSurface
                      page={backPage}
                      side="left"
                      active={activeFlats.has(2 * k + 1)}
                      onOpenCover={() => flip(1)}
                      onBackCover={() => flip(-1)}
                      onJumpToArt={jumpToArt}
                      onJumpToFlat={jumpToFlat}
                    />
                  ) : (
                    <PaperBack />
                  )
                  return (
                    <Leaf
                      key={k}
                      deg={leafDeg(k)}
                      animating={isMotionLeaf ? m.type === 'anim' : true}
                      duration={riffle ? RIFFLE_MS : FLIP_MS}
                      zIndex={leafZ(k)}
                      single={!spread}
                      castShadow={castShadow}
                      front={front}
                      back={back}
                      onSettled={() => handleLeafSettled(k)}
                    />
                  )
                })}

                {/* 开书光影扫过（从书脊向页边） */}
                {openingFx && <div className="open-sweep" aria-hidden />}

                {/* 页面钤印：印章解锁时落在当前页上，随页留存 */}
                <PageSealMark pageKey={`${spread ? 's' : 'm'}-${flipped}`} spread={spread === true} />

                {/* 通关闪印：房间达成挑战的瞬间，大「通」印砸在当前页 */}
                <ClearFlash currentArts={hudInfo.currentArts} spread={spread === true} />

                {/* 翻页热区 */}
                {flipped < maxFlipped && (
                  <>
                    <div
                      className="flip-zone fz-right-edge"
                      onPointerDown={startDrag(1)}
                      role="button"
                      aria-label="向前翻页"
                    >
                      <div className="peel peel--rb" aria-hidden />
                    </div>
                    <div
                      className="flip-zone fz-right-corner-b"
                      onPointerDown={startDrag(1)}
                      role="button"
                      aria-label="向前翻页"
                    >
                      <div className="peel peel--rb" aria-hidden />
                    </div>
                    <div
                      className="flip-zone fz-right-corner-t"
                      onPointerDown={startDrag(1)}
                      role="button"
                      aria-label="向前翻页"
                    />
                  </>
                )}
                {flipped > 0 && (
                  <>
                    <div
                      className="flip-zone fz-left-edge"
                      onPointerDown={startDrag(-1)}
                      role="button"
                      aria-label="向后翻页"
                    >
                      <div className="peel peel--lb" aria-hidden />
                    </div>
                    <div
                      className="flip-zone fz-left-corner-b"
                      onPointerDown={startDrag(-1)}
                      role="button"
                      aria-label="向后翻页"
                    >
                      <div className="peel peel--lb" aria-hidden />
                    </div>
                    <div
                      className="flip-zone fz-left-corner-t"
                      onPointerDown={startDrag(-1)}
                      role="button"
                      aria-label="向后翻页"
                    />
                  </>
                )}
              </div>
            </BookFrame>
          </div>
        </div>
      )}

      <Hud
        canPrev={flipped > 0 && !riffle}
        canNext={flipped < maxFlipped && !riffle}
        labelMain={hudInfo.main}
        labelSub={hudInfo.sub}
        currentArts={hudInfo.currentArts}
        progress={progress}
        atEnd={atEnd}
        atStart={flipped === 0}
        onPrev={() => flip(-1)}
        onNext={() => flip(1)}
        onToc={() => jumpTo(spread ? 1 : 2)}
        onToggleBookmark={toggleBookmarkCurrent}
        onJumpToArt={jumpToArt}
      />

      <ResumeToast
        booted={booted}
        userHasMoved={userMoved}
        onContinue={() => resumeFromSaved(useBookStore.getState().lastArt)}
        onRestart={restartFromCover}
      />

      <HelpOverlay onBackToCover={() => jumpTo(0)} />
      <BookmarksPanel onJumpToArt={jumpToArt} />
      <StampToast />
      <BootSplash visible={!booted} />
    </div>
  )
}
