'use client'

import { useEffect, useRef, useState } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/**
 * ROOM 20 · WHITE 白（全书终章）
 * 纯白之页，一枚黑点。移动 → 黑点以弹簧滞后追随指针，留下极浅灰的残点轨迹；
 * 长时间不动 → 极缓呼吸；点击 → 全页反色一闪，黑点炸成 600 粒黑点四散，
 * 再被牵引拼组成巨大的「完」（离屏 canvas 扫描字模点阵，easeOutCubic 错落飞抵，微颤），
 * 随后浮现「第二十一间房是你 · THE TWENTY-FIRST ROOM IS YOU」与「翻回封面 · 或合上书」。
 * 再点击 → 一切归于安静的一枚黑点。
 */

const COUNT = 600
const DOT_R = 7
const TAU = Math.PI * 2

type Phase = 'dot' | 'burst' | 'formed' | 'gather'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  tx: number
  ty: number
  arc: number
  pullAt: number
  flyDur: number
  pulling: boolean
  p0x: number
  p0y: number
  cxA: number
  cyA: number
  arrived: boolean
  jx: number
  jy: number
  gAt: number
  gDur: number
  gx: number
  gy: number
}

interface WhiteState {
  raf: number
  w: number
  h: number
  dpr: number
  base: CanvasRenderingContext2D | null
  over: CanvasRenderingContext2D | null
  sprite: HTMLCanvasElement | null
  phase: Phase
  lastT: number
  burstT0: number
  gatherT0: number
  maxArrive: number
  maxGather: number
  dotX: number
  dotY: number
  dotVX: number
  dotVY: number
  dotR: number
  px: number
  py: number
  pInside: boolean
  pMoveT: number
  stampX: number
  stampY: number
  particles: Particle[]
  flashTimer: number
  revealTimers: number[]
  loop: () => void
  drawScene: () => void
  step: (dt: number, now: number) => void
  startBurst: () => void
  startGather: () => void
  skipToForm: () => void
  onDown: () => void
  scheduleReveal: () => void
  clearReveals: () => void
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

/** 残点贴图：柔边浅灰圆 */
function makeStamp(): HTMLCanvasElement {
  const sp = document.createElement('canvas')
  sp.width = 32
  sp.height = 32
  const c = sp.getContext('2d')
  if (c) {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16)
    g.addColorStop(0, 'rgba(0,0,0,0.5)')
    g.addColorStop(0.55, 'rgba(0,0,0,0.22)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 32, 32)
  }
  return sp
}

/** 离屏绘制「完」，扫描字模像素取点阵目标（无字体时退化为圆环） */
function sampleGlyph(w: number, h: number, count: number): Float32Array {
  const out = new Float32Array(count * 2)
  const cw = Math.max(2, Math.round(w))
  const chh = Math.max(2, Math.round(h))
  const cv = document.createElement('canvas')
  cv.width = cw
  cv.height = chh
  const c = cv.getContext('2d')
  if (!c) return out
  const fs = Math.floor(Math.min(w * 0.62, h * 0.52))
  c.fillStyle = '#000'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.font = `900 ${fs}px "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", sans-serif`
  c.fillText('完', cw / 2, chh * 0.455)

  let data: Uint8ClampedArray | null = null
  try {
    data = c.getImageData(0, 0, cw, chh).data
  } catch {
    data = null
  }

  let cand: number[] = []
  if (data) {
    for (const stride of [4, 3, 2]) {
      cand = []
      for (let y = 0; y < chh; y += stride) {
        for (let x = 0; x < cw; x += stride) {
          if (data[(y * cw + x) * 4 + 3] > 96) cand.push(x, y)
        }
      }
      if (cand.length >= count * 2 * 1.35) break
    }
  }

  const m = cand.length / 2
  if (m < 60) {
    // 字体缺失时的兜底：一个巨大的点阵圆环
    const R = Math.min(w, h) * 0.3
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU
      out[i * 2] = w / 2 + Math.cos(a) * R
      out[i * 2 + 1] = h * 0.46 + Math.sin(a) * R
    }
    return out
  }

