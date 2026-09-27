'use client'

/**
 * ROOM 06 · ORBIT 引力剧场 —— STELLAR BIOME 星之群落
 * 一座活着的恒星系剧场：
 *   · 分层恒星：白热核心 sprite + 双层反向旋转的日冕辐条（additive）+ 呼吸脉动（±4%）
 *     + 每 6–11s 一次「日珥」（贝塞尔物质弧喷发回落）；吞行星时冲击环 + 星体增亮。
 *   · 行星生物群系：岩岩（陨坑）/ 熔岩（发光裂缝+余烬）/ 冰晶（斜向高光条纹）/
 *     气巨（条纹带+扁率+卫星）/ 环行星（椭圆环前后遮挡），各自离屏 sprite，专属色相渐隐尾迹。
 *   · 彗星事件：每 15–25s 一颗双曲线掠过恒星（长尾 200+ 粒子，暖白→琥珀），
 *     掠过时轻微扰动行星；whoosh 随横移声相。
 *   · 碰撞：行星互撞 → 碎屑爆裂 + 闪光环 + 600ms 内被幸存行星吸回并合而更大；
 *     坠星 → 吸收冲击环 + 恒星脉动增幅 + whoomp 低音。
 * 交互（保留）：空白处按下拖动 → 弹弓瞄准（橡皮筋 + 110 步风险变色预测 + 速度读数），
 * 松手发射；快速点击 → 静止行星坠落；发射 ≥3 颗 → 通关（clearRoom(6)）。
 * 调色：深空 #0c0a09 / 恒星 #ffb347 / 暖色行星群 + 冰晶冷点缀。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/* ---------------- 调色与常量 ---------------- */
const BG = '#0c0a09'
const STAR_GOLD = '#ffb347'
const TAU = Math.PI * 2
const MAX_PLANETS = 36
const TRAIL_CAP = 44
const LAUNCH_K = 1.9 // 拖拽向量 → 发射速度
const PART_MAX = 480 // 粒子池（彗尾 / 余烬 / 碎屑 / 日珥火花）
const RING_MAX = 10 // 冲击环池
const FONT_SM = '9px "Space Mono", ui-monospace, monospace'

type PKind = 0 | 1 | 2 | 3 | 4 // 0 岩岩 1 熔岩 2 冰晶 3 气巨 4 环行星

const ROCKY_BASE: readonly [number, number, number] = [181, 122, 74]
const MOLTEN_BASE: readonly [number, number, number] = [255, 145, 50]
const ICE_BASE: readonly [number, number, number] = [176, 208, 226]
const RINGED_BASE: readonly [number, number, number] = [232, 212, 168]
const GAS_FAMILIES: readonly (readonly (readonly [number, number, number])[])[] = [
  [[226, 182, 122], [198, 150, 96], [240, 210, 162], [174, 126, 82]], // 暖砂金
  [[228, 166, 150], [196, 126, 114], [242, 198, 180], [168, 102, 94]], // 绛红
  [[160, 182, 194], [126, 150, 166], [188, 208, 218], [100, 126, 144]], // 青灰
]

/** 彗尾 / 火花调色：暖白 → 琥珀（8 阶查找表，渲染循环零拼串） */
const TAIL_PAL: readonly string[] = buildPal(8, [255, 246, 228], [255, 156, 60])
/** 余烬调色：亮橙 → 深红（6 阶） */
const EMBER_PAL: readonly string[] = buildPal(6, [255, 192, 96], [176, 44, 12])

interface Planet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  kind: PKind
  fam: number // 气巨色族（0-2）
  seed: number // sprite 细节种子（resize 重建保持一致）
  rgb: [number, number, number]
  col: string // 主色（碎屑 / 箭头 / 兜底圆）
  trailCol: string // 尾迹色
  tx: Float32Array // 尾迹环形缓冲
  ty: Float32Array
  th: number
  tn: number
  spr: HTMLCanvasElement | null
  sw: number
  sh: number
  moonA: number
  moonSpd: number
  moonD: number
  moonSz: number
  ringRot: number
  emb: number // 余烬发射累积
  mergeUntil: number // 碰撞合并窗口（碎屑回吸）
  age: number // 存活秒数（轨道维持微调的软超入条件）
  flut: number // 彗星掠过：尾迹吹拂强度（纯视觉）
  flutDx: number
  flutDy: number
}

interface PlanetSpec {
  kind: PKind
  fam: number
  seed: number
  rgb: [number, number, number]
  col: string // 主色（箭头 / 兜底圆）
  r: number
  ringRot: number
  spr: HTMLCanvasElement | null
  sw: number
  sh: number
}

/** 粒子共池：0 彗尾 · 1 余烬 · 2 碎屑（回吸） · 3 日珥火花 */
interface Part {
  on: boolean
  kind: 0 | 1 | 2 | 3
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  col: string
  drag: number
  home: Planet | null
}

interface ShockRing {
  on: boolean
  x: number
  y: number
  t0: number
  dur: number
  r0: number
  r1: number
  w: number
  col: string
}

interface Twin {
  x: number
  y: number
  r: number
  a: number
  ph: number
  sp: number
}

interface Aim {
  active: boolean
  x0: number
  y0: number
  x: number
  y: number
  t0: number
  spec: PlanetSpec | null
}

/* ---------------- 小工具 ---------------- */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function cl255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

function rgbStr(c: readonly [number, number, number]): string {
  return `rgb(${cl255(c[0])},${cl255(c[1])},${cl255(c[2])})`
}

/** 提亮/压暗（暖通道敏感度略低） */
function tone(c: readonly [number, number, number], amt: number): [number, number, number] {
  return [cl255(c[0] + amt), cl255(c[1] + amt * 0.9), cl255(c[2] + amt * 0.7)]
}

function jitter(c: readonly [number, number, number], amt: number): [number, number, number] {
  const d = (Math.random() * 2 - 1) * amt
  return [cl255(c[0] + d), cl255(c[1] + d * 0.75), cl255(c[2] + d * 0.5)]
}

function buildPal(n: number, a: readonly [number, number, number], b: readonly [number, number, number]): string[] {
  const arr: string[] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1)
    arr.push(
      `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`,
    )
  }
  return arr
}

/** 确定性随机（sprite 细节重建一致） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickKind(): PKind {
  const v = Math.random()
  if (v < 0.22) return 0
  if (v < 0.42) return 1
  if (v < 0.6) return 2
  if (v < 0.78) return 3
  return 4
}

function pickPlanetColor(kind: PKind): [number, number, number] {
  switch (kind) {
    case 0:
      return jitter(ROCKY_BASE, 20)
    case 1:
      return jitter(MOLTEN_BASE, 16)
    case 2:
      return jitter(ICE_BASE, 12)
    case 3:
      return jitter(GAS_FAMILIES[Math.floor(Math.random() * GAS_FAMILIES.length)][1], 12)
    default:
      return jitter(RINGED_BASE, 12)
  }
}

function radiusFor(kind: PKind, sc: number): number {
  switch (kind) {
    case 0:
      return (3.4 + Math.random() * 1.8) * sc
    case 1:
      return (3.6 + Math.random() * 1.9) * sc
    case 2:
      return (3.2 + Math.random() * 1.6) * sc
    case 3:
      return (6.8 + Math.random() * 2.6) * sc
    default:
      return (3.8 + Math.random() * 1.7) * sc
  }
}

/* ============================================================ */

