'use client'

/**
 * ROOM 07 · LIFE 生命游戏
 * 康威生命游戏 · 纸面细胞剧场。米白纸底上，细胞以黑方块生灭：
 * 新生细胞短暂闪红、死亡细胞留下迅速消退的浅灰残影。
 * 交互：网格上拖动 = 手绘播种；下方按钮条控制 暂停/随机/清空/速度/图案。
 * 图案库：滑翔机枪（Gosper gun）/ 脉冲星 / R-pentomino / 高斯帕（双枪对峙）。
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/* ---------------- 调色与常量 ---------------- */
const PAPER = '#f4f1ea'
const INK = '#232323'
const RED = '#e03131'
const FLASH_MS = 480 // 新生细胞红闪时长
const GHOST_MS = 420 // 死亡残影时长
const BASE_GENS = 6 // ×1 速度：每秒世代数

type Cell = readonly [number, number]

/** 高斯帕滑翔机枪（36 格） */
const GUN: readonly Cell[] = [
  [24, 0],
  [22, 1], [24, 1],
  [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
  [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
  [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
  [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
  [10, 6], [16, 6], [24, 6],
  [11, 7], [15, 7],
  [12, 8], [13, 8],
]

/** 脉冲星（48 格，周期 3） */
const PULSAR: readonly Cell[] = [
  [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
  [0, 2], [5, 2], [7, 2], [12, 2],
  [0, 3], [5, 3], [7, 3], [12, 3],
  [0, 4], [5, 4], [7, 4], [12, 4],
  [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
  [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
  [0, 8], [5, 8], [7, 8], [12, 8],
  [0, 9], [5, 9], [7, 9], [12, 9],
  [0, 10], [5, 10], [7, 10], [12, 10],
  [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12],
]

/** R-pentomino（自然演化出漫长混沌） */
const R_PENTOMINO: readonly Cell[] = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]

const PATTERN_NAMES = ['滑翔机枪', '脉冲星', 'R-pentomino', '高斯帕'] as const
const SPEED_NAMES = ['×0.5', '×1', '×3'] as const
const SPEED_MULTS = [0.5, 1, 3] as const

interface LifeEngine {
  resize(): void
  resume(): void
  pause(): void
  destroy(): void
  setPaused(p: boolean): void
  setSpeed(idx: number): void
  loadPattern(idx: number): void
  randomize(): void
  clear(): void
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/* ============================================================ */

function createLifeEngine(
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  statsEl: HTMLElement | null,
): LifeEngine {
  const context = canvas.getContext('2d')
  if (!context) {
    return {
      resize() {}, resume() {}, pause() {}, destroy() {},
      setPaused() {}, setSpeed() {}, loadPattern() {}, randomize() {}, clear() {},
    }
  }
  const ctx: CanvasRenderingContext2D = context

  /* -------- 网格状态 -------- */
  let W = 0
  let H = 0
  let cols = 0
  let rows = 0
  let cell = 12
  let gx = 0
  let gy = 0

  let cur = new Uint8Array(0)
  let next = new Uint8Array(0)
  let birth = new Float32Array(0)

  // 死亡残影：固定容量环形缓冲（避免每代大量对象分配）
  const GHOST_CAP = 4096
  const gIdx = new Int32Array(GHOST_CAP)
  const gT = new Float64Array(GHOST_CAP)
  let gHead = 0
  let gCount = 0

  let running = false
  let raf = 0
  let last = 0
  let paused = false
  let speedIdx = 1
  let patternIdx = 0
  let gen = 0
  let pop = 0
  let acc = 0
  let dirty = true
  let lastStepAt = 0
  let lastPaintAt = 0
  let noise: HTMLCanvasElement | null = null

  const painting = { active: false, lx: -1, ly: -1 }

  function updateStats(): void {
    if (!statsEl) return
    statsEl.textContent = `GEN ${String(gen).padStart(4, '0')} · POP ${String(pop).padStart(4, '0')}`
  }

  function pushGhost(i: number, t: number): void {
    gIdx[gHead] = i
    gT[gHead] = t
    gHead = (gHead + 1) % GHOST_CAP
    if (gCount < GHOST_CAP) gCount++
  }

  function countLive(): number {
    let c = 0
    for (let i = 0; i < cur.length; i++) c += cur[i]
    return c
  }

  /* -------- 尺寸 -------- */
  function resize(): void {
    const w = Math.max(1, root.clientWidth)
    const h = Math.max(1, root.clientHeight)
    if (w === W && h === H) return
    W = w
    H = h
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 网格度量：中央区域，两侧避让翻页热区，下方留按钮条
    const bottomSpace = clamp(H * 0.16, 88, 132)
    const topSpace = clamp(H * 0.14, 62, 100)
    cell = W >= 620 ? 12 : W >= 430 ? 10 : 9
    cols = Math.floor((W * 0.84) / cell)
    if (cols < 24) {
      cell = Math.max(7, Math.floor((W * 0.9) / 24))
      cols = Math.max(16, Math.floor((W * 0.9) / cell))
    }
    const usableH = Math.max(cell * 6, H - topSpace - bottomSpace)
    rows = Math.max(10, Math.floor(usableH / cell))
    gx = Math.round((W - cols * cell) / 2)
    gy = Math.round(topSpace + (usableH - rows * cell) / 2)

    cur = new Uint8Array(cols * rows)
    next = new Uint8Array(cols * rows)
    birth = new Float32Array(cols * rows)
    gHead = 0
    gCount = 0

    // 纸张噪点纹理（离屏一次生成）
    noise = document.createElement('canvas')
    noise.width = W
    noise.height = H
    const nctx = noise.getContext('2d')
    if (nctx) {
      const n = Math.round((W * H) / 1500)
      for (let i = 0; i < n; i++) {
        nctx.fillStyle = `rgba(35,35,35,${(0.02 + Math.random() * 0.035).toFixed(3)})`
        nctx.fillRect(Math.random() * W, Math.random() * H, 1, 1)
      }
    }

    loadPattern(patternIdx)
  }

  /* -------- 图案 -------- */
  function stampCells(cells: readonly Cell[], ox: number, oy: number, mirror: boolean): void {
    const t = performance.now()
    for (const c of cells) {
      const x = ox + (mirror ? 35 - c[0] : c[0])
      const y = oy + c[1]
      if (x >= 0 && x < cols && y >= 0 && y < rows) {
        const i = y * cols + x
        cur[i] = 1
        birth[i] = t // 图案落下时红闪，如盖印
      }
    }
  }

  function loadPattern(idx: number): void {
    patternIdx = idx
    cur.fill(0)
    gHead = 0
    gCount = 0
    const oy = clamp(Math.round(rows * 0.1), 1, Math.max(1, rows - 12))
    if (idx === 1) {
      // 脉冲星：居中
      stampCells(PULSAR, Math.max(0, (cols - 13) >> 1), Math.max(0, (rows - 13) >> 1), false)
    } else if (idx === 2) {
      // R-pentomino：居中
      stampCells(R_PENTOMINO, Math.max(0, (cols >> 1) - 1), Math.max(0, (rows >> 1) - 1), false)
    } else if (idx === 3) {
      // 高斯帕：双枪镜像对峙（窄屏退化为单枪）
      if (cols >= 86) {
        stampCells(GUN, 2, oy, false)
        stampCells(GUN, cols - 38, oy, true)
      } else {
        stampCells(GUN, clamp(Math.round(cols * 0.1), 1, Math.max(1, cols - 38)), oy, false)
      }
    } else {
      // 滑翔机枪
      stampCells(GUN, clamp(Math.round(cols * 0.1), 1, Math.max(1, cols - 38)), oy, false)
    }
    gen = 0
    pop = countLive()
    dirty = true
    updateStats()
  }

  function randomize(): void {
    const t = performance.now()
    cur.fill(0)
    gHead = 0
    gCount = 0
    const x0 = Math.floor(cols * 0.14)
    const x1 = Math.ceil(cols * 0.86)
    const y0 = Math.floor(rows * 0.12)
    const y1 = Math.ceil(rows * 0.88)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (Math.random() < 0.16) {
          const i = y * cols + x
          cur[i] = 1
          birth[i] = t
        }
      }
    }
    gen = 0
    pop = countLive()
    dirty = true
    updateStats()
  }

  function clear(): void {
    cur.fill(0)
    gHead = 0
    gCount = 0
    gen = 0
    pop = 0
    dirty = true
    updateStats()
  }

  /* -------- 演化 -------- */
  function step(): void {
    const t = performance.now()
    lastStepAt = t
    let newPop = 0
    for (let y = 0; y < rows; y++) {
      const yo = y * cols
      const up = y > 0 ? yo - cols : -1
      const dn = y < rows - 1 ? yo + cols : -1
      for (let x = 0; x < cols; x++) {
        const xm = x > 0 ? x - 1 : -1
        const xp = x < cols - 1 ? x + 1 : -1
        let n = 0
        if (up >= 0) {
          if (xm >= 0) n += cur[up + xm]
          n += cur[up + x]
          if (xp >= 0) n += cur[up + xp]
        }
        if (xm >= 0) n += cur[yo + xm]
        if (xp >= 0) n += cur[yo + xp]
        if (dn >= 0) {
          if (xm >= 0) n += cur[dn + xm]
          n += cur[dn + x]
          if (xp >= 0) n += cur[dn + xp]
        }
        const i = yo + x
        if (cur[i]) {
          if (n === 2 || n === 3) {
            next[i] = 1
            newPop++
          } else {
            next[i] = 0
            pushGhost(i, t) // 死亡 → 灰色残影
          }
        } else if (n === 3) {
          next[i] = 1
          birth[i] = t // 新生 → 红闪
          newPop++
        } else {
          next[i] = 0
        }
      }
    }
    const tmp = cur
    cur = next
    next = tmp
    gen++
    pop = newPop
    updateStats()
  }

  /* -------- 绘制 -------- */
  function render(nowMs: number): void {
    if (W === 0 || cols === 0) return
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, W, H)
    if (noise) ctx.drawImage(noise, 0, 0, W, H)

    // 版面细框
    ctx.strokeStyle = 'rgba(35,35,35,0.12)'
    ctx.lineWidth = 1
    ctx.strokeRect(gx + 0.5, gy + 0.5, cols * cell - 1, rows * cell - 1)

    const hasRR = typeof ctx.roundRect === 'function'

    // 活细胞：稳定黑块（单一路径批量填充）
    ctx.fillStyle = INK
    ctx.beginPath()
    for (let i = 0; i < cur.length; i++) {
      if (!cur[i] || nowMs - birth[i] < FLASH_MS) continue
      const x = gx + (i % cols) * cell
      const y = gy + ((i / cols) | 0) * cell
      if (hasRR) ctx.roundRect(x + 0.5, y + 0.5, cell - 1.6, cell - 1.6, 1)
      else ctx.rect(x + 0.5, y + 0.5, cell - 1.6, cell - 1.6)
    }
    ctx.fill()

    // 新生细胞：红 → 黑渐变
    for (let i = 0; i < cur.length; i++) {
      if (!cur[i]) continue
      const age = nowMs - birth[i]
      if (age >= FLASH_MS) continue
      const k = age / FLASH_MS
      const r = Math.round(227 + (35 - 227) * k)
      const g = Math.round(49 + (35 - 49) * k)
      const b = Math.round(49 + (35 - 49) * k)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      const x = gx + (i % cols) * cell
      const y = gy + ((i / cols) | 0) * cell
      ctx.beginPath()
      if (hasRR) ctx.roundRect(x + 0.5, y + 0.5, cell - 1.6, cell - 1.6, 1)
      else ctx.rect(x + 0.5, y + 0.5, cell - 1.6, cell - 1.6)
      ctx.fill()
    }

    // 死亡残影（先收缩环形缓冲，跳过已过期）
    while (gCount > 0) {
      const oldest = (gHead - gCount + GHOST_CAP) % GHOST_CAP
      if (nowMs - gT[oldest] > GHOST_MS) gCount--
      else break
    }
    for (let k = 0; k < gCount; k++) {
      const idx = (gHead - gCount + k + GHOST_CAP) % GHOST_CAP
      const a = 1 - (nowMs - gT[idx]) / GHOST_MS
      if (a <= 0) continue
      const i = gIdx[idx]
      const x = gx + (i % cols) * cell
      const y = gy + ((i / cols) | 0) * cell
      ctx.fillStyle = `rgba(35,35,35,${(a * 0.22).toFixed(3)})`
      ctx.fillRect(x + 0.5, y + 0.5, cell - 1.6, cell - 1.6)
    }
  }

  /* -------- 播种 -------- */
  function paintCell(cx: number, cy: number): void {
    if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) return
    const i = cy * cols + cx
    if (!cur[i]) pop++
    cur[i] = 1
    birth[i] = performance.now()
    dirty = true
    lastPaintAt = performance.now()
  }

  function paintAt(px: number, py: number): void {
    const cx = Math.floor((px - gx) / cell)
    const cy = Math.floor((py - gy) / cell)
    if (painting.lx >= 0 || painting.ly >= 0) {
      // 快速拖动时补插值，避免断点
      const steps = Math.max(Math.abs(cx - painting.lx), Math.abs(cy - painting.ly), 1)
      for (let s = 1; s <= steps; s++) {
        paintCell(
          Math.round(painting.lx + ((cx - painting.lx) * s) / steps),
          Math.round(painting.ly + ((cy - painting.ly) * s) / steps),
        )
      }
    } else {
      paintCell(cx, cy)
    }
    painting.lx = cx
    painting.ly = cy
    updateStats()
  }

  /* -------- 输入 -------- */
  function toLocal(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    painting.active = true
    painting.lx = -1
    painting.ly = -1
    const { x, y } = toLocal(e)
    paintAt(x, y)
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* 忽略 */
    }
  }

  function onMove(e: PointerEvent): void {
    if (!painting.active) return
    const { x, y } = toLocal(e)
    paintAt(x, y)
  }

  function onUp(): void {
    painting.active = false
    painting.lx = -1
    painting.ly = -1
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  /* -------- 主循环 -------- */
  function loop(nowMs: number): void {
    if (!running) return
    raf = requestAnimationFrame(loop)
    const dt = Math.min((nowMs - last) / 1000, 0.1)
    last = nowMs
    if (!paused) {
      acc += dt
      const interval = 1 / (BASE_GENS * SPEED_MULTS[speedIdx])
      let steps = 0
      while (acc >= interval && steps < 4) {
        step()
        acc -= interval
        steps++
      }
      if (steps > 0) dirty = true
    }
    // 静止且无残影/红闪时跳过重绘（暂停时零消耗）
    const animated =
      !paused || (nowMs - lastStepAt < GHOST_MS + 80) || (nowMs - lastPaintAt < FLASH_MS + 80)
    if (dirty || animated) {
      render(nowMs)
      dirty = false
    }
  }

  function resume(): void {
    if (running) return
    running = true
    last = performance.now()
    raf = requestAnimationFrame(loop)
  }

  function pause(): void {
    running = false
    cancelAnimationFrame(raf)
  }

  function destroy(): void {
    pause()
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
  }

  function setPaused(p: boolean): void {
    paused = p
    dirty = true
  }

  function setSpeed(idx: number): void {
    speedIdx = idx
    acc = 0
  }

  resize()

  return { resize, resume, pause, destroy, setPaused, setSpeed, loadPattern, randomize, clear }
}

/* ============================================================ */

const BTN: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: '0.12em',
  padding: '5px 11px',
  border: '1px solid #232323',
  color: INK,
  background: 'transparent',
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
}

export default function Art07({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<LifeEngine | null>(null)

  const [paused, setPaused] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(1)
  const [patternIdx, setPatternIdx] = useState(0)
  /** 挑战：用户经按钮看过的图案集合（看全 4 种通关） */
  const seenPatternsRef = useRef<Set<number>>(new Set([0]))

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const engine = createLifeEngine(canvas, root, statsRef.current)
    engineRef.current = engine
    engine.resize()
    const ro = new ResizeObserver(() => {
      engine.resize()
    })
    ro.observe(root)
    return () => {
      ro.disconnect()
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (active) engine.resume()
    else engine.pause()
  }, [active])

  useEffect(() => {
    engineRef.current?.setPaused(paused)
  }, [paused])

  useEffect(() => {
    engineRef.current?.setSpeed(speedIdx)
  }, [speedIdx])

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: PAPER }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />
      {/* 角落署名 */}
      <div
        className="pointer-events-none absolute z-10 select-none"
        style={{ left: '12%', top: '4.5%' }}
      >
        <div className="font-display" style={{ fontSize: 11, letterSpacing: '0.42em', color: INK }}>
          LIFE
        </div>
        <div
          className="font-cn"
          style={{ fontSize: 10, letterSpacing: '0.5em', color: 'rgba(35,35,35,0.6)', marginTop: 5 }}
        >
          生命游戏
        </div>
        <div
          className="font-attitude"
          style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(35,35,35,0.4)', marginTop: 6 }}
        >
          拖动播种
        </div>
      </div>
      {/* 演化读数 */}
      <div
        ref={statsRef}
        className="pointer-events-none absolute z-10 select-none font-attitude"
        style={{ right: '12%', top: '5.2%', fontSize: 9.5, letterSpacing: '0.18em', color: 'rgba(35,35,35,0.55)' }}
      />
      {/* 按钮条（居中，避让两侧热区与底部角章） */}
      <div
        className="absolute z-20 flex flex-wrap items-center justify-center gap-2"
        style={{ left: '11%', right: '11%', bottom: '4.5%' }}
      >
        <button
          type="button"
          className="select-none font-attitude transition-colors hover:bg-[#232323] hover:text-[#f4f1ea]"
          style={BTN}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? '▶ 继续' : '⏸ 暂停'}
        </button>
        <button
          type="button"
          className="select-none font-attitude transition-colors hover:bg-[#232323] hover:text-[#f4f1ea]"
          style={BTN}
          onClick={() => engineRef.current?.randomize()}
        >
          随机
        </button>
        <button
          type="button"
          className="select-none font-attitude transition-colors hover:bg-[#232323] hover:text-[#f4f1ea]"
          style={BTN}
          onClick={() => engineRef.current?.clear()}
        >
          清空
        </button>
        <button
          type="button"
          className="select-none font-attitude transition-colors hover:bg-[#232323] hover:text-[#f4f1ea]"
          style={BTN}
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEED_MULTS.length)}
        >
          速度 {SPEED_NAMES[speedIdx]}
        </button>
        <button
          type="button"
          className="select-none font-attitude transition-colors hover:bg-[#232323] hover:text-[#f4f1ea]"
          style={BTN}
          onClick={() => {
            const n = (patternIdx + 1) % PATTERN_NAMES.length
            setPatternIdx(n)
            seenPatternsRef.current.add(n)
            if (seenPatternsRef.current.size >= PATTERN_NAMES.length) {
              useBookStore.getState().clearRoom(7)
            }
            engineRef.current?.loadPattern(n)
          }}
        >
          图案 · {PATTERN_NAMES[patternIdx]}
        </button>
      </div>
    </div>
  )
}