  const idx = new Array<number>(m)
  for (let i = 0; i < m; i++) idx[i] = i
  for (let i = m - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = idx[i]
    idx[i] = idx[j]
    idx[j] = t
  }
  for (let i = 0; i < count; i++) {
    const s = idx[i % m] * 2
    const dup = m < count
    out[i * 2] = cand[s] + (dup ? rand(-2, 2) : 0)
    out[i * 2 + 1] = cand[s + 1] + (dup ? rand(-2, 2) : 0)
  }
  return out
}

export default function Art20({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const overRef = useRef<HTMLCanvasElement | null>(null)
  const [reveal1, setReveal1] = useState(false)
  const [reveal2, setReveal2] = useState(false)

  const stRef = useRef<WhiteState>({
    raf: 0,
    w: 0,
    h: 0,
    dpr: 1,
    base: null,
    over: null,
    sprite: null,
    phase: 'dot',
    lastT: 0,
    burstT0: 0,
    gatherT0: 0,
    maxArrive: 0,
    maxGather: 0,
    dotX: 0,
    dotY: 0,
    dotVX: 0,
    dotVY: 0,
    dotR: DOT_R,
    px: 0,
    py: 0,
    pInside: false,
    pMoveT: 0,
    stampX: -9999,
    stampY: -9999,
    particles: Array.from({ length: COUNT }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 2,
      tx: 0,
      ty: 0,
      arc: 0,
      pullAt: 0,
      flyDur: 1,
      pulling: false,
      p0x: 0,
      p0y: 0,
      cxA: 0,
      cyA: 0,
      arrived: false,
      jx: 0,
      jy: 0,
      gAt: 0,
      gDur: 1,
      gx: 0,
      gy: 0,
    })),
    flashTimer: 0,
    revealTimers: [],
    loop: () => {},
    drawScene: () => {},
    step: () => {},
    startBurst: () => {},
    startGather: () => {},
    skipToForm: () => {},
    onDown: () => {},
    scheduleReveal: () => {},
    clearReveals: () => {},
  })

  useEffect(() => {
    const root = rootRef.current
    const baseCv = baseRef.current
    const overCv = overRef.current
    if (!root || !baseCv || !overCv) return
    const st = stRef.current
    st.base = baseCv.getContext('2d')
    st.over = overCv.getContext('2d')
    st.sprite = makeStamp()

    const fillWhite = (): void => {
      if (!st.base) return
      st.base.globalAlpha = 1
      st.base.fillStyle = '#ffffff'
      st.base.fillRect(0, 0, st.w, st.h)
    }

    const sizeCanvases = (): void => {
      const rect = root.getBoundingClientRect()
      st.dpr = Math.min(window.devicePixelRatio || 1, 2)
      st.w = Math.max(1, rect.width)
      st.h = Math.max(1, rect.height)
      for (const cv of [baseCv, overCv]) {
        cv.width = Math.round(st.w * st.dpr)
        cv.height = Math.round(st.h * st.dpr)
      }
      st.base?.setTransform(st.dpr, 0, 0, st.dpr, 0, 0)
      st.over?.setTransform(st.dpr, 0, 0, st.dpr, 0, 0)
      fillWhite()
    }

    st.drawScene = (): void => {
      const oc = st.over
      if (!oc) return
      oc.clearRect(0, 0, st.w, st.h)
      oc.fillStyle = '#000'
      if (st.phase === 'dot') {
        oc.beginPath()
        oc.arc(st.dotX, st.dotY, st.dotR, 0, TAU)
        oc.fill()
      } else {
        oc.beginPath()
        for (const p of st.particles) {
          oc.moveTo(p.x + p.r, p.y)
          oc.arc(p.x, p.y, p.r, 0, TAU)
        }
        oc.fill()
      }
    }

    st.clearReveals = (): void => {
      for (const t of st.revealTimers) window.clearTimeout(t)
      st.revealTimers = []
    }

    st.scheduleReveal = (): void => {
      st.clearReveals()
      st.revealTimers.push(window.setTimeout(() => setReveal1(true), 500))
      st.revealTimers.push(window.setTimeout(() => setReveal2(true), 3800))
    }

    st.startBurst = (): void => {
      const tg = sampleGlyph(st.w, st.h, COUNT)
      const now = performance.now()
      st.burstT0 = now
      st.maxArrive = 0
      for (let i = 0; i < COUNT; i++) {
        const p = st.particles[i]
        p.x = st.dotX
        p.y = st.dotY
        const a = Math.random() * TAU
        const sp = rand(240, 800)
        p.vx = Math.cos(a) * sp
        p.vy = Math.sin(a) * sp
        p.r = rand(1.3, 2.6)
        p.tx = tg[i * 2]
        p.ty = tg[i * 2 + 1]
        p.arc = rand(-100, 100)
        p.pullAt = rand(0.42, 1.17)
        p.flyDur = rand(0.8, 1.65)
        p.pulling = false
        p.arrived = false
        p.jx = 0
        p.jy = 0
        const end = p.pullAt + p.flyDur
        if (end > st.maxArrive) st.maxArrive = end
      }
      st.phase = 'burst'
      st.clearReveals()
      setReveal1(false)
      setReveal2(false)
      // 白屏瞬间反色一闪
      if (root) {
        root.style.filter = 'invert(1)'
        window.clearTimeout(st.flashTimer)
        st.flashTimer = window.setTimeout(() => {
          if (rootRef.current) rootRef.current.style.filter = ''
        }, 120)
      }
    }

    st.skipToForm = (): void => {
      for (const p of st.particles) {
        if (!p.arrived) {
          p.pullAt = 0
          p.flyDur = 0.16
          p.pulling = false
        }
      }
      st.maxArrive = 0.2
    }

    st.startGather = (): void => {
      const now = performance.now()
      st.gatherT0 = now
      st.maxGather = 0
      for (const p of st.particles) {
        p.gx = p.x
        p.gy = p.y
        p.gAt = rand(0, 0.22)
        p.gDur = rand(0.5, 0.88)
        const end = p.gAt + p.gDur
        if (end > st.maxGather) st.maxGather = end
      }
      st.phase = 'gather'
      st.clearReveals()
      setReveal1(false)
      setReveal2(false)
    }

    st.onDown = (): void => {
      if (st.phase === 'dot') st.startBurst()
      else if (st.phase === 'burst') st.skipToForm()
      else if (st.phase === 'formed') st.startGather()
      /* gather 期间忽略 */
    }

    st.step = (dt: number, now: number): void => {
      const bc = st.base
      if (bc) {
        if (st.phase === 'dot') {
          bc.fillStyle = 'rgba(255,255,255,0.028)'
          bc.fillRect(0, 0, st.w, st.h)
        } else {
          bc.fillStyle = 'rgba(255,255,255,0.05)'
          bc.fillRect(0, 0, st.w, st.h)
        }
      }

      if (st.phase === 'dot') {
        // 弹簧滞后追随：越慢越庄重
        const tx = st.pInside ? st.px : st.w / 2
        const ty = st.pInside ? st.py : st.h / 2
        st.dotVX += (tx - st.dotX) * 16 * dt
        st.dotVY += (ty - st.dotY) * 16 * dt
        const df = Math.exp(-5.2 * dt)
        st.dotVX *= df
        st.dotVY *= df
        st.dotX += st.dotVX * dt
        st.dotY += st.dotVY * dt
        // 长时间不动：极缓慢呼吸
        const idle = (now - st.pMoveT) / 1000
        const amp = Math.max(0, Math.min(1, (idle - 1.4) / 2.4))
        st.dotR = DOT_R * (1 + 0.02 * amp * Math.sin(now * 0.0011))
        // 残点轨迹（离散浅灰墨滴）
        if (bc && st.sprite) {
          const dx = st.dotX - st.stampX
          const dy = st.dotY - st.stampY
          if (dx * dx + dy * dy > 56) {
            bc.globalAlpha = 0.42
            bc.drawImage(st.sprite, st.dotX - 7, st.dotY - 7, 14, 14)
            bc.globalAlpha = 1
            st.stampX = st.dotX
            st.stampY = st.dotY
          }
        }
      } else if (st.phase === 'burst') {
        const t = (now - st.burstT0) / 1000
        let all = true
        for (const p of st.particles) {
          if (p.arrived) {
            p.jx += (Math.random() - 0.5) * 0.42
            p.jy += (Math.random() - 0.5) * 0.42
            p.jx *= 0.86
            p.jy *= 0.86
            p.x = p.tx + p.jx
            p.y = p.ty + p.jy
            continue
          }
          all = false
          if (t < p.pullAt) {
            // 四散 + 阻尼
            const damp = Math.exp(-dt * 2.1)
            p.vx *= damp
            p.vy *= damp
            p.x += p.vx * dt
            p.y += p.vy * dt
          } else {
            if (!p.pulling) {
              p.pulling = true
              p.p0x = p.x
              p.p0y = p.y
              const dxT = p.tx - p.x
              const dyT = p.ty - p.y
              const len = Math.hypot(dxT, dyT) || 1
              const mx = (p.x + p.tx) / 2
              const my = (p.y + p.ty) / 2
              // 垂直偏移控制点：倒放花瓣雨般的弧线
              p.cxA = mx + (-dyT / len) * p.arc
              p.cyA = my + (dxT / len) * p.arc
            }
            const u = (t - p.pullAt) / p.flyDur
            if (u >= 1) {
              p.arrived = true
              p.x = p.tx
              p.y = p.ty
              p.jx = 0
              p.jy = 0
            } else {
              const e = 1 - Math.pow(1 - u, 3) // easeOutCubic
              const ie = 1 - e
              p.x = ie * ie * p.p0x + 2 * ie * e * p.cxA + e * e * p.tx
              p.y = ie * ie * p.p0y + 2 * ie * e * p.cyA + e * e * p.ty
            }
          }
        }
        if (all && t > st.maxArrive + 0.45) {
          st.phase = 'formed'
          // 挑战：「完」拼组完成 → 通关（幂等）
          useBookStore.getState().clearRoom(20)
          st.scheduleReveal()
        }
      } else if (st.phase === 'formed') {
        // 微颤 + 指针轻斥
        for (const p of st.particles) {
          p.jx += (Math.random() - 0.5) * 0.5
          p.jy += (Math.random() - 0.5) * 0.5
          p.jx *= 0.82
          p.jy *= 0.82
          let hx = p.tx + p.jx
          let hy = p.ty + p.jy
          if (st.pInside) {
            const dx = p.tx - st.px
            const dy = p.ty - st.py
            const d = Math.hypot(dx, dy)
            if (d < 80 && d > 0.001) {
              const k = Math.pow((80 - d) / 80, 1.5) * 14
              hx += (dx / d) * k
              hy += (dy / d) * k
            }
          }
          const k2 = Math.min(1, dt * 9)
          p.x += (hx - p.x) * k2
          p.y += (hy - p.y) * k2
        }
      } else {
        // gather：一切归于中心
        const t = (now - st.gatherT0) / 1000
        const cx = st.w / 2
        const cy = st.h / 2
        let all = true
        for (const p of st.particles) {
          const u = (t - p.gAt) / p.gDur
          if (u >= 1) {
            p.x = cx
            p.y = cy
            continue
          }
          all = false
          const e = Math.pow(Math.max(0, u), 3) // easeInCubic 聚拢
          p.x = p.gx + (cx - p.gx) * e
          p.y = p.gy + (cy - p.gy) * e
        }
        if (all && t > st.maxGather + 0.15) {
          st.phase = 'dot'
          st.dotX = cx
          st.dotY = cy
          st.dotVX = 0
          st.dotVY = 0
          st.stampX = -9999
          st.stampY = -9999
          fillWhite()
        }
      }
    }

    st.loop = (): void => {
      st.raf = requestAnimationFrame(st.loop)
      const now = performance.now()
      const dt = Math.min(0.05, (now - st.lastT) / 1000)
      st.lastT = now
      st.step(dt, now)
      st.drawScene()
    }

    sizeCanvases()
    st.dotX = st.w / 2
    st.dotY = st.h / 2
    st.lastT = performance.now()
    st.pMoveT = performance.now()
    st.drawScene()

    const ro = new ResizeObserver(() => {
      sizeCanvases()
      if (st.phase === 'burst' || st.phase === 'formed') {
        // 字模随页面重排：短暂重飞
        const tg = sampleGlyph(st.w, st.h, COUNT)
        st.burstT0 = performance.now()
        st.maxArrive = 0
        for (let i = 0; i < COUNT; i++) {
          const p = st.particles[i]
          p.tx = tg[i * 2]
          p.ty = tg[i * 2 + 1]
          p.arrived = false
          p.pulling = false
          p.pullAt = rand(0.06, 0.3)
          p.flyDur = rand(0.5, 0.85)
          p.jx = 0
          p.jy = 0
          const end = p.pullAt + p.flyDur
          if (end > st.maxArrive) st.maxArrive = end
        }
        st.phase = 'burst'
        st.clearReveals()
        setReveal1(false)
        setReveal2(false)
      } else {
        st.drawScene()
      }
    })
    ro.observe(root)

    return () => {
      cancelAnimationFrame(st.raf)
      ro.disconnect()
      window.clearTimeout(st.flashTimer)
      for (const t of st.revealTimers) window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    const st = stRef.current
    if (active) {
      st.lastT = performance.now()
      st.raf = requestAnimationFrame(st.loop)
    }
    return () => cancelAnimationFrame(st.raf)
  }, [active])

  const pos = (e: React.PointerEvent<HTMLDivElement>): void => {
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    const st = stRef.current
    st.px = e.clientX - r.left
    st.py = e.clientY - r.top
    st.pInside = true
    st.pMoveT = performance.now()
  }

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#ffffff', cursor: 'none', userSelect: 'none', touchAction: 'none' }}
      onPointerMove={pos}
      onPointerDown={(e) => {
        pos(e)
        stRef.current.pInside = true
        stRef.current.onDown()
      }}
      onPointerLeave={() => {
        stRef.current.pInside = false
      }}
    >
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={overRef} className="absolute inset-0 h-full w-full" />

      {/* 终章两行字：缓缓浮现 */}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-cn"
        style={{
          bottom: '15%',
          opacity: reveal1 ? 1 : 0,
          transition: 'opacity 2.2s ease',
          color: '#8f8f8f',
          fontSize: 'min(1.6cqh, 2.2cqw)',
          letterSpacing: '0.34em',
          textIndent: '0.34em',
        }}
      >
        第二十一间房是你 · THE TWENTY-FIRST ROOM IS YOU
      </div>
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-cn"
        style={{
          bottom: '10.4%',
          opacity: reveal2 ? 1 : 0,
          transition: 'opacity 1.8s ease',
          color: '#b0b0b0',
          fontSize: 'min(1.5cqh, 2cqw)',
          letterSpacing: '0.5em',
          textIndent: '0.5em',
        }}
      >
        翻回封面 · 或合上书
      </div>

      <div
        className="pointer-events-none absolute flex items-baseline gap-[1.1em] whitespace-nowrap"
        style={{ left: '50%', bottom: '3.2%', transform: 'translateX(-50%)' }}
      >
        <span
          className="font-attitude"
          style={{ fontSize: 'min(1.4cqh, 1.9cqw)', letterSpacing: '0.3em', color: '#9a9a9a' }}
        >
          WHITE · 白
        </span>
        <span className="font-cn" style={{ fontSize: 'min(1.4cqh, 1.9cqw)', color: '#c2c2c2' }}>
          移动 · 凝视；点击 · 终章
        </span>
      </div>
    </div>
  )
}