export default function Art06({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bodiesRef = useRef<HTMLSpanElement | null>(null)
  const launchesRef = useRef<HTMLSpanElement | null>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const rootMaybe = rootRef.current
    const canvasMaybe = canvasRef.current
    if (!rootMaybe || !canvasMaybe) return
    const root: HTMLDivElement = rootMaybe
    const canvas: HTMLCanvasElement = canvasMaybe
    const ctxMaybe = canvas.getContext('2d')
    if (!ctxMaybe) return
    const ctx: CanvasRenderingContext2D = ctxMaybe
    const bodiesEl = bodiesRef.current
    const launchesEl = launchesRef.current

    /* -------- 引擎状态 -------- */
    let W = 0
    let H = 0
    let dpr = 1
    let scale = 1
    let GM = 5.2e6
    let running = false
    let disposed = false
    let raf = 0
    let last = 0
    let nowT = 0
    let seeded = false
    let emptyFor = 0 // 空场计时（自愈重播）
    let launches = 0
    let lastBodies = -1
    let lastLaunchShown = -1
    let lastSpeedShown = -1
    let emaDt = 16
    let degraded = false // 一次性降级（软渲染保护）

    const star = {
      x: 0, y: 0, r: 26,
      pulse: 0, boost: 0,
      pfOn: false, pfT0: 0, pfAng: 0, pfLen: 0, pfNext: 7,
    }
    let corA = 0 // 日冕 A 旋转角
    let corB = 0 // 日冕 B 旋转角（反向）

    const planets: Planet[] = []
    const guides: number[] = []
    const twins: Twin[] = []
    const comet = { on: false, x: 0, y: 0, vx: 0, vy: 0, timer: 8, acc: 0 }
    const aim: Aim = { active: false, x0: 0, y0: 0, x: 0, y: 0, t0: 0, spec: null }
    const vel = { vx: 0, vy: 0 } // 复用的发射速度草稿（零分配）
    let speedText = '0 px/s' // 复用的读数字符串（值变化才重写）

    /* -------- 粒子 / 冲击环池 -------- */
    const parts: Part[] = []
    for (let i = 0; i < PART_MAX; i++) {
      parts.push({ on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, col: '', drag: 0, home: null })
    }
    let partCursor = 0
    const rings: ShockRing[] = []
    for (let i = 0; i < RING_MAX; i++) {
      rings.push({ on: false, x: 0, y: 0, t0: 0, dur: 0.6, r0: 0, r1: 1, w: 2, col: 'rgba(255,240,214,0.9)' })
    }

    /* -------- 离屏资源 -------- */
    let bg: HTMLCanvasElement | null = null
    let coreSpr: HTMLCanvasElement | null = null
    let glowSpr: HTMLCanvasElement | null = null
    let corASpr: HTMLCanvasElement | null = null
    let corBSpr: HTMLCanvasElement | null = null
    let moltenGlowSpr: HTMLCanvasElement | null = null
    let cometSpr: HTMLCanvasElement | null = null

    /* -------- 音频（懒创建，muted 订阅） -------- */
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let humGain: GainNode | null = null
    let noiseBuf: AudioBuffer | null = null
    let cometPan: StereoPannerNode | null = null
    let cometPanTimer = 0
    let muted = useBookStore.getState().muted

    const HUM_BASE = 0.02
    const HUM_PER = 0.0015

    function initAudio(): void {
      if (ac || disposed) return
      try {
        const ctxA = new AudioContext()
        ac = ctxA
        master = ctxA.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(ctxA.destination)
        // 噪声缓冲（0.6s，一次性）
        const len = Math.floor(ctxA.sampleRate * 0.6)
        const buf = ctxA.createBuffer(1, len, ctxA.sampleRate)
        const d = buf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
        noiseBuf = buf
        // 深空嗡鸣：40Hz 双失谐正弦（拍频 ~0.8Hz），音量随行星数
        humGain = ctxA.createGain()
        humGain.gain.value = 0
        humGain.connect(master)
        const h1 = ctxA.createOscillator()
        h1.type = 'sine'
        h1.frequency.value = 40
        const h2 = ctxA.createOscillator()
        h2.type = 'sine'
        h2.frequency.value = 40.8
        h1.connect(humGain)
        h2.connect(humGain)
        h1.start()
        h2.start()
        void ctxA.resume()
        humGain.gain.setTargetAtTime(HUM_BASE + Math.min(planets.length, 26) * HUM_PER, ctxA.currentTime, 0.5)
      } catch {
        ac = null
        master = null
        humGain = null
        noiseBuf = null
      }
    }

    /** 发射 thwip：短噪声 + 方波下滑 */
    function thwip(): void {
      if (!ac || !master || muted || !noiseBuf) return
      const n = ac.currentTime
      const src = ac.createBufferSource()
      src.buffer = noiseBuf
      const bp = ac.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 2400
      bp.Q.value = 1.2
      const g = ac.createGain()
      g.gain.setValueAtTime(0.13, n)
      g.gain.exponentialRampToValueAtTime(0.0001, n + 0.09)
      src.connect(bp)
      bp.connect(g)
      g.connect(master)
      src.start(n)
      src.stop(n + 0.1)
      const o = ac.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(640, n)
      o.frequency.exponentialRampToValueAtTime(160, n + 0.13)
      const og = ac.createGain()
      og.gain.setValueAtTime(0.05, n)
      og.gain.exponentialRampToValueAtTime(0.0001, n + 0.14)
      o.connect(og)
      og.connect(master)
      o.start(n)
      o.stop(n + 0.15)
    }

    /** 吞噬 whoomp：90→38Hz 正弦 + 噪声闷击 */
    function whoomp(): void {
      if (!ac || !master || muted || !noiseBuf) return
      const n = ac.currentTime
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(90, n)
      o.frequency.exponentialRampToValueAtTime(38, n + 0.24)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.34, n)
      g.gain.exponentialRampToValueAtTime(0.0001, n + 0.34)
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + 0.36)
      const src = ac.createBufferSource()
      src.buffer = noiseBuf
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 260
      const ng = ac.createGain()
      ng.gain.setValueAtTime(0.16, n)
      ng.gain.exponentialRampToValueAtTime(0.0001, n + 0.16)
      src.connect(lp)
      lp.connect(ng)
      ng.connect(master)
      src.start(n)
      src.stop(n + 0.18)
    }

    /** 碰撞 crackle：带通噪声爆 + 几个方波 blip */
    function crackle(): void {
      if (!ac || !master || muted || !noiseBuf) return
      const n = ac.currentTime
      const src = ac.createBufferSource()
      src.buffer = noiseBuf
      const bp = ac.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1500
      bp.Q.value = 0.7
      const g = ac.createGain()
      g.gain.setValueAtTime(0.2, n)
      g.gain.exponentialRampToValueAtTime(0.0001, n + 0.17)
      src.connect(bp)
      bp.connect(g)
      g.connect(master)
      src.start(n)
      src.stop(n + 0.18)
      const nBlip = 2 + Math.floor(Math.random() * 2)
      for (let i = 0; i < nBlip; i++) {
        const o = ac.createOscillator()
        o.type = 'square'
        o.frequency.value = 170 + Math.random() * 350
        const og = ac.createGain()
        const t0 = n + i * 0.03 + Math.random() * 0.02
        og.gain.setValueAtTime(0.045, t0)
        og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035)
        o.connect(og)
        og.connect(master)
        o.start(t0)
        o.stop(t0 + 0.04)
      }
    }

    /** 彗星 whoosh：滤波噪声扫频 + 声相随 x */
    function whoosh(): void {
      if (!ac || !master || muted || !noiseBuf) return
      const n = ac.currentTime
      const dur = 2.4
      const src = ac.createBufferSource()
      src.buffer = noiseBuf
      src.loop = true
      const bp = ac.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 1.1
      bp.frequency.setValueAtTime(320, n)
      bp.frequency.exponentialRampToValueAtTime(2400, n + dur * 0.45)
      bp.frequency.exponentialRampToValueAtTime(480, n + dur)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.0001, n)
      g.gain.exponentialRampToValueAtTime(0.15, n + dur * 0.4)
      g.gain.exponentialRampToValueAtTime(0.0001, n + dur)
      src.connect(bp)
      bp.connect(g)
      let tail: AudioNode = g
      if (typeof ac.createStereoPanner === 'function') {
        const pan = ac.createStereoPanner()
        pan.pan.value = 0
        g.connect(pan)
        tail = pan
        cometPan = pan
      }
      tail.connect(master)
      src.start(n)
      src.stop(n + dur + 0.05)
      if (cometPanTimer) window.clearTimeout(cometPanTimer)
      cometPanTimer = window.setTimeout(() => {
        cometPan = null
        cometPanTimer = 0
      }, (dur + 0.2) * 1000)
    }

    /* -------- sprite 构建 -------- */
    function radialSprite(px: number, stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
      const cv = document.createElement('canvas')
      cv.width = px
      cv.height = px
      const c = cv.getContext('2d')
      if (c) {
        const g = c.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
        for (const s of stops) g.addColorStop(s[0], s[1])
        c.fillStyle = g
        c.fillRect(0, 0, px, px)
      }
      return cv
    }

    /** 日冕辐条 sprite：n 根从内圈射出的渐隐三角光芒 */
    function buildCorona(n: number, rBase: number, rVar: number, wAng: number, seed: number): HTMLCanvasElement {
      const px = 224
      const cv = document.createElement('canvas')
      cv.width = px
      cv.height = px
      const c = cv.getContext('2d')
      if (c) {
        c.translate(px / 2, px / 2)
        const R = px / 2 - 2
        const rng = mulberry32(seed)
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + (rng() - 0.5) * 0.22
          const len = R * (rBase + rng() * rVar)
          const r0 = R * 0.3
          const g = c.createLinearGradient(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * len, Math.sin(a) * len)
          g.addColorStop(0, 'rgba(255,205,130,0.6)')
          g.addColorStop(0.5, 'rgba(255,160,70,0.28)')
          g.addColorStop(1, 'rgba(255,140,50,0)')
          c.fillStyle = g
          c.beginPath()
          c.moveTo(Math.cos(a - wAng) * r0, Math.sin(a - wAng) * r0)
          c.lineTo(Math.cos(a) * len, Math.sin(a) * len)
          c.lineTo(Math.cos(a + wAng) * r0, Math.sin(a + wAng) * r0)
          c.closePath()
          c.fill()
        }
      }
      return cv
    }

    function buildStarSprites(): void {
      coreSpr = radialSprite(112, [
        [0, 'rgba(255,250,235,1)'],
        [0.22, 'rgba(255,233,176,1)'],
        [0.5, 'rgba(255,178,86,0.92)'],
        [0.78, 'rgba(255,132,48,0.4)'],
        [1, 'rgba(255,120,40,0)'],
      ])
      glowSpr = radialSprite(160, [
        [0, 'rgba(255,196,120,0.55)'],
        [0.35, 'rgba(255,156,66,0.2)'],
        [0.7, 'rgba(255,130,50,0.07)'],
        [1, 'rgba(255,120,40,0)'],
      ])
      corASpr = buildCorona(13, 0.52, 0.42, 0.075, 11)
      corBSpr = buildCorona(18, 0.4, 0.3, 0.05, 37)
      moltenGlowSpr = radialSprite(64, [
        [0, 'rgba(255,150,60,0.5)'],
        [0.5, 'rgba(255,110,30,0.18)'],
        [1, 'rgba(255,90,20,0)'],
      ])
      cometSpr = radialSprite(48, [
        [0, 'rgba(255,255,250,1)'],
        [0.3, 'rgba(255,236,200,0.85)'],
        [0.65, 'rgba(255,190,110,0.25)'],
        [1, 'rgba(255,170,80,0)'],
      ])
    }

    /** 球面明暗（左上受光 + 右下晨昏线） */
    function shade(c: CanvasRenderingContext2D, R: number, k: number): void {
      const g = c.createRadialGradient(-R * 0.4, -R * 0.4, R * 0.2, 0, 0, R * 1.35)
      g.addColorStop(0, 'rgba(255,246,224,0.14)')
      g.addColorStop(0.55, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(16,8,4,${k})`)
      c.fillStyle = g
      c.fillRect(-R, -R, R * 2, R * 2)
    }

    /** 行星离屏 sprite（3× 超采样；按种子确定性重建） */
    function buildSpriteFor(
      kind: PKind,
      seed: number,
      rgb: readonly [number, number, number],
      r: number,
      fam: number,
    ): { spr: HTMLCanvasElement | null; sw: number; sh: number } {
      const SS = 3
      const px = Math.max(12, Math.ceil(r * 2 * SS))
      const cv = document.createElement('canvas')
      cv.width = px
      cv.height = px
      const c = cv.getContext('2d')
      if (!c) return { spr: null, sw: px / SS, sh: px / SS }
      c.translate(px / 2, px / 2)
      const R = r * SS
      const rng = mulberry32(seed)

      if (kind === 0 || kind === 4) {
        // 岩岩 / 环行星本体：赭石（或淡金）+ 种子陨石坑
        c.save()
        c.beginPath()
        c.arc(0, 0, R, 0, TAU)
        c.clip()
        const base = c.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R * 1.15)
        base.addColorStop(0, rgbStr(tone(rgb, 30)))
        base.addColorStop(1, rgbStr(tone(rgb, -36)))
        c.fillStyle = base
        c.fillRect(-R, -R, R * 2, R * 2)
        if (kind === 4) {
          c.fillStyle = 'rgba(120,90,40,0.16)'
          c.fillRect(-R, -R * 0.45, R * 2, R * 0.2)
          c.fillRect(-R, R * 0.15, R * 2, R * 0.16)
        } else {
          const n = 4 + Math.floor(rng() * 4)
          for (let i = 0; i < n; i++) {
            const a = rng() * TAU
            const dd = rng() * R * 0.55
            const cx = Math.cos(a) * dd
            const cy = Math.sin(a) * dd
            const cr = R * (0.1 + rng() * 0.15)
            c.fillStyle = 'rgba(28,15,7,0.32)'
            c.beginPath()
            c.arc(cx, cy, cr, 0, TAU)
            c.fill()
            c.strokeStyle = 'rgba(255,232,200,0.22)'
            c.lineWidth = Math.max(0.8, cr * 0.32)
            c.beginPath()
            c.arc(cx, cy, cr, Math.PI * 0.95, Math.PI * 1.5)
            c.stroke()
          }
        }
        shade(c, R, 0.5)
        c.restore()
      } else if (kind === 1) {
        // 熔岩：暗体 + 发光裂缝
        c.save()
        c.beginPath()
        c.arc(0, 0, R, 0, TAU)
        c.clip()
        c.fillStyle = '#22100a'
        c.fillRect(-R, -R, R * 2, R * 2)
        const heat = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.85)
        heat.addColorStop(0, 'rgba(255,110,30,0.55)')
        heat.addColorStop(1, 'rgba(120,30,8,0)')
        c.fillStyle = heat
        c.fillRect(-R, -R, R * 2, R * 2)
        const n = 3 + Math.floor(rng() * 3)
        for (let i = 0; i < n; i++) {
          let lx = (rng() * 2 - 1) * R * 0.3
          let ly = (rng() * 2 - 1) * R * 0.3
          let ang = rng() * TAU
          c.beginPath()
          c.moveTo(lx, ly)
          const segs = 3 + Math.floor(rng() * 3)
          for (let s = 0; s < segs; s++) {
            ang += (rng() - 0.5) * 1.6
            lx += Math.cos(ang) * R * 0.38
            ly += Math.sin(ang) * R * 0.38
            c.lineTo(lx, ly)
          }
          c.strokeStyle = '#ff7a1a'
          c.lineWidth = Math.max(1.5, R * 0.13)
          c.lineCap = 'round'
          c.stroke()
          c.strokeStyle = '#ffd070'
          c.lineWidth = Math.max(0.7, R * 0.05)
          c.stroke()
        }
        shade(c, R, 0.34)
        c.restore()
      } else if (kind === 2) {
        // 冰晶：冷白 + 斜向高光条纹
        c.save()
        c.beginPath()
        c.arc(0, 0, R, 0, TAU)
        c.clip()
        const base = c.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R * 1.1)
        base.addColorStop(0, '#f2f9fc')
        base.addColorStop(0.6, rgbStr(rgb))
        base.addColorStop(1, '#8fb3c6')
        c.fillStyle = base
        c.fillRect(-R, -R, R * 2, R * 2)
        c.save()
        c.rotate(-0.62)
        c.fillStyle = 'rgba(255,255,255,0.34)'
        const nb = 3 + Math.floor(rng() * 2)
        for (let i = 0; i < nb; i++) {
          const y = -R + (i + rng() * 0.5) * ((2 * R) / nb)
          c.fillRect(-R * 1.5, y, R * 3, R * 0.13)
        }
        c.restore()
        shade(c, R, 0.34)
        c.restore()
      } else {
        // 气巨：横向条纹带（3-4 色阶）+ 微扁率 + 风暴斑
        c.save()
        c.beginPath()
        c.ellipse(0, 0, R, R * 0.88, 0, 0, TAU)
        c.clip()
        const famCols = GAS_FAMILIES[fam]
        const nB = 5 + Math.floor(rng() * 2)
        let y = -R * 0.9
        for (let i = 0; i < nB; i++) {
          const hh = ((R * 1.8) / nB) * (0.7 + rng() * 0.6)
          c.fillStyle = rgbStr(famCols[i % famCols.length])
          c.fillRect(-R, y, R * 2, hh + 1)
          y += hh
        }
        const ns = 1 + Math.floor(rng() * 2)
        for (let i = 0; i < ns; i++) {
          const sx = (rng() * 2 - 1) * R * 0.5
          const sy = (rng() * 2 - 1) * R * 0.55
          c.fillStyle = rgbStr(tone(famCols[2], 18))
          c.beginPath()
          c.ellipse(sx, sy, R * 0.2, R * 0.1, 0, 0, TAU)
          c.fill()
        }
        const gl = c.createLinearGradient(0, -R, 0, R)
        gl.addColorStop(0, 'rgba(255,244,220,0.16)')
        gl.addColorStop(1, 'rgba(20,10,4,0.38)')
        c.fillStyle = gl
        c.fillRect(-R, -R, R * 2, R * 2)
        c.restore()
        c.strokeStyle = 'rgba(255,220,170,0.16)'
        c.lineWidth = Math.max(1, R * 0.04)
        c.beginPath()
        c.ellipse(0, 0, R, R * 0.88, 0, 0, TAU)
        c.stroke()
      }
      return { spr: cv, sw: px / SS, sh: px / SS }
    }

    function rebuildPlanetSprite(p: Planet): void {
      const box = buildSpriteFor(p.kind, p.seed, p.rgb, p.r, p.fam)
      p.spr = box.spr
      p.sw = box.sw
      p.sh = box.sh
    }

    /* -------- 行星生成 -------- */
    function makeSpec(): PlanetSpec {
      const kind = pickKind()
      const rgb = pickPlanetColor(kind)
      const fam = Math.floor(Math.random() * GAS_FAMILIES.length)
      const spec: PlanetSpec = {
        kind,
        fam,
        seed: (Math.random() * 0xffffffff) >>> 0,
        rgb,
        col: rgbStr(rgb),
        r: radiusFor(kind, scale),
        ringRot: (Math.random() - 0.5) * 1.2,
        spr: null,
        sw: 0,
        sh: 0,
      }
      const box = buildSpriteFor(spec.kind, spec.seed, spec.rgb, spec.r, spec.fam)
      spec.spr = box.spr
      spec.sw = box.sw
      spec.sh = box.sh
      return spec
    }

    function makePlanet(spec: PlanetSpec, x: number, y: number, vx: number, vy: number): Planet {
      const p: Planet = {
        x, y, vx, vy,
        r: spec.r,
        kind: spec.kind,
        fam: spec.fam,
        seed: spec.seed,
        rgb: spec.rgb,
        col: rgbStr(spec.rgb),
        trailCol: rgbStr(tone(spec.rgb, 14)),
        tx: new Float32Array(TRAIL_CAP),
        ty: new Float32Array(TRAIL_CAP),
        th: 0,
        tn: 0,
        spr: spec.spr,
        sw: spec.sw,
        sh: spec.sh,
        moonA: Math.random() * TAU,
        moonSpd: spec.kind === 3 ? 0.9 + Math.random() * 0.9 : 0,
        moonD: spec.kind === 3 ? spec.r * (2.1 + Math.random() * 0.7) : 0,
        moonSz: spec.kind === 3 ? Math.max(1.3, spec.r * 0.2) : 0,
        ringRot: spec.ringRot,
        emb: 0,
        mergeUntil: 0,
        age: 0,
        flut: 0,
        flutDx: 0,
        flutDy: 0,
      }
      if (!p.spr) rebuildPlanetSprite(p)
      return p
    }

    function launchFromSpec(spec: PlanetSpec, x: number, y: number, vx: number, vy: number): void {
      if (planets.length >= MAX_PLANETS) planets.shift() // 满员：最老的一颗退役
      planets.push(makePlanet(spec, x, y, vx, vy))
    }

    /** 开局：4 颗不同类型圆轨道行星 + 1 颗带卫星的气巨，一睁眼就是群落
     *  （全部同向公转 + 宽朗间距 → 系统长期稳定，群落不会自我吞噬） */
    function seedSystem(): void {
      guides.length = 0 // 重播时参考圈不叠加
      const kinds: PKind[] = [0, 1, 2, 4, 3]
      const fr = [0.32, 0.46, 0.62, 0.8, 1.0]
      const maxR = Math.min(W, H) * 0.46
      const sysDir = Math.random() < 0.5 ? 1 : -1
      for (let i = 0; i < kinds.length; i++) {
        const rr = maxR * fr[i]
        // 角度随机收紧（±0.55rad）：种子轨道相互错开更远，避免开局近距离遭遇
        const a = (i / kinds.length) * TAU + (Math.random() - 0.5) * 1.1
        const v = Math.sqrt(GM / rr) * (0.995 + Math.random() * 0.01)
        const spec: PlanetSpec = {
          kind: kinds[i],
          fam: i === 4 ? Math.floor(Math.random() * GAS_FAMILIES.length) : 0,
          seed: (Math.random() * 0xffffffff) >>> 0,
          rgb: pickPlanetColor(kinds[i]),
          col: '',
          r: radiusFor(kinds[i], scale),
          ringRot: (Math.random() - 0.5) * 1.2,
          spr: null,
          sw: 0,
          sh: 0,
        }
        spec.col = rgbStr(spec.rgb)
        const box = buildSpriteFor(spec.kind, spec.seed, spec.rgb, spec.r, spec.fam)
        spec.spr = box.spr
        spec.sw = box.sw
        spec.sh = box.sh
        launchFromSpec(
          spec,
          star.x + Math.cos(a) * rr,
          star.y + Math.sin(a) * rr,
          -Math.sin(a) * v * sysDir,
          Math.cos(a) * v * sysDir,
        )
        guides.push(rr)
      }
    }

    /* -------- 粒子 / 环辅助 -------- */
    function getPart(): Part | null {
      for (let i = 0; i < PART_MAX; i++) {
        const idx = (partCursor + i) % PART_MAX
        if (!parts[idx].on) {
          partCursor = (idx + 1) % PART_MAX
          return parts[idx]
        }
      }
      return null
    }

    function spawnRing(x: number, y: number, r0: number, r1: number, dur: number, w: number, col: string): void {
      let slot: ShockRing | null = null
      let oldest = Infinity
      for (const r of rings) {
        if (!r.on) {
          slot = r
          break
        }
        if (r.t0 < oldest) {
          oldest = r.t0
          slot = r
        }
      }
      if (!slot) return
      slot.on = true
      slot.x = x
      slot.y = y
      slot.t0 = nowT
      slot.r0 = r0
      slot.r1 = r1
      slot.dur = dur
      slot.w = w
      slot.col = col
    }

    function burstEmbers(x: number, y: number, n: number, spd: number): void {
      for (let i = 0; i < n; i++) {
        const q = getPart()
        if (!q) return
        const a = Math.random() * TAU
        const v = spd * (0.3 + Math.random() * 0.7)
        q.on = true
        q.kind = 1
        q.x = x
        q.y = y
        q.vx = Math.cos(a) * v
        q.vy = Math.sin(a) * v
        q.age = 0
        q.life = 0.4 + Math.random() * 0.5
        q.size = 1 + Math.random() * 1.6
        q.drag = 2.2
        q.home = null
      }
    }

    /* -------- 彗星 -------- */
    function spawnComet(): void {
      // 双曲线掠过：瞄准恒星附近的偏置点，速度高于该距离逃逸速度 → 自然甩摆
      const rpT = star.r * (2.4 + Math.random() * 2.2)
      const b = rpT * 1.35
      const side = Math.floor(Math.random() * 4)
      const mg = 50
      let sx = 0
      let sy = 0
      if (side === 0) {
        sx = Math.random() * W
        sy = -mg
      } else if (side === 1) {
        sx = W + mg
        sy = Math.random() * H
      } else if (side === 2) {
        sx = Math.random() * W
        sy = H + mg
      } else {
        sx = -mg
        sy = Math.random() * H
      }
      let dx = star.x - sx
      let dy = star.y - sy
      const d0 = Math.hypot(dx, dy) || 1
      dx /= d0
      dy /= d0
      const sd = Math.random() < 0.5 ? 1 : -1
      const tx = star.x - dy * b * sd - sx
      const ty = star.y + dx * b * sd - sy
      const td = Math.hypot(tx, ty) || 1
      const v0 = Math.sqrt((2 * GM) / d0) * (1.7 + Math.random() * 0.7)
      comet.on = true
      comet.x = sx
      comet.y = sy
      comet.vx = (tx / td) * v0
      comet.vy = (ty / td) * v0
      comet.acc = 0
      whoosh()
    }

    function emitTail(): void {
      const q = getPart()
      if (!q) return
      // 尾巴背离恒星（辐射压观感）：掠过时自然甩弯
      let ux = comet.x - star.x
      let uy = comet.y - star.y
      const d = Math.hypot(ux, uy) || 1
      ux /= d
      uy /= d
      const sp = Math.hypot(comet.vx, comet.vy)
      const push = 24 + sp * 0.16
      q.on = true
      q.kind = 0
      q.x = comet.x + (Math.random() - 0.5) * 4
      q.y = comet.y + (Math.random() - 0.5) * 4
      q.vx = ux * push + (Math.random() - 0.5) * 22
      q.vy = uy * push + (Math.random() - 0.5) * 22
      q.age = 0
      q.life = 0.7 + Math.random() * 0.65
      q.size = 0.9 + Math.random() * 1.3
      q.drag = 1.4
      q.home = null
    }

    function updateComet(dt: number): void {
      if (!comet.on) {
        comet.timer -= dt
        if (comet.timer <= 0) spawnComet()
        return
      }
      const sub = 2
      const h = dt / sub
      for (let s = 0; s < sub; s++) {
        const dx = star.x - comet.x
        const dy = star.y - comet.y
        const d2 = Math.max(dx * dx + dy * dy, 80)
        const d = Math.sqrt(d2)
        const acc = GM / d2
        comet.vx += (dx / d) * acc * h
        comet.vy += (dy / d) * acc * h
        comet.x += comet.vx * h
        comet.y += comet.vy * h
      }
      // 长尾（降级时减半）
      const rate = degraded ? 130 : 260
      comet.acc += dt * rate
      while (comet.acc >= 1) {
        comet.acc -= 1
        emitTail()
      }
      // 掠过行星：轻微吹拂其尾迹（纯视觉，不扰动轨道 → 系统长期稳定）
      for (const p of planets) {
        const dx = p.x - comet.x
        const dy = p.y - comet.y
        const d2 = dx * dx + dy * dy
        if (d2 < 8100) {
          const d = Math.sqrt(d2) || 1
          p.flut = Math.min(1, p.flut + dt * 4)
          p.flutDx = dx / d
          p.flutDy = dy / d
        }
      }
      // 声相跟随 x
      if (cometPan && ac) {
        const pan = clamp(((comet.x - star.x) / Math.max(1, W * 0.5)) * 0.85, -0.85, 0.85)
        cometPan.pan.setTargetAtTime(pan, ac.currentTime, 0.1)
      }
      // 远离且背离 → 退场
      const dx0 = comet.x - star.x
      const dy0 = comet.y - star.y
      const dNow = Math.hypot(dx0, dy0) || 1
      const radialV = (comet.vx * dx0 + comet.vy * dy0) / dNow
      if (dNow > Math.hypot(W, H) * 0.62 && radialV > 0) {
        comet.on = false
        comet.timer = 15 + Math.random() * 10
      }
    }

    /* -------- 物理推进（四子步 + 互引力 + 碰撞 + 吞没 + 轨道维持） -------- */
    function physics(dt: number): void {
      const sub = 4
      const h = dt / sub
      let hitA: Planet | null = null
      let hitB: Planet | null = null
      for (let s = 0; s < sub; s++) {
        const n = planets.length
        for (let i = 0; i < n; i++) {
          const a = planets[i]
          for (let j = i + 1; j < n; j++) {
            const b = planets[j]
            const dx = b.x - a.x
            const dy = b.y - a.y
            const d2 = Math.max(dx * dx + dy * dy, 120)
            const d = Math.sqrt(d2)
            const f = (1600 / d2) / d
            const fa = f * b.r * b.r
            const fb = f * a.r * a.r
            a.vx += dx * fa * h
            a.vy += dy * fa * h
            b.vx -= dx * fb * h
            b.vy -= dy * fb * h
            if (hitA === null && d < (a.r + b.r) * 0.82) {
              hitA = a
              hitB = b
            }
          }
        }
        for (let i = planets.length - 1; i >= 0; i--) {
          const p = planets[i]
          const dx = star.x - p.x
          const dy = star.y - p.y
          const d2 = Math.max(dx * dx + dy * dy, 80)
          const d = Math.sqrt(d2)
          const acc = GM / d2
          p.vx += (dx / d) * acc * h
          p.vy += (dy / d) * acc * h
          p.x += p.vx * h
          p.y += p.vy * h
          if (d < star.r + p.r * 0.4) {
            // 坠入恒星：冲击波环 + 星体增亮 + 余烬 + whoomp
            spawnRing(star.x, star.y, star.r * 0.8, star.r * 4.6 + 30 * scale, 0.65, 3.2, 'rgba(255,196,110,0.95)')
            burstEmbers(p.x, p.y, 10, 120 * scale)
            star.pulse = Math.max(star.pulse, 1.35)
            star.boost = 1
            whoomp()
            planets.splice(i, 1)
            continue
          }
          const m = 320
          const sp2 = p.vx * p.vx + p.vy * p.vy
          if (
            p.x < -m || p.x > W + m || p.y < -m || p.y > H + m ||
            sp2 > 1.6e7 || !Number.isFinite(sp2)
          ) {
            planets.splice(i, 1)
          }
        }
      }
      if (hitA && hitB) mergePlanets(hitA, hitB)
      /* 轨道维持微调：每帧把速度大小朝当地圆轨道速度轻推 0.3%
         （半衰期 ~4s）——抵消欧拉积分的长期能量漂移，行星不再缓慢坠星 / 逃逸；
         坠星路径（d 过近）与刚出生行星（age<0.8s）豁免，保留死亡与发射的戏剧性 */
      for (const p of planets) {
        p.age += dt
        if (p.age < 0.8) continue
        const dx = p.x - star.x
        const dy = p.y - star.y
        const d = Math.hypot(dx, dy)
        if (d < star.r * 2.2 || d < 30) continue
        const vc = Math.sqrt(GM / d)
        const sp = Math.hypot(p.vx, p.vy)
        if (sp < 1e-3 || !Number.isFinite(sp)) continue
        const k = 1 + (vc / sp - 1) * 0.003
        p.vx *= k
        p.vy *= k
      }
    }

    /** 行星互撞：碎裂 → 闪光环 → 碎屑被幸存者吸回 → 合并成更大的行星 */
    function mergePlanets(a: Planet, b: Planet): void {
      const ia = planets.indexOf(a)
      const ib = planets.indexOf(b)
      if (ia < 0 || ib < 0 || a === b) return
      const big = a.r >= b.r ? a : b
      const small = big === a ? b : a
      const wa = a.r * a.r
      const wb = b.r * b.r
      const wt = wa + wb
      const cx = (a.x * wa + b.x * wb) / wt
      const cy = (a.y * wa + b.y * wb) / wt
      const cvx = (a.vx * wa + b.vx * wb) / wt
      const cvy = (a.vy * wa + b.vy * wb) / wt
      // 30-60 粒彩色碎屑
      const nD = 30 + Math.floor(Math.random() * 31)
      for (let i = 0; i < nD; i++) {
        const q = getPart()
        if (!q) break
        const src = Math.random() < 0.5 ? a : b
        const t = Math.random()
        const bx = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 8
        const by = a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 8
        const ang = Math.random() * TAU
        const v = 40 + Math.random() * 130
        q.on = true
        q.kind = 2
        q.x = bx
        q.y = by
        q.vx = Math.cos(ang) * v + cvx * 0.5
        q.vy = Math.sin(ang) * v + cvy * 0.5
        q.age = 0
        q.life = 0.75 + Math.random() * 0.4
        q.size = 1.1 + Math.random() * 2
        q.col = Math.random() < 0.75 ? src.col : 'rgba(255,220,160,0.9)'
        q.drag = 0
        q.home = big
      }
      spawnRing(cx, cy, big.r * 0.6, big.r * 4.2 + 26, 0.5, 3, 'rgba(255,240,214,0.9)')
      crackle()
      // 幸存者：动量守恒位置 + 体积合并增大
      big.x = cx
      big.y = cy
      big.vx = cvx
      big.vy = cvy
      big.r = Math.min(Math.cbrt(big.r ** 3 + small.r ** 3) * 1.02, 15 * scale)
      big.mergeUntil = nowT + 0.6
      if (big.kind === 3) big.moonD = Math.max(big.moonD, big.r * 2.1)
      rebuildPlanetSprite(big)
      const si = planets.indexOf(small)
      if (si >= 0) planets.splice(si, 1)
    }

    function updateParts(dt: number): void {
      for (let i = 0; i < PART_MAX; i++) {
        const q = parts[i]
        if (!q.on) continue
        q.age += dt
        if (q.age >= q.life) {
          q.on = false
          q.home = null
          continue
        }
        if (q.kind === 2 && q.home && nowT < q.home.mergeUntil + 0.35) {
          // 碎屑回吸：朝幸存行星加速 + 阻尼
          const dx = q.home.x - q.x
          const dy = q.home.y - q.y
          const d = Math.max(4, Math.hypot(dx, dy))
          const acc = 26000 / d
          q.vx += (dx / d) * acc * dt
          q.vy += (dy / d) * acc * dt
          const damp = Math.exp(-2.6 * dt)
          q.vx *= damp
          q.vy *= damp
          if (d < q.home.r + 2) {
            q.on = false
            q.home = null
            continue
          }
        } else if (q.kind === 2) {
          const damp = Math.exp(-0.6 * dt)
          q.vx *= damp
          q.vy *= damp
        } else {
          const damp = Math.exp(-q.drag * dt)
          q.vx *= damp
          q.vy *= damp
        }
        q.x += q.vx * dt
        q.y += q.vy * dt
      }
    }

    function update(dt: number): void {
      star.pulse = Math.max(0, star.pulse - dt * 2.1)
      star.boost = Math.max(0, star.boost - dt * 1.9)
      corA += dt * 0.055
      corB -= dt * 0.037
      // 日珥调度（6-11s）
      if (!star.pfOn) {
        star.pfNext -= dt
        if (star.pfNext <= 0) {
          star.pfOn = true
          star.pfT0 = nowT
          star.pfAng = Math.random() * TAU
          star.pfLen = star.r * (1.5 + Math.random() * 1.1)
          star.pfNext = 6 + Math.random() * 5
        }
      }
      updateComet(dt)
      physics(dt)
      /* 自愈：行星全部死亡且持续空场 9s → 静默重播群落（房间永不死寂） */
      if (planets.length === 0) {
        emptyFor += dt
        if (emptyFor > 9) {
          emptyFor = 0
          seedSystem()
        }
      } else {
        emptyFor = 0
      }
      // 尾迹采样 / 余烬 / 卫星 / 吹拂衰减
      const embRate = degraded ? 3 : 7
      for (const p of planets) {
        p.tx[p.th] = p.x
        p.ty[p.th] = p.y
        p.th = (p.th + 1) % TRAIL_CAP
        if (p.tn < TRAIL_CAP) p.tn++
        if (p.flut > 0.001) p.flut *= Math.exp(-1.4 * dt)
        if (p.kind === 1) {
          p.emb += dt * embRate
          while (p.emb >= 1) {
            p.emb -= 1
            const q = getPart()
            if (!q) {
              p.emb = 0
              break
            }
            const a = Math.random() * TAU
            q.on = true
            q.kind = 1
            q.x = p.x + Math.cos(a) * p.r * 0.7
            q.y = p.y + Math.sin(a) * p.r * 0.7
            q.vx = p.vx * 0.25 + Math.cos(a) * 12
            q.vy = p.vy * 0.25 + Math.sin(a) * 12
            q.age = 0
            q.life = 0.35 + Math.random() * 0.5
            q.size = 0.8 + Math.random() * 1.1
            q.drag = 2.8
            q.home = null
          }
        }
        if (p.kind === 3) p.moonA += p.moonSpd * dt
      }
      updateParts(dt)
    }

    /* -------- 背景（离屏：星点 / 星云 / 星尘带 / 暗角） -------- */
    function bakeTwinkles(): void {
      if (!bg) return
      const c = bg.getContext('2d')
      if (!c) return
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.fillStyle = '#f5e9d0'
      for (const s of twins) {
        c.globalAlpha = s.a * 0.75
        c.fillRect(s.x - s.r / 2, s.y - s.r / 2, s.r, s.r)
      }
      c.globalAlpha = 1
      twins.length = 0
    }

    function neb(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = g
      c.fillRect(x - r, y - r, r * 2, r * 2)
    }

    function buildBG(): void {
      if (!bg) bg = document.createElement('canvas')
      bg.width = Math.max(1, Math.round(W * dpr))
      bg.height = Math.max(1, Math.round(H * dpr))
      const c = bg.getContext('2d')
      if (!c) return
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.fillStyle = BG
      c.fillRect(0, 0, W, H)
      const mn = Math.min(W, H)
      // 极淡星云：一暖一冷（+ 大页第三团）
      neb(c, W * 0.68, H * 0.3, mn * 0.52, 'rgba(255,150,64,0.05)')
      neb(c, W * 0.26, H * 0.74, mn * 0.5, 'rgba(96,132,196,0.045)')
      if (mn > 380) neb(c, W * 0.5, H * 0.12, mn * 0.34, 'rgba(214,110,130,0.03)')
      // 微星尘带（斜向）
      c.save()
      c.translate(W / 2, H / 2)
      c.rotate(-0.46)
      const bh = Math.max(60, H * 0.34)
      const g = c.createLinearGradient(0, -bh, 0, bh)
      g.addColorStop(0, 'rgba(216,196,168,0)')
      g.addColorStop(0.5, 'rgba(216,196,168,0.045)')
      g.addColorStop(1, 'rgba(216,196,168,0)')
      c.fillStyle = g
      c.fillRect(-Math.max(W, H), -bh, Math.max(W, H) * 2, bh * 2)
      for (let i = 0; i < 110; i++) {
        const x = (Math.random() * 2 - 1) * Math.max(W, H) * 0.7
        const y = (Math.random() * 2 - 1) * bh * 0.85
        c.fillStyle = `rgba(232,220,196,${(0.04 + Math.random() * 0.1).toFixed(3)})`
        const rr = 0.3 + Math.random() * 0.55
        c.fillRect(x, y, rr, rr)
      }
      c.restore()
      // 220 颗星点：208 静态 + 12 颗闪烁（降级时烘入背景）
      twins.length = 0
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * W
        const y = Math.random() * H
        const r = 0.3 + Math.random() * 0.85
        const a = 0.06 + Math.random() * 0.42
        if (i < 12) {
          twins.push({ x, y, r: Math.max(0.7, r), a: Math.max(0.3, a), ph: Math.random() * TAU, sp: 0.5 + Math.random() * 1.8 })
        } else {
          c.fillStyle = `rgba(240,234,214,${a.toFixed(3)})`
          c.fillRect(x - r / 2, y - r / 2, r, r)
        }
      }
      // 几颗亮星 + 十字光芒
      for (let i = 0; i < 6; i++) {
        const x = Math.random() * W
        const y = Math.random() * H
        c.fillStyle = 'rgba(255,246,226,0.85)'
        c.fillRect(x - 0.7, y - 0.7, 1.4, 1.4)
        c.fillStyle = 'rgba(255,240,210,0.28)'
        c.fillRect(x - 3.5, y - 0.4, 7, 0.8)
        c.fillRect(x - 0.4, y - 3.5, 0.8, 7)
      }
      // 暗角
      const v = c.createRadialGradient(W / 2, H / 2, mn * 0.34, W / 2, H / 2, Math.max(W, H) * 0.74)
      v.addColorStop(0, 'rgba(0,0,0,0)')
      v.addColorStop(1, 'rgba(0,0,0,0.5)')
      c.fillStyle = v
      c.fillRect(0, 0, W, H)
      if (degraded) bakeTwinkles()
    }

    /* -------- 尺寸 -------- */
    function resize(): void {
      const w = Math.max(1, root.clientWidth)
      const h = Math.max(1, root.clientHeight)
      if (w === W && h === H) return
      if (w < 40 || h < 40) return // 极小画布跳过
      const oldScale = scale
      const oldSX = star.x
      const oldSY = star.y
      W = w
      H = h
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = FONT_SM

      scale = clamp(Math.min(W, H) / 720, 0.6, 1.15)
      star.x = W / 2
      star.y = H / 2
      star.r = 26 * scale
      GM = 5.2e6 * scale * scale

      if (seeded && oldScale > 0) {
        // 等比迁移：位置 / 半径 / 速度（v ∝ √scale 保持轨道稳定）+ sprite 重建
        const rs = scale / oldScale
        const vs = Math.sqrt(rs)
        for (const p of planets) {
          p.x = star.x + (p.x - oldSX) * rs
          p.y = star.y + (p.y - oldSY) * rs
          p.vx *= vs
          p.vy *= vs
          p.r *= rs
          p.moonD *= rs
          p.moonSz *= rs
          p.tn = 0
          p.th = 0
          rebuildPlanetSprite(p)
        }
        for (let i = 0; i < guides.length; i++) guides[i] *= rs
      }
      buildBG()
      buildStarSprites()
      if (!seeded) {
        seeded = true
        seedSystem()
      }
      // 粒子与环的位置已失去参照，直接清场
      for (const q of parts) {
        q.on = false
        q.home = null
      }
      for (const r of rings) r.on = false
      aim.active = false
    }

    /* -------- 绘制 -------- */
    function drawStarUnder(t: number): void {
      // 大范围柔光（恒星环境光）
      if (!glowSpr) return
      const breath = 0.5 + 0.5 * Math.sin(t * 0.8)
      const gs = star.r * 7.8 * (1 + 0.025 * breath + 0.12 * star.pulse + 0.3 * star.boost)
      ctx.globalAlpha = Math.min(1, 0.5 + 0.16 * breath + 0.28 * star.pulse + 0.35 * star.boost)
      ctx.drawImage(glowSpr, star.x - gs / 2, star.y - gs / 2, gs, gs)
      ctx.globalAlpha = 1
    }

    function drawStarBody(t: number): void {
      const breath = 0.5 + 0.5 * Math.sin(t * 0.8)
      const s = 1 + 0.04 * breath + 0.07 * star.pulse + 0.22 * star.boost // 呼吸 ±4%
      ctx.globalCompositeOperation = 'lighter'
      if (corBSpr) {
        const sz = star.r * 5.6 * s
        ctx.save()
        ctx.translate(star.x, star.y)
        ctx.rotate(corB)
        ctx.globalAlpha = 0.75
        ctx.drawImage(corBSpr, -sz / 2, -sz / 2, sz, sz)
        ctx.restore()
      }
      if (corASpr) {
        const sz = star.r * 5.2 * s
        ctx.save()
        ctx.translate(star.x, star.y)
        ctx.rotate(corA)
        ctx.globalAlpha = 0.85
        ctx.drawImage(corASpr, -sz / 2, -sz / 2, sz, sz)
        ctx.restore()
      }
      if (coreSpr) {
        const cs = star.r * 2.75 * s
        ctx.globalAlpha = Math.min(1, 0.92 + 0.08 * breath + 0.5 * star.boost)
        ctx.drawImage(coreSpr, star.x - cs / 2, star.y - cs / 2, cs, cs)
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    function drawProminence(): void {
      if (!star.pfOn) return
      const k = (nowT - star.pfT0) / 1.5
      if (k >= 1) {
        star.pfOn = false
        return
      }
      const env = Math.sin(Math.PI * k)
      ctx.globalCompositeOperation = 'lighter'
      for (let e = 0; e < 2; e++) {
        const a0 = star.pfAng + e * 0.24
        const len = star.pfLen * (e === 0 ? 1 : 0.62)
        const rise = Math.pow(env, 0.8)
        const apexD = star.r + len * rise
        const ctrlD = star.r + 2 * (apexD - star.r)
        const s1x = star.x + Math.cos(a0 - 0.18) * star.r * 1.04
        const s1y = star.y + Math.sin(a0 - 0.18) * star.r * 1.04
        const s2x = star.x + Math.cos(a0 + 0.18) * star.r * 1.04
        const s2y = star.y + Math.sin(a0 + 0.18) * star.r * 1.04
        const cxx = star.x + Math.cos(a0) * ctrlD
        const cyy = star.y + Math.sin(a0) * ctrlD
        ctx.strokeStyle = e === 0 ? '#ff8c3a' : '#ffab5e'
        ctx.globalAlpha = (e === 0 ? 0.7 : 0.32) * env
        ctx.lineWidth = (1.6 + 2.4 * env) * scale * (e === 0 ? 1 : 0.6)
        ctx.beginPath()
        ctx.moveTo(s1x, s1y)
        ctx.quadraticCurveTo(cxx, cyy, s2x, s2y)
        ctx.stroke()
        ctx.strokeStyle = '#ffdca8'
        ctx.globalAlpha = 0.42 * env
        ctx.lineWidth = (0.7 + 1.1 * env) * scale
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      // 弧顶火花
      if (k > 0.3 && k < 0.65 && Math.random() < 0.3) {
        const q = getPart()
        if (q) {
          const a0 = star.pfAng
          const d = star.r + star.pfLen * env
          const sa = Math.random() * TAU
          q.on = true
          q.kind = 3
          q.x = star.x + Math.cos(a0) * d
          q.y = star.y + Math.sin(a0) * d
          q.vx = Math.cos(sa) * (30 + Math.random() * 50)
          q.vy = Math.sin(sa) * (30 + Math.random() * 50)
          q.age = 0
          q.life = 0.45 + Math.random() * 0.4
          q.size = 1 + Math.random() * 1.3
          q.drag = 1.8
          q.home = null
        }
      }
    }

    function drawRingHalf(p: Planet, a0: number, a1: number): void {
      ctx.strokeStyle = 'rgba(236,220,182,0.55)'
      ctx.lineWidth = Math.max(1, p.r * 0.22)
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, p.r * 2.05, p.r * 0.66, p.ringRot, a0, a1)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(200,180,140,0.3)'
      ctx.lineWidth = Math.max(0.6, p.r * 0.1)
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, p.r * 1.62, p.r * 0.52, p.ringRot, a0, a1)
      ctx.stroke()
    }

    function drawMoon(p: Planet): void {
      const mx = p.x + Math.cos(p.moonA) * p.moonD
      const my = p.y + Math.sin(p.moonA) * p.moonD * 0.38
      ctx.fillStyle = '#d9d2c4'
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.arc(mx, my, p.moonSz, 0, TAU)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    function drawBody(p: Planet, t: number): void {
      const backMoon = p.kind === 3 && Math.sin(p.moonA) < 0
      if (backMoon) drawMoon(p)
      if (p.kind === 4) drawRingHalf(p, Math.PI, TAU) // 环后半（先画）
      if (p.spr) {
        ctx.drawImage(p.spr, p.x - p.sw / 2, p.y - p.sh / 2, p.sw, p.sh)
      } else {
        ctx.fillStyle = p.col
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, TAU)
        ctx.fill()
      }
      if (p.kind === 4) drawRingHalf(p, 0, Math.PI) // 环前半（后画）
      if (p.kind === 1 && moltenGlowSpr) {
        // 熔岩微光脉动
        const gs = p.r * 5.2
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.16 + 0.1 * Math.sin(t * 2.4 + (p.seed % 10))
        ctx.drawImage(moltenGlowSpr, p.x - gs / 2, p.y - gs / 2, gs, gs)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
      if (p.kind === 3 && !backMoon) drawMoon(p)
    }

    function drawPlanets(t: number): void {
      for (const p of planets) {
        // 专属色相渐隐尾迹（线宽 ∝ 尺寸；彗星掠过时尾迹被吹弯）
        const n = p.tn
        if (n > 1) {
          ctx.strokeStyle = p.trailCol
          ctx.lineWidth = clamp(p.r * 0.42, 0.55, 2.6)
          const flutAmp = p.flut * 6 * scale
          for (let i = 1; i < n; i++) {
            const i0 = (p.th - n + i + TRAIL_CAP * 2) % TRAIL_CAP
            const i1 = (p.th - n + i + 1 + TRAIL_CAP * 2) % TRAIL_CAP
            const ageW = (1 - i / n) * (1 - i / n) // 越旧吹得越开
            const ox = p.flutDx * flutAmp * ageW
            const oy = p.flutDy * flutAmp * ageW
            ctx.globalAlpha = Math.pow(i / n, 1.7) * 0.7
            ctx.beginPath()
            ctx.moveTo(p.tx[i0] + ox, p.ty[i0] + oy)
            ctx.lineTo(p.tx[i1] + ox, p.ty[i1] + oy)
            ctx.stroke()
          }
          ctx.globalAlpha = 1
        }
        drawBody(p, t)
      }
    }

    function drawComet(): void {
      if (!comet.on) return
      if (cometSpr) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.9
        ctx.drawImage(cometSpr, comet.x - 13, comet.y - 13, 26, 26)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
      }
      ctx.fillStyle = '#fffdf4'
      ctx.beginPath()
      ctx.arc(comet.x, comet.y, 1.8, 0, TAU)
      ctx.fill()
    }

    function drawParts(): void {
      for (let i = 0; i < PART_MAX; i++) {
        const q = parts[i]
        if (!q.on) continue
        const k = q.age / q.life
        if (q.kind === 0 || q.kind === 3) {
          ctx.fillStyle = TAIL_PAL[Math.min(7, (k * 8) | 0)]
          ctx.globalAlpha = (1 - k) * 0.8
        } else if (q.kind === 1) {
          ctx.fillStyle = EMBER_PAL[Math.min(5, (k * 6) | 0)]
          ctx.globalAlpha = (1 - k) * 0.85
        } else {
          ctx.fillStyle = q.col
          ctx.globalAlpha = (1 - k) * 0.95
        }
        const s = q.size * (1 - 0.35 * k)
        ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s)
      }
      ctx.globalAlpha = 1
    }

    function drawRings(): void {
      for (const r of rings) {
        if (!r.on) continue
        const k = (nowT - r.t0) / r.dur
        if (k >= 1) {
          r.on = false
          continue
        }
        const e = 1 - (1 - k) * (1 - k)
        ctx.strokeStyle = r.col
        ctx.globalAlpha = (1 - k) * 0.85
        ctx.lineWidth = Math.max(0.5, r.w * (1 - k) + 0.4)
        ctx.beginPath()
        ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, TAU)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    /** 弹弓瞄准：橡皮筋 + 行星预览 + 风险变色预测轨迹 + 箭头 + 速度读数 */
    function computeLaunchVel(): void {
      const dx = aim.x0 - aim.x
      const dy = aim.y0 - aim.y
      const k = LAUNCH_K * scale
      const vmax = 520 * scale
      let vx = dx * k
      let vy = dy * k
      const sp = Math.hypot(vx, vy)
      if (sp > vmax) {
        vx *= vmax / sp
        vy *= vmax / sp
      }
      vel.vx = vx
      vel.vy = vy
    }

    function drawAim(): void {
      if (!aim.active || !aim.spec) return
      const spec = aim.spec
      const dx = aim.x0 - aim.x
      const dy = aim.y0 - aim.y
      const dist = Math.hypot(dx, dy)
      // 橡皮筋虚线
      ctx.save()
      ctx.setLineDash([4, 6])
      ctx.strokeStyle = 'rgba(245,233,208,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(aim.x0, aim.y0)
      ctx.lineTo(aim.x, aim.y)
      ctx.stroke()
      ctx.restore()
      // 即将发射的行星本体预览（按下即锁定这颗星）
      if (spec.spr) {
        if (spec.kind === 4) {
          ctx.strokeStyle = 'rgba(236,220,182,0.4)'
          ctx.lineWidth = Math.max(1, spec.r * 0.2)
          ctx.beginPath()
          ctx.ellipse(aim.x0, aim.y0, spec.r * 2.05, spec.r * 0.66, spec.ringRot, 0, TAU)
          ctx.stroke()
        }
        ctx.globalAlpha = 0.92
        ctx.drawImage(spec.spr, aim.x0 - spec.sw / 2, aim.y0 - spec.sh / 2, spec.sw, spec.sh)
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = rgbStr(spec.rgb)
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.arc(aim.x0, aim.y0, spec.r, 0, TAU)
        ctx.fill()
        ctx.globalAlpha = 1
      }
      if (dist < 7) return // 快速点击：不画预测

      computeLaunchVel()
      // 预测轨迹（仅恒星引力，110 步；临近恒星段转琥珀）
      let px = aim.x0
      let py = aim.y0
      let pvx = vel.vx
      let pvy = vel.vy
      const h = 0.02
      const riskR = star.r * 2.5
      outer: for (let i = 0; i < 110; i++) {
        const ddx = star.x - px
        const ddy = star.y - py
        const d2 = Math.max(ddx * ddx + ddy * ddy, 80)
        const d = Math.sqrt(d2)
        const acc = GM / d2
        pvx += (ddx / d) * acc * h
        pvy += (ddy / d) * acc * h
        px += pvx * h
        py += pvy * h
        if (d < star.r + 3) {
          ctx.strokeStyle = 'rgba(255,92,0,0.9)'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(px, py, 4, 0, TAU)
          ctx.stroke()
          break outer
        }
        if (i % 5 === 0) {
          ctx.fillStyle = d < riskR ? 'rgba(255,179,71,0.95)' : 'rgba(245,233,208,0.85)'
          ctx.globalAlpha = 0.78 * (1 - i / 110)
          ctx.beginPath()
          ctx.arc(px, py, 1.35, 0, TAU)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1

      // 预览箭头（发射方向与力度）
      const ux = dx / dist
      const uy = dy / dist
      const len = Math.min(dist * 0.55, 90)
      const ax = aim.x0 + ux * len
      const ay = aim.y0 + uy * len
      ctx.strokeStyle = spec.col
      ctx.globalAlpha = 0.9
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(aim.x0 + ux * 8, aim.y0 + uy * 8)
      ctx.lineTo(ax, ay)
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax + (-ux * 0.8 - uy * 0.5) * 7, ay + (-uy * 0.8 + ux * 0.5) * 7)
      ctx.moveTo(ax, ay)
      ctx.lineTo(ax + (-ux * 0.8 + uy * 0.5) * 7, ay + (-uy * 0.8 - ux * 0.5) * 7)
      ctx.stroke()
      ctx.globalAlpha = 1

      // 速度读数（仪表感，值变化才重写）
      const spd = Math.round(Math.hypot(vel.vx, vel.vy))
      if (spd !== lastSpeedShown) {
        lastSpeedShown = spd
        speedText = `${spd} px/s`
      }
      ctx.fillStyle = 'rgba(245,233,208,0.6)'
      ctx.font = FONT_SM
      ctx.fillText(speedText, aim.x0 + 12, aim.y0 - 10)
    }

    function render(): void {
      if (W < 40 || H < 40) return
      // 深空背景（离屏一次成型）
      if (bg) {
        ctx.drawImage(bg, 0, 0, W, H)
      } else {
        ctx.fillStyle = BG
        ctx.fillRect(0, 0, W, H)
      }
      // 闪烁星（12 颗）
      ctx.fillStyle = '#f5e9d0'
      for (const s of twins) {
        ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(nowT * s.sp + s.ph))
        ctx.fillRect(s.x - s.r / 2, s.y - s.r / 2, s.r, s.r)
      }
      ctx.globalAlpha = 1
      // 轨道参考圈（天文图表）
      if (guides.length > 0) {
        ctx.save()
        ctx.setLineDash([2, 8])
        ctx.strokeStyle = 'rgba(255,179,71,0.07)'
        ctx.lineWidth = 1
        for (const g of guides) {
          ctx.beginPath()
          ctx.arc(star.x, star.y, g, 0, TAU)
          ctx.stroke()
        }
        ctx.restore()
      }
      drawStarUnder(nowT)
      drawComet()
      drawStarBody(nowT)
      drawPlanets(nowT) // 行星在恒星之上：掠过日面成「凌星」剪影
      drawProminence()
      drawParts()
      drawRings()
      drawAim()
    }

    /* -------- HUD 读数（ref 直写） -------- */
    function updateHud(): void {
      if (planets.length !== lastBodies) {
        lastBodies = planets.length
        if (bodiesEl) bodiesEl.textContent = String(planets.length).padStart(2, '0')
        if (ac && humGain) {
          humGain.gain.setTargetAtTime(HUM_BASE + Math.min(lastBodies, 26) * HUM_PER, ac.currentTime, 0.5)
        }
      }
      if (launches !== lastLaunchShown) {
        lastLaunchShown = launches
        if (launchesEl) launchesEl.textContent = String(launches).padStart(2, '0')
      }
    }

    /* -------- 软渲染降级（一次性） -------- */
    function degrade(): void {
      degraded = true
      bakeTwinkles() // 星点静态化
    }

    /* -------- 输入 -------- */
    function toLocal(e: PointerEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    function onDown(e: PointerEvent): void {
      if (e.button !== 0) return
      e.preventDefault()
      initAudio() // 首次手势内懒创建音频
      const { x, y } = toLocal(e)
      // 若按在恒星附近，把锚点推到安全半径之外
      const dx = x - star.x
      const dy = y - star.y
      const d = Math.hypot(dx, dy)
      const safe = star.r + 16
      let ax = x
      let ay = y
      if (d < safe) {
        const dd = d < 0.001 ? 1 : d
        ax = star.x + (dx / dd) * safe
        ay = star.y + (dy / dd) * safe
      }
      aim.active = true
      aim.x0 = ax
      aim.y0 = ay
      aim.x = x
      aim.y = y
      aim.t0 = performance.now()
      aim.spec = makeSpec() // 按下即锁定这颗行星的类型 / 配色 / sprite
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* 捕获失败无碍 */
      }
    }

    function onMove(e: PointerEvent): void {
      if (!aim.active) return
      const { x, y } = toLocal(e)
      aim.x = x
      aim.y = y
    }

    function onUp(): void {
      if (!aim.active) return
      const dx = aim.x0 - aim.x
      const dy = aim.y0 - aim.y
      const dist = Math.hypot(dx, dy)
      const dur = performance.now() - aim.t0
      aim.active = false
      const spec = aim.spec
      aim.spec = null
      if (!spec) return
      if (dist < 7 && dur < 300) {
        // 快速点击：静止行星，任其坠落
        launchFromSpec(spec, aim.x0, aim.y0, 0, 0)
      } else {
        computeLaunchVel()
        launchFromSpec(spec, aim.x0, aim.y0, vel.vx, vel.vy)
        thwip()
        // 挑战：累计三次弹弓发射 → 通关
        launches += 1
        if (launches >= 3) {
          try {
            useBookStore.getState().clearRoom(6)
          } catch {
            /* store 未就绪时静默 */
          }
        }
      }
    }

    function onCancel(): void {
      aim.active = false
    }

    function onCtx(e: Event): void {
      e.preventDefault()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('contextmenu', onCtx)

    /* -------- 主循环 -------- */
    function step(now: number): void {
      if (!running) return
      raf = requestAnimationFrame(step)
      const ms = now - last
      const dt = Math.min(ms / 1000, 0.045)
      last = now
      nowT = now / 1000
      // 帧耗时 EMA：软渲染一次性降级（彗尾减半 / 星点静态化）
      if (ms > 0 && ms < 1000) emaDt = emaDt * 0.94 + ms * 0.06
      if (!degraded && emaDt > 40 && nowT > 3) degrade()
      update(dt)
      render()
      updateHud()
    }

    const ro = new ResizeObserver(() => {
      nowT = performance.now() / 1000
      resize()
      render() // 暂停时也立即重绘一帧
    })
    ro.observe(root)
    resize()
    nowT = performance.now() / 1000
    render()

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05)
    })

    const start = (): void => {
      if (disposed || running) return
      running = true
      last = performance.now()
      if (ac && ac.state === 'suspended') void ac.resume()
      raf = requestAnimationFrame(step)
    }
    const stop = (): void => {
      running = false
      aim.active = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      if (ac && ac.state === 'running') void ac.suspend()
    }
    ctrlRef.current = { start, stop }

    return () => {
      disposed = true
      running = false
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('contextmenu', onCtx)
      unsubMute()
      if (cometPanTimer) window.clearTimeout(cometPanTimer)
      if (ac) {
        void ac.close()
        ac = null
        master = null
        humGain = null
      }
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
      {/* 左上 HUD 铭牌 */}
      <div
        className="pointer-events-none absolute z-10 select-none"
        style={{ left: '12%', top: '4.5%' }}
      >
        <div className="font-display" style={{ fontSize: 11, letterSpacing: '0.42em', color: STAR_GOLD }}>
          ORBIT
        </div>
        <div
          className="font-cn"
          style={{ fontSize: 10, letterSpacing: '0.5em', color: 'rgba(255,179,71,0.55)', marginTop: 5 }}
        >
          引力剧场
        </div>
        <div
          className="font-attitude"
          style={{ fontSize: 8.5, letterSpacing: '0.18em', color: 'rgba(245,233,208,0.4)', marginTop: 6 }}
        >
          STELLAR BIOME · 星之群落
        </div>
        <div
          className="font-attitude"
          style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(245,233,208,0.55)', marginTop: 7 }}
        >
          BODIES <span ref={bodiesRef}>05</span>&nbsp;&nbsp;·&nbsp;&nbsp;LAUNCHES <span ref={launchesRef}>00</span>
        </div>
      </div>
      {/* 底部居中署名（避开左右 10% 热区与角部页码徽章） */}
      <div
        className="font-cn pointer-events-none absolute inset-x-0 select-none"
        style={{
          bottom: '4%',
          textAlign: 'center',
          fontSize: 'clamp(8px, 1.3cqw, 12px)',
          letterSpacing: '0.42em',
          color: 'rgba(245,233,208,0.3)',
          whiteSpace: 'nowrap',
        }}
        aria-hidden
      >
        引力剧场　ORBIT — 拖拽发射 · 轻点落星
      </div>
    </div>
  )
}
