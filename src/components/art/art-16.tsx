'use client'

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/**
 * ROOM 16 · PHOSPHENE 磷光 — 闭眼之光 EIDETIC FIELD
 *
 * 按住页面 = 按压闭上的眼睛，视像（phosphene）从按压点生长；按压越久，视像越盛。
 *   阶段一（0–1s）    白热核心 + 向外扩散的同心涟漪环（环间距由种子噪声调制）
 *   阶段二（1–2.5s）  12–20 根放射辐条自中心长出（缓慢旋转，方向由种子定），
 *                     涟漪环开始扭曲成螺旋臂（极坐标 r = a·θ + 噪声扰动）
 *   阶段三（>2.5s）   蜂窝六角网格自中心向外蔓延（半径∝时长，六边形按距离
 *                     波次脉冲发亮——一圈一圈亮的波往外跑）+ 细丝状条纹漂浮
 * 松手 → 残像衰变 2.5s：色相反转（紫主导）+ 整体缩胀一次 + alpha 淡出后销毁。
 * 快速轻点（<300ms 且 <10px）→ 400ms 小型闪光绽放 + pop 声。
 * 按住中移动指针 → 视像中心弹性跟随（弹簧滞后），快速移动沿速度方向拉长畸变。
 * 多点触控：每根按下的手指都是一个视像（上限 3 并存，第 4 次按压顶替最旧）。
 *
 * 空闲层（永远活着）：中心极淡琥珀呼吸环（α≤0.12）+ 暗噪场微闪（视网膜的星星）
 * + 一条幽灵谐振曲线缓慢自绘又淡去——向本房间的上一世「谐振记录仪」致敬的血统。
 *
 * 音频：眼压嗡鸣——110/110.7Hz 双失谐正弦过低通，增益∝全部视像强度总和；
 * 阶段二起加入整数比高位泛音列（2f 3f 5f，极轻），阶段三再加 7f 微颤（LFO）；
 * 衰变时随强度收拢。全部走 master gain + 全局 muted 订阅 + 首次手势懒创建。
 */

const BG = '#060409'
const HOT = '#fff7e8'
const AMBER = '#ffb03a'
const PURPLE = '#8a6cff'
const TAU = Math.PI * 2

/** 按压视像最多并存数（第 4 次按压顶替最旧） */
const MAX_VISIONS = 3
/** 轻点闪光最多并存数（瞬时小品，不占视像名额） */
const MAX_FLASHES = 4
const VISION_POOL = 10
/** 暗噪场微闪数量（40–60 取中） */
const FLICKER_N = 52
/** 幽灵曲线绘制总点数（决定自绘速度） */
const GHOST_MAX = 900
const GHOST_T_END = 110
/** 幽灵曲线线迹透明度 */
const GHOST_ALPHA = 0.08
/** 幽灵曲线层淡出速率（指数衰减，1/秒；≈9s 后不可见） */
const GHOST_FADE_RATE = 0.22
/** 残像衰变时长（秒） */
const DECAY_DUR = 2.5
/** 轻点闪光总时长（秒） */
const FLASH_DUR = 0.4
/** 单个视像六边形绘制上限（性能保险） */
const HEX_CAP = 900

/** 平顶六边形单位顶点偏移 */
const HUX = new Float32Array([1, 0.5, -0.5, -1, -0.5, 0.5])
const HUY = new Float32Array([0, 0.8660254, 0.8660254, 0, -0.8660254, -0.8660254])

const RATIOS: ReadonlyArray<readonly [number, number]> = [
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [3, 5],
  [5, 4],
  [5, 7],
  [8, 9],
]

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number): number => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
/** 确定性噪声（种子 → 0..1） */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const hexToRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const mixHex = (c1: string, c2: string, t: number): string => {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  const r = Math.round(lerp(r1, r2, t))
  const g = Math.round(lerp(g1, g2, t))
  const b = Math.round(lerp(b1, b2, t))
  return `rgb(${r},${g},${b})`
}

/** 视像径向色带：核心白热 → 琥珀 → 外围紫晕 */
const RAMP: readonly string[] = [mixHex(HOT, AMBER, 0.45), AMBER, mixHex(AMBER, PURPLE, 0.5), PURPLE]
/** 残像色带（色相反转 · 紫主导） */
const INV_RAMP: readonly string[] = ['#e6dcff', '#a58bff', '#8a6cff', '#5d43c8']
/** 蜂窝波次亮度桶颜色（暗→亮） */
const HEX_C: readonly string[] = [PURPLE, mixHex(AMBER, PURPLE, 0.5), AMBER, HOT]
const HEX_INV: readonly string[] = ['#4a37a6', '#8a6cff', '#a58bff', '#e6dcff']
const HEX_A: readonly number[] = [0.07, 0.18, 0.36, 0.62]

interface Vision {
  /** 0 = 按压视像；1 = 轻点闪光 */
  kind: 0 | 1
  pointerId: number
  seed: number
  /** 弹簧跟随的绘制中心 */
  cx: number
  cy: number
  /** 指针目标点 */
  tx: number
  ty: number
  vx: number
  vy: number
  bornT: number
  /** 按住累计时长（松手后冻结，驱动三阶段生长） */
  hold: number
  /** 0 = 生长中；1 = 残像衰变 */
  state: 0 | 1
  decay: number
  age: number
  rot: number
  rotSpd: number
  dir: number
  spokes: number
  downX: number
  downY: number
  downT: number
  e1: number
  e2: number
  e3: number
  filN: number
  /** 细丝参数（每根 6 个：rx ry phase angle len speed） */
  filA: Float32Array
}

const makeVision = (): Vision => ({
  kind: 0,
  pointerId: -1,
  seed: 0,
  cx: 0,
  cy: 0,
  tx: 0,
  ty: 0,
  vx: 0,
  vy: 0,
  bornT: 0,
  hold: 0,
  state: 0,
  decay: 0,
  age: 0,
  rot: 0,
  rotSpd: 0.2,
  dir: 1,
  spokes: 16,
  downX: 0,
  downY: 0,
  downT: 0,
  e1: 0,
  e2: 0,
  e3: 0,
  filN: 6,
  filA: new Float32Array(48),
})

interface GhostCurve {
  ax1: number
  ax2: number
  ay1: number
  ay2: number
  f1: number
  f2: number
  f3: number
  f4: number
  p1: number
  p2: number
  p3: number
  p4: number
  d1: number
  d2: number
  d3: number
  d4: number
}

const newGhost = (g: GhostCurve): void => {
  const r1 = RATIOS[Math.floor(Math.random() * RATIOS.length)]
  const r2 = RATIOS[Math.floor(Math.random() * RATIOS.length)]
  const base = 0.45 + Math.random() * 0.5
  const ax1 = 0.3 + Math.random() * 0.4
  const ay1 = 0.3 + Math.random() * 0.4
  const dOf = (): number => -Math.log(0.3 + Math.random() * 0.45) / GHOST_T_END
  g.ax1 = ax1
  g.ax2 = 1 - ax1
  g.ay1 = ay1
  g.ay2 = 1 - ay1
  g.f1 = base * r1[0]
  g.f2 = base * r1[1] * (0.996 + Math.random() * 0.008)
  g.f3 = base * r2[0]
  g.f4 = base * r2[1] * (0.996 + Math.random() * 0.008)
  g.p1 = Math.random() * TAU
  g.p2 = Math.random() * TAU
  g.p3 = Math.random() * TAU
  g.p4 = Math.random() * TAU
  g.d1 = dOf()
  g.d2 = dOf()
  g.d3 = dOf()
  g.d4 = dOf()
}

/** 预烘焙径向渐变贴图（渲染循环零分配：之后只 drawImage） */
const bakeRadial = (size: number, stops: ReadonlyArray<readonly [number, string]>): HTMLCanvasElement => {
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const c = cv.getContext('2d')
  if (c) {
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    for (const item of stops) g.addColorStop(item[0], item[1])
    c.fillStyle = g
    c.fillRect(0, 0, size, size)
  }
  return cv
}

export default function Art16({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let m = 1 // min(w, h)
    let dpr = 1
    let valid = false
    let raf = 0
    let running = false
    let disposed = false
    let T = 0
    let last = 0

    let muted = useBookStore.getState().muted

    // ---------- 贴图 ----------
    const spCore = bakeRadial(96, [
      [0, 'rgba(255,247,232,0.92)'],
      [0.28, 'rgba(255,220,170,0.34)'],
      [1, 'rgba(255,200,140,0)'],
    ])
    const spHalo = bakeRadial(256, [
      [0, 'rgba(255,176,58,0.5)'],
      [0.42, 'rgba(255,176,58,0.17)'],
      [0.72, 'rgba(138,108,255,0.11)'],
      [1, 'rgba(138,108,255,0)'],
    ])
    const spHaloInv = bakeRadial(256, [
      [0, 'rgba(230,220,255,0.5)'],
      [0.38, 'rgba(138,108,255,0.24)'],
      [1, 'rgba(90,67,200,0)'],
    ])

    // ---------- 视像池 ----------
    const vs: Vision[] = []
    const pool: Vision[] = []
    for (let i = 0; i < VISION_POOL; i++) pool.push(makeVision())

    const seedFilaments = (v: Vision): void => {
      v.filN = 5 + Math.floor(Math.random() * 4)
      for (let f = 0; f < 8; f++) {
        const o = f * 6
        v.filA[o] = Math.random() * 2 - 1
        v.filA[o + 1] = Math.random() * 2 - 1
        v.filA[o + 2] = Math.random() * TAU
        v.filA[o + 3] = Math.random() * TAU
        v.filA[o + 4] = 0.05 + Math.random() * 0.11
        v.filA[o + 5] = 0.25 + Math.random() * 0.6
      }
    }

    const removeVision = (i: number): void => {
      const v = vs[i]
      vs[i] = vs[vs.length - 1]
      vs.pop()
      if (pool.length < VISION_POOL) pool.push(v)
    }

    /** 顶替最旧的指定 kind 视像 */
    const evictOldest = (kind: 0 | 1): void => {
      let oi = -1
      for (let i = 0; i < vs.length; i++) {
        if (vs[i].kind === kind && (oi < 0 || vs[i].bornT < vs[oi].bornT)) oi = i
      }
      if (oi >= 0) removeVision(oi)
    }

    const spawnVision = (x: number, y: number, pointerId: number, nowMs: number): void => {
      let presses = 0
      for (let i = 0; i < vs.length; i++) {
        if (vs[i].kind === 0) presses++
      }
      while (presses >= MAX_VISIONS) {
        const before = vs.length
        evictOldest(0)
        if (vs.length === before) break
        presses--
      }
      const pv = pool.pop()
      const v = pv ?? makeVision()
      v.kind = 0
      v.pointerId = pointerId
      v.seed = Math.random() * 997
      v.cx = x
      v.cy = y
      v.tx = x
      v.ty = y
      v.vx = 0
      v.vy = 0
      v.bornT = T
      v.hold = 0
      v.state = 0
      v.decay = 0
      v.age = 0
      v.rot = Math.random() * TAU
      v.rotSpd = 0.1 + Math.random() * 0.2
      v.dir = Math.random() < 0.5 ? -1 : 1
      v.spokes = 12 + Math.floor(Math.random() * 8)
      v.downX = x
      v.downY = y
      v.downT = nowMs
      v.e1 = 0
      v.e2 = 0
      v.e3 = 0
      seedFilaments(v)
      vs.push(v)
    }

    const spawnFlash = (x: number, y: number): void => {
      let flashes = 0
      for (let i = 0; i < vs.length; i++) {
        if (vs[i].kind === 1) flashes++
      }
      while (flashes >= MAX_FLASHES) {
        const before = vs.length
        evictOldest(1)
        if (vs.length === before) break
        flashes--
      }
      const pv = pool.pop()
      const v = pv ?? makeVision()
      v.kind = 1
      v.pointerId = -1
      v.seed = Math.random() * 997
      v.cx = x
      v.cy = y
      v.tx = x
      v.ty = y
      v.vx = 0
      v.vy = 0
      v.bornT = T
      v.hold = 0
      v.state = 0
      v.decay = 0
      v.age = 0
      v.rot = 0
      v.rotSpd = 0
      v.dir = 1
      v.spokes = 0
      v.downX = x
      v.downY = y
      v.downT = 0
      v.e1 = 1
      v.e2 = 0
      v.e3 = 0
      seedFilaments(v)
      vs.push(v)
    }

    // ---------- 幽灵谐振曲线（旧房间血统） ----------
    // 独立持久层：新线段只画一次（source-over），每帧对整层做 destination-out
    // 淡出 —— 避免 'lighter' 主画布上逐帧重描导致的亮度饱和累积。
    const gCv = document.createElement('canvas')
    const gCtx = gCv.getContext('2d')
    const gCurve: GhostCurve = {
      ax1: 0.5, ax2: 0.5, ay1: 0.5, ay2: 0.5,
      f1: 1, f2: 1.5, f3: 1, f4: 1.5,
      p1: 0, p2: 0, p3: 0, p4: 0,
      d1: 0.01, d2: 0.01, d3: 0.01, d4: 0.01,
    }
    let gPenX = 0
    let gPenY = 0
    let gPenDown = false
    let gT = 0
    let gActive = true
    let gNext = 0
    const gDt = GHOST_T_END / GHOST_MAX
    newGhost(gCurve)

    const ghostTick = (dt: number): void => {
      const g = gCtx
      if (!g) return
      // 整层缓慢淡出（指数衰减，帧率无关）
      g.globalCompositeOperation = 'destination-out'
      g.globalAlpha = Math.min(0.08, dt * GHOST_FADE_RATE)
      g.fillStyle = '#000'
      g.fillRect(0, 0, w, h)
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = GHOST_ALPHA
      g.strokeStyle = '#efe9dc'
      g.lineWidth = 1
      g.lineJoin = 'round'
      if (gActive) {
        const sc = m * 0.36
        const cx0 = w / 2
        const cy0 = h / 2
        for (let i = 0; i < 3; i++) {
          const e1 = Math.exp(-gCurve.d1 * gT)
          const e2 = Math.exp(-gCurve.d2 * gT)
          const e3 = Math.exp(-gCurve.d3 * gT)
          const e4 = Math.exp(-gCurve.d4 * gT)
          const x =
            cx0 +
            sc *
              (gCurve.ax1 * Math.sin(gCurve.f1 * gT + gCurve.p1) * e1 +
                gCurve.ax2 * Math.sin(gCurve.f2 * gT + gCurve.p2) * e2)
          const y =
            cy0 +
            sc *
              (gCurve.ay1 * Math.sin(gCurve.f3 * gT + gCurve.p3) * e3 +
                gCurve.ay2 * Math.sin(gCurve.f4 * gT + gCurve.p4) * e4)
          if (gPenDown) {
            g.beginPath()
            g.moveTo(gPenX, gPenY)
            g.lineTo(x, y)
            g.stroke()
          }
          gPenX = x
          gPenY = y
          gPenDown = true
          gT += gDt
          if (gT >= GHOST_T_END) {
            gActive = false
            gNext = T + 2.6
            break
          }
        }
      } else if (T >= gNext) {
        newGhost(gCurve)
        gT = 0
        gActive = true
        gPenDown = false // 新曲线起笔不与旧曲线连线
      }
    }

    // ---------- 暗噪场微闪 ----------
    const flX = new Float32Array(FLICKER_N)
    const flY = new Float32Array(FLICKER_N)
    const flA = new Float32Array(FLICKER_N)
    const flLife = new Float32Array(FLICKER_N)
    const flC = new Uint8Array(FLICKER_N)

    const flickerTick = (dt: number): void => {
      for (let i = 0; i < FLICKER_N; i++) {
        flLife[i] -= dt
        if (flLife[i] <= 0) {
          flX[i] = Math.random() * w
          flY[i] = Math.random() * h
          flA[i] = 0.012 + Math.random() * 0.038
          flLife[i] = 0.05 + Math.random() * 0.35
          flC[i] = Math.random() < 0.62 ? 0 : 1
        }
      }
    }

    const flickerDraw = (): void => {
      for (let i = 0; i < FLICKER_N; i++) {
        ctx.globalAlpha = flA[i] * (0.35 + 0.65 * Math.abs(Math.sin(T * 31 + i * 12.9)))
        ctx.fillStyle = flC[i] === 0 ? '#efe9ff' : '#b7a4ff'
        ctx.fillRect(flX[i], flY[i], 1, 1)
      }
    }

    // ---------- 音频：眼压嗡鸣 ----------
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let droneGain: GainNode | null = null
    let lfoGain: GainNode | null = null
    let audioReady = false
    const hGains: GainNode[] = []

    const initAudio = (): void => {
      if (ac || disposed) return
      try {
        const A = new AudioContext()
        ac = A
        master = A.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(A.destination)
        const lp = A.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 640
        lp.Q.value = 0.4
        lp.connect(master)
        // 基底：双失谐正弦 110 / 110.7 Hz
        droneGain = A.createGain()
        droneGain.gain.value = 0
        droneGain.connect(lp)
        const mkDrone = (f: number): void => {
          const o = A.createOscillator()
          o.type = 'sine'
          o.frequency.value = f
          o.connect(droneGain as GainNode)
          o.start()
        }
        mkDrone(110)
        mkDrone(110.7)
        // 整数比高位泛音列 2f 3f 5f 7f（各自独立增益，微颤 LFO 挂 7f）
        const mkHarm = (f: number): GainNode => {
          const o = A.createOscillator()
          o.type = 'sine'
          o.frequency.value = f
          const gn = A.createGain()
          gn.gain.value = 0
          o.connect(gn)
          gn.connect(lp)
          o.start()
          return gn
        }
        hGains.push(mkHarm(220), mkHarm(330), mkHarm(550), mkHarm(770))
        const lfo = A.createOscillator()
        lfo.type = 'sine'
        lfo.frequency.value = 6.4
        lfoGain = A.createGain()
        lfoGain.gain.value = 0
        lfo.connect(lfoGain)
        lfoGain.connect(hGains[3].gain)
        lfo.start()
        audioReady = true
      } catch {
        ac = null
        master = null
        droneGain = null
        lfoGain = null
        hGains.length = 0
        audioReady = false
      }
    }

    /** 轻点 pop：短促下滑音 */
    const pop = (): void => {
      if (!ac || !master || muted) return
      const A = ac
      const t = A.currentTime
      const o = A.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(640, t)
      o.frequency.exponentialRampToValueAtTime(150, t + 0.09)
      const g = A.createGain()
      g.gain.setValueAtTime(0.15, t)
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.12)
      o.connect(g)
      g.connect(master)
      o.start(t)
      o.stop(t + 0.13)
    }

    /** 按压闷响（眼压感） */
    const thump = (): void => {
      if (!ac || !master || muted) return
      const A = ac
      const t = A.currentTime
      const o = A.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(120, t)
      o.frequency.exponentialRampToValueAtTime(46, t + 0.1)
      const g = A.createGain()
      g.gain.setValueAtTime(0.085, t)
      g.gain.exponentialRampToValueAtTime(0.0006, t + 0.14)
      o.connect(g)
      g.connect(master)
      o.start(t)
      o.stop(t + 0.15)
    }

    // ---------- 视像更新 ----------
    let aI = 0
    let aI2 = 0
    let aI3 = 0

    const updateVisions = (dt: number): void => {
      let ti = 0
      let ti2 = 0
      let ti3 = 0
      for (let i = vs.length - 1; i >= 0; i--) {
        const v = vs[i]
        if (v.kind === 1) {
          v.age += dt
          if (v.age >= FLASH_DUR) {
            removeVision(i)
            continue
          }
          ti += (1 - v.age / FLASH_DUR) * 0.4
          continue
        }
        if (v.state === 0) {
          v.hold += dt
          // 弹簧跟随指针（轻微欠阻尼 → 有机的滞后感）
          const k = 90
          const c = 13
          v.vx += ((v.tx - v.cx) * k - v.vx * c) * dt
          v.vy += ((v.ty - v.cy) * k - v.vy * c) * dt
          v.cx += v.vx * dt
          v.cy += v.vy * dt
        } else {
          v.decay += dt / DECAY_DUR
          if (v.decay >= 1) {
            removeVision(i)
            continue
          }
          const damp = Math.exp(-4 * dt)
          v.vx *= damp
          v.vy *= damp
          v.cx += v.vx * dt
          v.cy += v.vy * dt
        }
        v.e1 = smooth(v.hold)
        v.e2 = smooth((v.hold - 1) / 1.5)
        v.e3 = smooth((v.hold - 2.5) / 1.2)
        v.rot += v.rotSpd * v.dir * dt
        let inten = 0.2 * v.e1 + 0.4 * v.e2 + 0.55 * v.e3
        if (v.state === 1) inten *= (1 - v.decay) * (1 - v.decay)
        ti += inten
        const df = v.state === 1 ? 1 - v.decay : 1
        ti2 += v.e2 * df
        ti3 += v.e3 * df
      }
      const s = Math.min(1, dt * 6)
      aI += (ti - aI) * s
      aI2 += (ti2 - aI2) * s
      aI3 += (ti3 - aI3) * s
    }

    const audioTick = (): void => {
      if (!audioReady || !ac || muted) return
      if (ac.state !== 'running') return
      const dg = droneGain
      if (!dg) return
      const t = ac.currentTime
      dg.gain.setTargetAtTime(Math.min(0.3, aI * 0.13), t, 0.12)
      const i2 = Math.min(1, aI2)
      const i3 = Math.min(1, aI3)
      hGains[0].gain.setTargetAtTime(i2 * 0.028, t, 0.15)
      hGains[1].gain.setTargetAtTime(i2 * 0.02, t, 0.15)
      hGains[2].gain.setTargetAtTime(i2 * 0.013, t, 0.15)
      hGains[3].gain.setTargetAtTime(i3 * 0.011, t, 0.15)
      if (lfoGain) lfoGain.gain.setTargetAtTime(i3 * 0.005, t, 0.15)
    }

    // ---------- 蜂窝缓冲（零分配：中心+亮度桶暂存） ----------
    const hexBuf = new Float32Array(HEX_CAP * 3)
    let hexCount = 0

    const strokeArm = (
      cx: number,
      cy: number,
      baseA: number,
      wob: number,
      aa: number,
      thMax: number,
      wobR: number,
      alpha: number,
      width: number,
      color: string,
    ): void => {
      if (alpha < 0.01) return
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.globalAlpha = alpha
      ctx.beginPath()
      const SEG = 30
      for (let i = 0; i <= SEG; i++) {
        const th = (thMax * i) / SEG
        const r = aa * th + Math.sin(th * 2.6 + wob + T * 0.5) * wobR
        const ang = baseA + th
        const x = cx + Math.cos(ang) * r
        const y = cy + Math.sin(ang) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // ---------- 视像绘制 ----------
    const drawVision = (v: Vision): void => {
      const e1 = v.e1
      const e2 = v.e2
      const e3 = v.e3
      let alphaMul = 1
      let invert = 0
      let bulge = 1
      if (v.state === 1) {
        const d = v.decay
        alphaMul = (1 - d) * (1 - d)
        invert = smooth(d * 1.5)
        bulge = 1 + 0.16 * Math.sin(Math.PI * Math.min(1, d * 1.1))
      }
      let R = m * (0.1 + Math.min(v.hold, 7) * 0.055)
      R = Math.min(R, m * 0.62) * bulge
      if (R < 2) R = 2

      // 快速移动 → 沿速度方向拉长畸变（拖影）
      const spd = Math.sqrt(v.vx * v.vx + v.vy * v.vy)
      const st = Math.min(0.85, spd / 1600)
      ctx.save()
      if (st > 0.02) {
        const ang = Math.atan2(v.vy, v.vx)
        ctx.translate(v.cx, v.cy)
        ctx.rotate(ang)
        ctx.scale(1 + st, 1 / (1 + st * 0.45))
        ctx.rotate(-ang)
        ctx.translate(-v.cx, -v.cy)
      }

      // 环境光晕（白热→琥珀→紫晕 径向三段；残像时切反转贴图）
      const haloA = (0.34 * e1 + 0.2 * e2 + 0.3 * e3 + 0.12) * alphaMul
      const hr = R * 1.2
      if (haloA > 0.01) {
        if (invert < 0.98) {
          ctx.globalAlpha = haloA * (1 - invert)
          ctx.drawImage(spHalo, v.cx - hr, v.cy - hr, hr * 2, hr * 2)
        }
        if (invert > 0.02) {
          ctx.globalAlpha = haloA * invert
          ctx.drawImage(spHaloInv, v.cx - hr, v.cy - hr, hr * 2, hr * 2)
        }
      }

      // 蜂窝六角网格（阶段三）：蔓延半径∝时长，波次脉冲发亮
      if (e3 > 0.015) {
        const diag = Math.sqrt(w * w + h * h)
        const spreadCap = Math.min(m * 0.66, diag * 0.5)
        const spread = Math.min(spreadCap, m * (0.16 + Math.max(0, v.hold - 2.5) * 0.13))
        const s = Math.max(11, Math.min(24, m * 0.05))
        const maxRing = Math.min(26, Math.floor(spread / (s * 0.95)))
        if (maxRing >= 1) {
          const wSpan = spread + s * 2
          const wSpeed = m * 0.22
          const w1 = (T * wSpeed + v.seed * 13) % wSpan
          const w2 = (T * wSpeed * 0.7 + v.seed * 7 + wSpan * 0.5) % wSpan
          hexCount = 0
          for (let q = -maxRing; q <= maxRing; q++) {
            for (let r2 = -maxRing; r2 <= maxRing; r2++) {
              const ring = (Math.abs(q) + Math.abs(r2) + Math.abs(q + r2)) / 2
              if (ring > maxRing) continue
              const hx = v.cx + s * 1.7320508 * (q + r2 * 0.5)
              const hy = v.cy + s * 1.5 * r2
              if (hx < -s * 2 || hx > w + s * 2 || hy < -s * 2 || hy > h + s * 2) continue
              const dx = hx - v.cx
              const dy = hy - v.cy
              const d = Math.sqrt(dx * dx + dy * dy)
              let b = e3 * 0.13
              const dw1 = (d - w1) / (s * 1.25)
              b += 0.85 * Math.exp(-dw1 * dw1)
              const dw2 = (d - w2) / (s * 1.5)
              b += 0.6 * Math.exp(-dw2 * dw2)
              // 生长前锋边缘淡出
              b *= 1 - clamp01((d - spread + s) / (s * 2.2))
              if (b < 0.03 || hexCount >= HEX_CAP) continue
              hexBuf[hexCount * 3] = hx
              hexBuf[hexCount * 3 + 1] = hy
              hexBuf[hexCount * 3 + 2] = b > 0.75 ? 3 : b > 0.42 ? 2 : b > 0.2 ? 1 : 0
              hexCount++
            }
          }
          // 亮度桶批量描边（4 桶 × 正常/反转两遍）
          ctx.lineWidth = 1
          for (let b2 = 0; b2 < 4; b2++) {
            const aN = HEX_A[b2] * alphaMul * (1 - invert)
            if (aN > 0.012) {
              ctx.strokeStyle = HEX_C[b2]
              ctx.globalAlpha = aN
              ctx.beginPath()
              for (let i2 = 0; i2 < hexCount; i2++) {
                if (hexBuf[i2 * 3 + 2] !== b2) continue
                const hx = hexBuf[i2 * 3]
                const hy = hexBuf[i2 * 3 + 1]
                ctx.moveTo(hx + HUX[0] * s, hy + HUY[0] * s)
                for (let vi = 1; vi < 6; vi++) ctx.lineTo(hx + HUX[vi] * s, hy + HUY[vi] * s)
                ctx.closePath()
              }
              ctx.stroke()
            }
            const aIv = HEX_A[b2] * alphaMul * invert
            if (aIv > 0.012) {
              ctx.strokeStyle = HEX_INV[b2]
              ctx.globalAlpha = aIv
              ctx.beginPath()
              for (let i2 = 0; i2 < hexCount; i2++) {
                if (hexBuf[i2 * 3 + 2] !== b2) continue
                const hx = hexBuf[i2 * 3]
                const hy = hexBuf[i2 * 3 + 1]
                ctx.moveTo(hx + HUX[0] * s, hy + HUY[0] * s)
                for (let vi = 1; vi < 6; vi++) ctx.lineTo(hx + HUX[vi] * s, hy + HUY[vi] * s)
                ctx.closePath()
              }
              ctx.stroke()
            }
          }
        }
      }

      // 螺旋臂（阶段二起）：涟漪扭曲成 r = a·θ + 噪声
      if (e2 > 0.015) {
        const armN = 2 + Math.floor(hash(v.seed * 2.3) * 2.99)
        const thMax = 1.1 + 3.4 * e2
        const aa = R / thMax
        for (let a2 = 0; a2 < armN; a2++) {
          const baseA = (a2 / armN) * TAU + v.rot * 0.7
          const wob = hash(v.seed + a2 * 29.3) * TAU
          // 紫晕宽笔
          strokeArm(v.cx, v.cy, baseA, wob, aa, thMax, R * 0.055, 0.1 * e2 * alphaMul * (1 - invert), 3, RAMP[3])
          // 琥珀芯线
          strokeArm(v.cx, v.cy, baseA, wob, aa, thMax, R * 0.055, 0.3 * e2 * alphaMul * (1 - invert), 1.2, RAMP[1])
          if (invert > 0.02) {
            strokeArm(v.cx, v.cy, baseA, wob, aa, thMax, R * 0.055, 0.28 * e2 * alphaMul * invert, 1.4, INV_RAMP[1])
          }
        }
      }

      // 同心涟漪环（阶段一；阶段二被螺旋逐渐取代）
      const ringBase = 0.42 * e1 * (1 - 0.45 * e2) * alphaMul
      if (ringBase > 0.012) {
        ctx.lineWidth = 1.1
        let acc = 0
        for (let k = 0; k < 8; k++) {
          acc += R * 0.16 * (0.72 + 0.55 * hash(v.seed + k * 7.3))
          if (acc > R * 0.98) break
          // 向外流动的相位：涟漪自中心荡出
          const ph = (T * 0.32 + hash(v.seed + k * 3.1)) % 1
          const r = acc * (0.55 + 0.75 * ph)
          if (r > R) continue
          const frac = r / R
          const a = ringBase * Math.sin(Math.PI * ph) * (1 - 0.5 * frac) * (0.55 + 0.45 * Math.sin(T * 1.9 + hash(v.seed * 1.7 + k) * TAU))
          if (a < 0.012) continue
          const idx = frac < 0.3 ? 0 : frac < 0.55 ? 1 : frac < 0.8 ? 2 : 3
          if (a * (1 - invert) > 0.01) {
            ctx.strokeStyle = RAMP[idx]
            ctx.globalAlpha = a * (1 - invert)
            ctx.beginPath()
            ctx.arc(v.cx, v.cy, Math.max(0.1, r), 0, TAU)
            ctx.stroke()
          }
          if (a * invert > 0.01) {
            ctx.strokeStyle = INV_RAMP[idx]
            ctx.globalAlpha = a * invert
            ctx.beginPath()
            ctx.arc(v.cx, v.cy, Math.max(0.1, r), 0, TAU)
            ctx.stroke()
          }
        }
      }

      // 放射辐条（阶段二）：自中心长出，缓慢旋转
      if (e2 > 0.015) {
        ctx.lineWidth = 1.2
        const r0 = R * 0.09
        for (let i = 0; i < v.spokes; i++) {
          const h1 = hash(v.seed * 3.1 + i * 17.7)
          const h2 = hash(v.seed * 5.7 + i * 11.3)
          const ang = (i / v.spokes) * TAU + v.rot
          const L = R * (0.32 + 0.5 * h1) * (0.3 + 0.7 * e2)
          const r1 = r0 + L
          const frac = r1 / R
          const idx = frac < 0.45 ? 1 : 2
          const a = e2 * alphaMul * (0.1 + 0.15 * h2)
          const ca = Math.cos(ang)
          const sa = Math.sin(ang)
          if (a * (1 - invert) > 0.01) {
            ctx.strokeStyle = RAMP[idx]
            ctx.globalAlpha = a * (1 - invert)
            ctx.beginPath()
            ctx.moveTo(v.cx + ca * r0, v.cy + sa * r0)
            ctx.lineTo(v.cx + ca * r1, v.cy + sa * r1)
            ctx.stroke()
          }
          if (a * invert > 0.01) {
            ctx.strokeStyle = INV_RAMP[idx]
            ctx.globalAlpha = a * invert
            ctx.beginPath()
            ctx.moveTo(v.cx + ca * r0, v.cy + sa * r0)
            ctx.lineTo(v.cx + ca * r1, v.cy + sa * r1)
            ctx.stroke()
          }
        }
      }

      // 细丝状条纹（阶段三）：漂浮的细亮线（玻璃体混浊）
      if (e3 > 0.015) {
        ctx.lineWidth = 1
        for (let f = 0; f < v.filN; f++) {
          const o = f * 6
          const fx = v.cx + v.filA[o] * R * 0.85 + Math.sin(T * v.filA[o + 5] + v.filA[o + 2]) * m * 0.02
          const fy = v.cy + v.filA[o + 1] * R * 0.85 + Math.cos(T * v.filA[o + 5] * 0.8 + v.filA[o + 2] * 1.3) * m * 0.018
          const ang = v.filA[o + 3] + Math.sin(T * 0.25 + v.filA[o + 2]) * 0.35
          const len = m * v.filA[o + 4] * (0.7 + 0.3 * e3)
          const a = e3 * alphaMul * 0.13 * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * (0.8 + v.filA[o + 5]) + v.filA[o + 2] * 2)))
          if (a < 0.01) continue
          const dx = Math.cos(ang) * len
          const dy = Math.sin(ang) * len
          const off = Math.sin(T * 0.6 + v.filA[o + 2] * 3) * len * 0.35
          ctx.strokeStyle = HOT
          ctx.globalAlpha = a * (1 - invert * 0.45)
          ctx.beginPath()
          ctx.moveTo(fx - dx, fy - dy)
          ctx.quadraticCurveTo(
            fx + Math.cos(ang + 1.57) * off,
            fy + Math.sin(ang + 1.57) * off,
            fx + dx,
            fy + dy,
          )
          ctx.stroke()
        }
      }

      // 白热核心（最后画，压在最亮）
      const pulse = 1 + 0.18 * Math.sin(T * 6.3 + v.seed)
      const coreR = m * (0.018 + 0.045 * e1 + 0.02 * e2) * pulse * bulge
      if (coreR > 1) {
        ctx.globalAlpha = 0.9 * alphaMul
        ctx.drawImage(spCore, v.cx - coreR, v.cy - coreR, coreR * 2, coreR * 2)
      }
      if (v.state === 0) {
        ctx.globalAlpha = 0.9 * alphaMul
        ctx.fillStyle = HOT
        ctx.beginPath()
        ctx.arc(v.cx, v.cy, 1.4 + 1.2 * e1, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    }

    /** 轻点闪光：400ms 小型阶段一绽放 */
    const drawFlash = (v: Vision): void => {
      const pr = v.age / FLASH_DUR
      const grow = Math.min(1, v.age / 0.16)
      const eo = 1 - (1 - grow) * (1 - grow)
      const R = m * (0.05 + 0.12 * eo)
      const a = (1 - pr) * (1 - pr)
      ctx.globalAlpha = 0.5 * a
      ctx.drawImage(spHalo, v.cx - R * 1.2, v.cy - R * 1.2, R * 2.4, R * 2.4)
      const cr = m * 0.035 * (0.6 + 0.4 * eo)
      if (cr > 1) {
        ctx.globalAlpha = 0.9 * a
        ctx.drawImage(spCore, v.cx - cr, v.cy - cr, cr * 2, cr * 2)
      }
      ctx.lineWidth = 1.3
      for (let k = 0; k < 3; k++) {
        const rr = R * (0.45 + 0.3 * k) * (0.6 + 0.4 * eo)
        ctx.globalAlpha = a * (0.5 - 0.13 * k)
        ctx.strokeStyle = k === 0 ? RAMP[0] : k === 1 ? RAMP[1] : RAMP[2]
        ctx.beginPath()
        ctx.arc(v.cx, v.cy, Math.max(0.1, rr), 0, TAU)
        ctx.stroke()
      }
    }

    // ---------- 空闲层 ----------
    const breathDraw = (): void => {
      const cx0 = w / 2
      const cy0 = h / 2
      const rr = m * (0.3 + 0.03 * Math.sin(T * 1.21))
      const a = 0.05 + 0.06 * (0.5 + 0.5 * Math.sin(T * 1.21 + 0.9))
      ctx.strokeStyle = AMBER
      ctx.lineWidth = 1.2
      ctx.globalAlpha = a
      ctx.beginPath()
      ctx.arc(cx0, cy0, rr, 0, TAU)
      ctx.stroke()
    }

    const render = (): void => {
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineJoin = 'round'
      // 幽灵曲线：持久层一次性合成
      if (gCtx) {
        ctx.globalAlpha = 1
        ctx.drawImage(gCv, 0, 0, w, h)
      }
      flickerDraw()
      breathDraw()
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i]
        if (v.kind === 1) drawFlash(v)
        else drawVision(v)
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
      last = now
      if (!valid) return
      T += dt
      ghostTick(dt)
      flickerTick(dt)
      updateVisions(dt)
      audioTick()
      render()
    }

    // ---------- 尺寸 ----------
    const resize = (): void => {
      const rect = root.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gCv.width = canvas.width
      gCv.height = canvas.height
      if (gCtx) {
        gCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
        gCtx.clearRect(0, 0, w, h)
      }
      gPenDown = false
      m = Math.min(w, h)
      valid = w >= 40 && h >= 40
      if (!running && valid) render()
    }

    // ---------- 指针 ----------
    const toLocalX = (e: PointerEvent): number => e.clientX - canvas.getBoundingClientRect().left
    const toLocalY = (e: PointerEvent): number => e.clientY - canvas.getBoundingClientRect().top

    const onPointerDown = (e: PointerEvent): void => {
      initAudio()
      if (ac && ac.state === 'suspended') void ac.resume()
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* 指针已消失时忽略 */
      }
      spawnVision(toLocalX(e), toLocalY(e), e.pointerId, e.timeStamp || performance.now())
      thump()
    }

    const onPointerMove = (e: PointerEvent): void => {
      const px = toLocalX(e)
      const py = toLocalY(e)
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i]
        if (v.kind === 0 && v.state === 0 && v.pointerId === e.pointerId) {
          v.tx = px
          v.ty = py
        }
      }
    }

    const onPointerUp = (e: PointerEvent): void => {
      const px = toLocalX(e)
      const py = toLocalY(e)
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i]
        if (v.kind === 0 && v.state === 0 && v.pointerId === e.pointerId) {
          const dur = (e.timeStamp || performance.now()) - v.downT
          const moved = Math.hypot(px - v.downX, py - v.downY)
          if (dur < 300 && moved < 10) {
            // 快速轻点 → 小型闪光绽放
            removeVision(i)
            spawnFlash(px, py)
            pop()
          } else {
            v.state = 1
            v.decay = 0
          }
          return
        }
      }
    }

    const onPointerCancel = (e: PointerEvent): void => {
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i]
        if (v.kind === 0 && v.state === 0 && v.pointerId === e.pointerId) {
          v.state = 1
          v.decay = 0
          return
        }
      }
    }

    const onContextMenu = (e: Event): void => {
      e.preventDefault()
    }

    // ---------- 启停 ----------
    const start = (): void => {
      if (disposed || running) return
      running = true
      last = performance.now()
      if (ac && ac.state === 'suspended') void ac.resume()
      raf = requestAnimationFrame(frame)
    }
    const stop = (): void => {
      running = false
      // 翻页离开 = 手指已离开：所有按住中的视像转入残像衰变
      for (let i = 0; i < vs.length; i++) {
        if (vs[i].kind === 0 && vs[i].state === 0) {
          vs[i].state = 1
          vs[i].decay = 0
        }
      }
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      if (ac && ac.state === 'running') void ac.suspend()
    }
    ctrlRef.current = { start, stop }

    // ---------- 挂载 ----------
    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('contextmenu', onContextMenu)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05)
    })

    return () => {
      disposed = true
      running = false
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      unsubMute()
      if (ac) {
        void ac.close()
        ac = null
      }
      master = null
      droneGain = null
      lfoGain = null
      hGains.length = 0
      audioReady = false
      ctrlRef.current = null
    }
  }, [])

  useEffect(() => {
    const ctrl = ctrlRef.current
    if (!ctrl) return
    if (active) ctrl.start()
    else ctrl.stop()
  }, [active])

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: BG }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />

      {/* 极暗暗角呼吸（4s 周期） */}
      <div
        className="phosphene-vignette pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 78% 74% at 50% 50%, transparent 52%, rgba(0,0,0,0.52) 100%)',
        }}
        aria-hidden
      />

      {/* 左上铭牌 */}
      <div
        className="pointer-events-none absolute z-10 flex flex-col"
        style={{ left: '6.5%', top: '5.5%', gap: '0.7cqh' }}
        aria-hidden
      >
        <div className="flex items-baseline" style={{ gap: '0.8em' }}>
          <span
            className="font-attitude"
            style={{ fontSize: 'clamp(9px, 1.5cqw, 12px)', letterSpacing: '0.3em', color: 'rgba(255,176,58,0.62)' }}
          >
            PHOSPHENE
          </span>
          <span
            className="font-cn"
            style={{ fontSize: 'clamp(9px, 1.5cqw, 12px)', letterSpacing: '0.3em', color: 'rgba(255,176,58,0.62)' }}
          >
            · 磷光
          </span>
        </div>
        <div className="flex items-baseline" style={{ gap: '0.8em' }}>
          <span
            className="font-cn"
            style={{ fontSize: 'clamp(7px, 1.15cqw, 10px)', letterSpacing: '0.34em', color: 'rgba(255,176,58,0.36)' }}
          >
            闭眼视像
          </span>
          <span
            className="font-attitude"
            style={{ fontSize: 'clamp(7px, 1.15cqw, 10px)', letterSpacing: '0.34em', color: 'rgba(255,176,58,0.36)' }}
          >
            EIDETIC FIELD
          </span>
        </div>
      </div>

      {/* 右上小字 */}
      <div
        className="font-cn pointer-events-none absolute z-10"
        style={{
          right: '13%',
          top: '5.5%',
          fontSize: 'clamp(8px, 1.3cqw, 11px)',
          letterSpacing: '0.42em',
          color: 'rgba(255,176,58,0.42)',
          whiteSpace: 'nowrap',
        }}
        aria-hidden
      >
        按住 · 压出闭眼之光
      </div>

      {/* 署名：竖排（近右上，避开左右 10% 热区与角部页码徽章） */}
      <div
        className="pointer-events-none absolute z-10 flex items-start"
        style={{ right: '12.6%', top: '11.5%', gap: '0.55cqw' }}
        aria-hidden
      >
        <span
          className="font-attitude"
          style={{
            writingMode: 'vertical-rl',
            fontSize: 'clamp(7px, 1.05cqw, 10px)',
            letterSpacing: '0.4em',
            color: 'rgba(242,239,233,0.3)',
          }}
        >
          PHOSPHENE
        </span>
        <span
          className="font-cn"
          style={{
            writingMode: 'vertical-rl',
            fontSize: 'clamp(12px, 2cqw, 19px)',
            letterSpacing: '0.42em',
            color: 'rgba(255,176,58,0.5)',
          }}
        >
          磷光
        </span>
      </div>

      {/* 底部居中提示 */}
      <div
        className="font-cn pointer-events-none absolute inset-x-0 z-10 text-center"
        style={{
          bottom: '3.6%',
          fontSize: 'clamp(8px, 1.4cqw, 12px)',
          letterSpacing: '0.5em',
          color: 'rgba(242,239,233,0.4)',
          whiteSpace: 'nowrap',
        }}
        aria-hidden
      >
        按住 · 闭眼之光 — 移动 · 牵引视像
      </div>

      <style>{`
        @keyframes phosphene-vig {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.86; }
        }
        .phosphene-vignette { animation: phosphene-vig 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .phosphene-vignette { animation: none; }
        }
      `}</style>
    </div>
  )
}
