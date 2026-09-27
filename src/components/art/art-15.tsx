'use client'

import { useEffect, useRef } from 'react'
import type { ArtPageProps } from './types'
import { useBookStore } from '@/lib/book-store'

/* ═══════════════════════════════════════════════════════
   ROOM 15 · DODGE LINE 躲避线 —— 霓虹疾驰 NEON DASH
   深绿黑 CRT（#02120a）上的多汁街机：
     · 霓虹镖形船（白热核心 + 绿晕，转向倾斜 ±12°，
       引擎粒子尾 + 渐细丝带轨迹）
     · 墙型随分数渐进登场：普通缝墙 → 滑动缝 → 呼吸缝
       → 品红激光栏（虚线预警 telegraph 后实弹化）
       → 中心旋转短杆
     · 琥珀能量球刷在缝边缘高风险位（磁吸 + 五声琶音）
     · 擦弹 GRAZE：贴墙 <14px 通过 → +2 分 + 火花簇 +
       90ms 微慢动作 +「GRAZE」弹字 + 色差脉冲 + 连擦 chip
     · 每 10 分 SPEED UP 横幅 + 速度 +15% + 底色变调 + 号角
     · 死亡：24 片船碎（白绿品红）+ 白闪 + 震屏 +
       400ms 慢动作 → 点击即时重开
   指针 Y 驾驶，船 X 固定左侧 18%；待机 = 演示墙滚动。
   得分 ≥15 → clearRoom(15) 通关。BEST 存 localStorage。
   音频：引擎嗡鸣（锯齿+低通，音高∝速度）/ 过墙 whoosh /
   能量球琶音 / GRAZE zing / 死亡轰爆 / SPEED UP 号角，
   master gain + 全局静音订阅 + 手势懒建。
   性能：发光全部走离屏 sprite（船/粒子/能量球/墙条），
   粒子池化，渲染循环零分配，DPR≤2。
   ═══════════════════════════════════════════════════════ */

const BG = '#02120a'
const NEON = '#3dff6e'
const HOT = '#eafff0'
const AMBER = '#ffb646'
const MAGENTA = '#ff2e88'
const BONE = '#d9d2c0'
const BEST_KEY = 'flip:dodge:best'

const PARTS_MAX = 240
const POPS_MAX = 10
const TRAIL_N = 26
const CLEAR_SCORE = 15
/** 激光栏实弹化提前量：距船 0.6s 行程时由虚线预警转实弹 */
const LASER_AHEAD = 0.6
/** 擦弹判定距离（px，随 sc 缩放） */
const GRAZE_PX = 14
/** 能量球磁吸半径（px，随 sc 缩放） */
const MAG_R = 66
/** 死亡后允许点击重开的最短间隔（防误触跳过成绩画面） */
const RETRY_GUARD = 0.3

/** 五声琶音 C5-D5-E5-G5-A5 */
const ARP_FREQ = [523.25, 587.33, 659.25, 783.99, 880]

/** 每 10 分一档的底色变调（轻微） */
const LEVEL_TINT = [
  'rgba(8,42,26,0.10)',
  'rgba(8,58,52,0.13)',
  'rgba(6,40,74,0.13)',
  'rgba(48,22,66,0.13)',
  'rgba(66,44,8,0.13)',
  'rgba(64,14,36,0.13)',
]

/** 船碎碎片色：kind 0 绿 / 1 白 / 3 品红 */
const FRAG_COLORS = [NEON, HOT, AMBER, MAGENTA]

const DASH: number[] = [6, 5]
const EMPTY_DASH: number[] = []

type Mode = 'attract' | 'play' | 'dead'

/** 墙型：0 普通缝 / 1 滑动缝 / 2 呼吸缝 / 3 激光栏 / 4 旋转短杆 */
type WallKind = 0 | 1 | 2 | 3 | 4

interface Wall {
  kind: WallKind
  x: number
  bw: number
  /** 缝中心（kind 4 为杆中心 y） */
  gapY: number
  /** 缝高（kind 4 为杆长） */
  gapH: number
  baseGapY: number
  baseGapH: number
  ph: number
  spd: number
  amp: number
  /** 激光栏：0 = 预警虚线 / 1 = 实弹 */
  live: number
  passed: boolean
  /** 穿越期间船与墙的最近距离（擦弹判定） */
  minD: number
}

interface Orb {
  x: number
  y: number
  /** 附着的墙（磁吸后脱离） */
  wall: Wall | null
  side: number
  off: number
  magT: number
  ph: number
}

/** 粒子共池：kind 0 绿 / 1 白 / 2 琥珀 / 3 品红；frag = 船碎片段 */
interface Part {
  alive: boolean
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  kind: 0 | 1 | 2 | 3
  frag: boolean
  rot: number
  vr: number
  len: number
  grav: number
}

/** 漂浮弹字（GRAZE / +1） */
interface Pop {
  alive: boolean
  x: number
  y: number
  vy: number
  life: number
  maxLife: number
  text: string
  color: string
  font: string
  chroma: boolean
}

interface World {
  w: number
  h: number
  dpr: number
  sc: number
  t: number
  mode: Mode
  score: number
  best: number
  cleared: boolean
  level: number
  playerY: number
  targetY: number
  vy: number
  tilt: number
  speed: number
  travel: number
  dist: number
  walls: Wall[]
  orbs: Orb[]
  parts: Part[]
  partCursor: number
  pops: Pop[]
  popCursor: number
  trailX: Float32Array
  trailY: Float32Array
  trailN: number
  trailHead: number
  lastGapY: number
  emitT: number
  grazeStreak: number
  grazeChainT: number
  slowT: number
  pulseT: number
  flash: number
  shake: number
  deathT: number
  raf: number
  last: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function makeParts(): Part[] {
  const arr: Part[] = []
  for (let i = 0; i < PARTS_MAX; i++) {
    arr.push({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
      size: 1, kind: 0, frag: false, rot: 0, vr: 0, len: 0, grav: 0,
    })
  }
  return arr
}

function makePops(): Pop[] {
  const arr: Pop[] = []
  for (let i = 0; i < POPS_MAX; i++) {
    arr.push({
      alive: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1,
      text: '', color: HOT, font: '', chroma: false,
    })
  }
  return arr
}

export default function Art15({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scoreRef = useRef<HTMLDivElement | null>(null)
  const bestRef = useRef<HTMLDivElement | null>(null)
  const hudRef = useRef<HTMLDivElement | null>(null)
  const hudBestRef = useRef<HTMLDivElement | null>(null)
  const chipRef = useRef<HTMLDivElement | null>(null)
  const chipNumRef = useRef<HTMLSpanElement | null>(null)
  const bannerRef = useRef<HTMLDivElement | null>(null)
  const attractRef = useRef<HTMLDivElement | null>(null)
  const attractBestRef = useRef<HTMLDivElement | null>(null)
  const deadRef = useRef<HTMLDivElement | null>(null)
  const deadScoreRef = useRef<HTMLSpanElement | null>(null)
  const deadBestRef = useRef<HTMLSpanElement | null>(null)

  const W = useRef<World>({
    w: 0, h: 0, dpr: 1, sc: 1, t: 0,
    mode: 'attract', score: 0, best: 0, cleared: false, level: 0,
    playerY: 0.5, targetY: 0.5, vy: 0, tilt: 0,
    speed: 0, travel: 0, dist: 0,
    walls: [], orbs: [],
    parts: [], partCursor: 0,
    pops: [], popCursor: 0,
    trailX: new Float32Array(TRAIL_N), trailY: new Float32Array(TRAIL_N),
    trailN: 0, trailHead: TRAIL_N - 1,
    lastGapY: -1,
    emitT: 0,
    grazeStreak: 0, grazeChainT: 0,
    slowT: 0, pulseT: 0,
    flash: 0, shake: 0, deathT: 0,
    raf: 0, last: 0,
  })

  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  /* 单挂载 effect：建全部引擎资源；[active] effect 负责启停 */
  useEffect(() => {
    const w = W.current
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scoreEl = scoreRef.current
    const bestEl = bestRef.current
    const hudEl = hudRef.current
    const hudBestEl = hudBestRef.current
    const chipEl = chipRef.current
    const chipNumEl = chipNumRef.current
    const bannerEl = bannerRef.current
    const attractEl = attractRef.current
    const attractBestEl = attractBestRef.current
    const deadEl = deadRef.current
    const deadScoreEl = deadScoreRef.current
    const deadBestEl = deadBestRef.current

    if (w.parts.length === 0) w.parts = makeParts()
    if (w.pops.length === 0) w.pops = makePops()

    let running = false
    let disposed = false
    let muted = useBookStore.getState().muted

    /* ---------- 弹字字体：解析 attitude（Space Mono）字体族 ---------- */
    let fam = 'ui-monospace, monospace'
    try {
      const probe = document.createElement('div')
      probe.className = 'font-attitude'
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      root.appendChild(probe)
      const f = getComputedStyle(probe).fontFamily
      if (f) fam = f
      probe.remove()
    } catch {
      /* 忽略 */
    }

    /* ---------- 离屏 sprite（所有发光一次性烘焙） ---------- */
    const mk = (sw: number, sh: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null => {
      try {
        const c = document.createElement('canvas')
        c.width = sw
        c.height = sh
        const g = c.getContext('2d')
        return g ? [c, g] : null
      } catch {
        return null
      }
    }

    // 船：白热核心镖形 + 绿晕
    const shipSpr = mk(160, 112)
    if (shipSpr) {
      const [c, g] = shipSpr
      const cx = 80
      const cy = 56
      const L = 64
      const Wd = 30
      const rg = g.createRadialGradient(cx, cy, 4, cx, cy, 56)
      rg.addColorStop(0, 'rgba(61,255,110,0.55)')
      rg.addColorStop(0.55, 'rgba(61,255,110,0.16)')
      rg.addColorStop(1, 'rgba(61,255,110,0)')
      g.fillStyle = rg
      g.fillRect(0, 0, 160, 112)
      const dart = (l: number, wd: number, dx: number) => {
        g.beginPath()
        g.moveTo(cx + dx + l * 0.5, cy)
        g.lineTo(cx + dx - l * 0.5, cy - wd * 0.5)
        g.lineTo(cx + dx - l * 0.18, cy)
        g.lineTo(cx + dx - l * 0.5, cy + wd * 0.5)
        g.closePath()
      }
      dart(L, Wd, 0)
      g.fillStyle = NEON
      g.fill()
      g.strokeStyle = 'rgba(234,255,240,0.9)'
      g.lineWidth = 2
      g.stroke()
      dart(L * 0.52, Wd * 0.4, L * 0.14)
      g.fillStyle = HOT
      g.fill()
    }

    // 粒子光点 sprite：0 绿 / 1 白 / 2 琥珀 / 3 品红
    const DOTS: HTMLCanvasElement[] = []
    const dotCols = ['61,255,110', '234,255,240', '255,182,70', '255,46,136']
    for (let i = 0; i < 4; i++) {
      const d = mk(28, 28)
      if (!d) continue
      const rg = d[1].createRadialGradient(14, 14, 0, 14, 14, 14)
      rg.addColorStop(0, 'rgba(255,255,255,0.95)')
      rg.addColorStop(0.3, `rgba(${dotCols[i]},0.9)`)
      rg.addColorStop(1, `rgba(${dotCols[i]},0)`)
      d[1].fillStyle = rg
      d[1].fillRect(0, 0, 28, 28)
      DOTS.push(d[0])
    }

    // 能量球 sprite（琥珀 + 白热芯）
    const orbSpr = mk(56, 56)
    if (orbSpr) {
      const rg = orbSpr[1].createRadialGradient(28, 28, 1, 28, 28, 28)
      rg.addColorStop(0, 'rgba(255,246,220,1)')
      rg.addColorStop(0.22, 'rgba(255,182,70,0.95)')
      rg.addColorStop(0.5, 'rgba(255,182,70,0.34)')
      rg.addColorStop(1, 'rgba(255,182,70,0)')
      orbSpr[1].fillStyle = rg
      orbSpr[1].fillRect(0, 0, 56, 56)
    }

    // 墙条 sprite（竖向霓虹条，横向渐变烘焙，纵向拉伸绘制）
    const mkBar = (r: number, g_: number, b: number, core: string): HTMLCanvasElement | null => {
      const m = mk(30, 8)
      if (!m) return null
      const lg = m[1].createLinearGradient(0, 0, 30, 0)
      lg.addColorStop(0, `rgba(${r},${g_},${b},0)`)
      lg.addColorStop(0.28, `rgba(${r},${g_},${b},0.2)`)
      lg.addColorStop(0.5, `rgba(${r},${g_},${b},0.85)`)
      lg.addColorStop(0.72, `rgba(${r},${g_},${b},0.2)`)
      lg.addColorStop(1, `rgba(${r},${g_},${b},0)`)
      m[1].fillStyle = lg
      m[1].fillRect(0, 0, 30, 8)
      m[1].fillStyle = core
      m[1].fillRect(13, 0, 4, 8)
      return m[0]
    }
    const barNeon = mkBar(61, 255, 110, '#bfffd0')
    const barMag = mkBar(255, 46, 136, '#ffc4da')

    // CRT 滚动亮带 sprite
    const bandSpr = mk(4, 200)
    if (bandSpr) {
      const lg = bandSpr[1].createLinearGradient(0, 0, 0, 200)
      lg.addColorStop(0, 'rgba(234,255,240,0)')
      lg.addColorStop(0.5, 'rgba(234,255,240,0.85)')
      lg.addColorStop(1, 'rgba(234,255,240,0)')
      bandSpr[1].fillStyle = lg
      bandSpr[1].fillRect(0, 0, 4, 200)
    }

    /* ---------- 音频（master + muted 订阅 + 手势懒建） ---------- */
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let noiseBuf: AudioBuffer | null = null
    let humOsc: OscillatorNode | null = null
    let humGain: GainNode | null = null
    let humAcc = 0

    const ensureAudio = () => {
      if (ac || disposed) return
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        ac = new AC()
        master = ac.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(ac.destination)
        noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate)
        const ch = noiseBuf.getChannelData(0)
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1
        humOsc = ac.createOscillator()
        humOsc.type = 'sawtooth'
        humOsc.frequency.value = 60
        const flt = ac.createBiquadFilter()
        flt.type = 'lowpass'
        flt.frequency.value = 240
        flt.Q.value = 0.8
        humGain = ac.createGain()
        humGain.gain.value = 0
        humOsc.connect(flt)
        flt.connect(humGain)
        humGain.connect(master)
        humOsc.start()
        void ac.resume()
      } catch {
        ac = null
        master = null
        noiseBuf = null
        humOsc = null
        humGain = null
      }
    }

    const humSet = (on: boolean, freq: number) => {
      if (!ac || !humGain || !humOsc) return
      const n = ac.currentTime
      try {
        humGain.gain.setTargetAtTime(on ? 0.05 : 0, n, 0.12)
        humOsc.frequency.setTargetAtTime(freq, n, 0.1)
      } catch {
        /* 忽略 */
      }
    }

    const tone = (
      type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0,
    ) => {
      if (!ac || !master || muted) return
      try {
        const t0 = ac.currentTime + delay
        const o = ac.createOscillator()
        const g = ac.createGain()
        o.type = type
        o.frequency.setValueAtTime(f0, t0)
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur)
        g.gain.setValueAtTime(vol, t0)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        o.connect(g)
        g.connect(master)
        o.start(t0)
        o.stop(t0 + dur + 0.03)
      } catch {
        /* 忽略 */
      }
    }

    const noise = (f0: number, f1: number, dur: number, vol: number, q = 1) => {
      if (!ac || !master || !noiseBuf || muted) return
      try {
        const t0 = ac.currentTime
        const src = ac.createBufferSource()
        src.buffer = noiseBuf
        const bp = ac.createBiquadFilter()
        bp.type = 'bandpass'
        bp.Q.value = q
        bp.frequency.setValueAtTime(f0, t0)
        bp.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
        const g = ac.createGain()
        g.gain.setValueAtTime(vol, t0)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        src.connect(bp)
        bp.connect(g)
        g.connect(master)
        src.start(t0)
        src.stop(t0 + dur + 0.05)
      } catch {
        /* 忽略 */
      }
    }

    const sfxWhoosh = () => noise(1500, 240, 0.22, 0.12, 1.1)
    const sfxArp = () => {
      for (let i = 0; i < 5; i++) tone('sine', ARP_FREQ[i], ARP_FREQ[i], 0.24, 0.06, i * 0.055)
    }
    const sfxZing = () => {
      tone('sawtooth', 1900, 3400, 0.09, 0.035)
      tone('sine', 2600, 3900, 0.07, 0.03)
    }
    const sfxBoom = () => {
      noise(900, 100, 0.5, 0.28, 0.7)
      tone('sine', 200, 36, 0.5, 0.3)
      tone('square', 90, 30, 0.3, 0.12)
    }
    const sfxHorn = () => {
      tone('triangle', 392, 392, 0.14, 0.1)
      tone('triangle', 523.25, 523.25, 0.24, 0.1, 0.12)
    }
    const sfxSnap = () => noise(2600, 900, 0.06, 0.06, 2)
    const sfxStart = () => tone('square', 420, 700, 0.09, 0.06)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (ac && master) {
        try {
          master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05)
        } catch {
          /* 忽略 */
        }
      }
    })

    /* ---------- DOM 辅助 ---------- */
    const setText = (el: HTMLElement | null, v: string) => {
      if (el && el.textContent !== v) el.textContent = v
    }
    const retrigger = (el: HTMLElement | null, cls: string) => {
      if (!el) return
      el.classList.remove(cls)
      void el.offsetWidth
      el.classList.add(cls)
    }

    /* ---------- 几何 ---------- */
    const shipX = (): number => w.w * 0.18
    const shipR = (): number => 8.5 * w.sc

    const rectDist = (
      cx: number, cy: number, rx: number, ry: number, rw: number, rh: number,
    ): number => {
      const nx = clamp(cx, rx, rx + rw)
      const ny = clamp(cy, ry, ry + rh)
      return Math.hypot(cx - nx, cy - ny)
    }

    /* ---------- 粒子池 ---------- */
    const partAt = (): Part => {
      for (let i = 0; i < PARTS_MAX; i++) {
        w.partCursor = (w.partCursor + 1) % PARTS_MAX
        if (!w.parts[w.partCursor].alive) return w.parts[w.partCursor]
      }
      return w.parts[w.partCursor]
    }

    const spawnPart = (
      x: number, y: number, vx: number, vy: number,
      life: number, size: number, kind: 0 | 1 | 2 | 3, grav: number,
    ) => {
      const p = partAt()
      p.alive = true
      p.x = x
      p.y = y
      p.vx = vx
      p.vy = vy
      p.life = life
      p.maxLife = life
      p.size = size
      p.kind = kind
      p.frag = false
      p.rot = 0
      p.vr = 0
      p.len = 0
      p.grav = grav
    }

    const sparkBurst = (x: number, y: number, n: number, kind: 0 | 1 | 2 | 3) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.2832
        const sp = (60 + Math.random() * 260) * w.sc
        spawnPart(
          x, y, Math.cos(a) * sp, Math.sin(a) * sp,
          0.3 + Math.random() * 0.25, (1 + Math.random() * 2) * w.sc, kind, 240,
        )
      }
    }

    /* ---------- 弹字池 ---------- */
    const popup = (x: number, y: number, text: string, color: string, size: number, chroma: boolean) => {
      const p = w.pops[w.popCursor]
      w.popCursor = (w.popCursor + 1) % POPS_MAX
      p.alive = true
      p.x = x
      p.y = y
      p.vy = -46 * w.sc
      p.life = 0.85
      p.maxLife = 0.85
      p.text = text
      p.color = color
      p.chroma = chroma
      p.font = `700 ${Math.round(size * w.sc)}px ${fam}`
    }

    /* ---------- 计分 / 通关 ---------- */
    const addScore = (n: number) => {
      w.score += n
      setText(scoreEl, String(w.score))
      retrigger(scoreEl, 'dodge-pop')
      if (w.score > w.best) {
        w.best = w.score
        setText(bestEl, String(w.best))
      }
      if (w.score >= CLEAR_SCORE && !w.cleared) {
        w.cleared = true
        useBookStore.getState().clearRoom(15)
      }
      const lv = Math.floor(w.score / 10)
      if (lv > w.level) {
        w.level = lv
        retrigger(bannerEl, 'dodge-banner-go')
        sfxHorn()
      }
    }

    const doGraze = (x: number, y: number) => {
      w.grazeStreak++
      w.grazeChainT = 5
      addScore(2)
      popup(x, y - 24 * w.sc, 'GRAZE', HOT, 16, true)
      sparkBurst(x, y, 9, 1)
      sparkBurst(x, y, 5, 0)
      w.slowT = 0.09
      w.pulseT = 0.18
      sfxZing()
      if (chipEl) {
        chipEl.classList.add('on')
        setText(chipNumEl, String(w.grazeStreak))
        retrigger(chipEl, 'dodge-pop')
      }
    }

    /* ---------- 出生 ---------- */
    const spawnWall = (demo: boolean) => {
      if (w.walls.length > 9) return
      let kind: WallKind = 0
      if (!demo) {
        const maxKind = w.score < 4 ? 0 : w.score < 8 ? 1 : w.score < 12 ? 2 : w.score < 16 ? 3 : 4
        kind = (Math.floor(Math.random() * (maxKind + 1)) % 5) as WallKind
        if (kind !== 0 && Math.random() < 0.3) kind = 0
      }
      let gapH = demo ? w.h * 0.42 : w.h * clamp(0.33 - w.score * 0.003, 0.19, 0.33)
      if (kind === 3) gapH *= 1.12
      const margin = gapH / 2 + w.h * 0.07
      let gy = margin + Math.random() * (w.h - margin * 2)
      if (w.lastGapY >= 0) {
        gy = clamp(gy, w.lastGapY - w.h * 0.42, w.lastGapY + w.h * 0.42)
      }
      gy = clamp(gy, margin, w.h - margin)
      const bw = (kind === 3 ? 13 : kind === 4 ? 11 : 10) * w.sc
      const wl: Wall = {
        kind, x: w.w + 30, bw, gapY: gy, gapH,
        baseGapY: gy, baseGapH: gapH,
        ph: Math.random() * 6.2832,
        spd: 0, amp: 0, live: 0, passed: false, minD: 1e9,
      }
      if (kind === 1) {
        let amp = w.h * (0.09 + Math.random() * 0.08)
        amp = Math.min(amp, gy - gapH / 2 - 4, w.h - gapH / 2 - gy - 4)
        wl.amp = Math.max(0, amp)
        wl.spd = 0.9 + Math.random() * 0.9
      } else if (kind === 2) {
        wl.amp = gapH * (0.16 + Math.random() * 0.1)
        wl.spd = 1.3 + Math.random()
      } else if (kind === 4) {
        wl.baseGapH = w.h * (0.4 + Math.random() * 0.12)
        wl.gapH = wl.baseGapH
        wl.spd = (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 1.1)
      }
      w.walls.push(wl)
      w.lastGapY = gy
      // 琥珀能量球：刷在缝边缘 ±30px 高风险位（仅普通/滑动/呼吸缝）
      if (!demo && kind <= 2 && Math.random() < 0.45 && w.orbs.length < 5) {
        const side = Math.random() < 0.5 ? -1 : 1
        w.orbs.push({
          x: wl.x + bw * 0.5, y: gy, wall: wl, side,
          off: 9 + Math.random() * 21, magT: 0, ph: Math.random() * 6.2832,
        })
      }
    }

    /* ---------- 死亡 ---------- */
    const die = () => {
      w.mode = 'dead'
      w.deathT = 0
      w.flash = 1
      w.shake = 7 * w.sc
      const px = shipX()
      const py = w.playerY
      for (let i = 0; i < 24; i++) {
        const ang = Math.random() * 6.2832
        const sp = (130 + Math.random() * 480) * w.sc
        const p = partAt()
        p.alive = true
        p.x = px
        p.y = py
        p.vx = Math.cos(ang) * sp
        p.vy = Math.sin(ang) * sp - 120 * w.sc
        p.life = 1.1 + Math.random() * 0.5
        p.maxLife = p.life
        p.kind = (i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : 3) as 0 | 1 | 3
        p.frag = true
        p.size = 1.8 * w.sc
        p.rot = Math.random() * 6.2832
        p.vr = (Math.random() - 0.5) * 24
        p.len = (5 + Math.random() * 12) * w.sc
        p.grav = 900
      }
      try {
        window.localStorage.setItem(BEST_KEY, String(w.best))
      } catch {
        /* 隐私模式等场景忽略 */
      }
      setText(deadScoreEl, String(w.score))
      setText(deadBestEl, String(w.best))
      deadEl?.classList.add('on')
      chipEl?.classList.remove('on')
      humSet(false, 60)
      sfxBoom()
    }

    /* ---------- 开局 / 重开 ---------- */
    const beginPlay = () => {
      ensureAudio()
      if (ac && ac.state === 'suspended') void ac.resume()
      w.mode = 'play'
      w.score = 0
      w.level = 0
      w.cleared = false
      w.grazeStreak = 0
      w.grazeChainT = 0
      w.walls.length = 0
      w.orbs.length = 0
      for (const p of w.parts) p.alive = false
      for (const p of w.pops) p.alive = false
      w.trailN = 0
      w.trailHead = TRAIL_N - 1
      w.dist = w.w * 0.3
      w.lastGapY = -1
      w.flash = 0
      w.shake = 0
      w.slowT = 0
      w.pulseT = 0
      w.deathT = 0
      w.emitT = 0
      w.playerY = w.h / 2
      w.vy = 0
      w.tilt = 0
      setText(scoreEl, '0')
      setText(bestEl, String(w.best))
      attractEl?.classList.remove('on')
      deadEl?.classList.remove('on')
      hudEl?.classList.add('on')
      hudBestEl?.classList.add('on')
      chipEl?.classList.remove('on')
      sfxStart()
      humSet(true, 46 + (150 + 95 * w.sc) * 0.16)
    }

    /* ---------- 绘制 ---------- */
    const drawSpinner = (wl: Wall) => {
      const cx = wl.x + wl.bw / 2
      const cy = wl.gapY
      const len = wl.baseGapH
      if (barNeon) {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(wl.ph)
        ctx.drawImage(barNeon, -len / 2, -wl.bw * 1.3, len, wl.bw * 2.6)
        ctx.restore()
      }
      const hs = 14 * w.sc
      if (DOTS.length > 1) ctx.drawImage(DOTS[1], cx - hs / 2, cy - hs / 2, hs, hs)
      const dx = Math.cos(wl.ph)
      const dy = Math.sin(wl.ph)
      ctx.globalAlpha = 0.95
      ctx.fillStyle = HOT
      ctx.fillRect(cx + dx * len * 0.5 - 2, cy + dy * len * 0.5 - 2, 4, 4)
      ctx.fillRect(cx - dx * len * 0.5 - 2, cy - dy * len * 0.5 - 2, 4, 4)
    }

    const drawParts = (frags: boolean) => {
      for (let i = 0; i < PARTS_MAX; i++) {
        const p = w.parts[i]
        if (!p.alive || p.frag !== frags) continue
        const k = clamp(p.life / p.maxLife, 0, 1)
        if (p.frag) {
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.globalAlpha = k
          ctx.fillStyle = FRAG_COLORS[p.kind]
          ctx.fillRect(-p.len / 2, -p.size / 2, p.len, p.size)
          ctx.restore()
        } else {
          const s = p.size * (0.5 + k) * 4.6
          const spr = DOTS[p.kind]
          if (spr) {
            ctx.globalAlpha = k * 0.9
            ctx.drawImage(spr, p.x - s / 2, p.y - s / 2, s, s)
          }
        }
      }
    }

    const draw = () => {
      if (w.w < 40 || w.h < 40) return
      const shx = w.shake > 0.15 ? (Math.random() - 0.5) * 2 * w.shake : 0
      const shy = w.shake > 0.15 ? (Math.random() - 0.5) * 2 * w.shake : 0
      const px = shipX()
      ctx.setTransform(w.dpr, 0, 0, w.dpr, w.dpr * shx, w.dpr * shy)

      // 底色 + 档位变调
      ctx.globalAlpha = 1
      ctx.fillStyle = BG
      ctx.fillRect(-10, -10, w.w + 20, w.h + 20)
      ctx.fillStyle = LEVEL_TINT[w.level % LEVEL_TINT.length]
      ctx.fillRect(0, 0, w.w, w.h)

      // 深度参考：滚动竖线 + 高速流光
      ctx.fillStyle = NEON
      ctx.globalAlpha = 0.045
      const gl = 84 * w.sc
      const off = w.travel % gl
      for (let gx = -off; gx < w.w; gx += gl) ctx.fillRect(gx, 0, 1, w.h)
      if (w.mode !== 'dead') {
        ctx.fillStyle = HOT
        ctx.globalAlpha = 0.06
        for (let i = 0; i < 8; i++) {
          const sy = ((i * 0.6180339887) * w.h) % w.h
          const fac = 1.5 + ((i * 37) % 10) / 10
          const len = (50 + ((i * 53) % 60)) * w.sc
          const x = w.w - ((w.travel * fac + i * 211) % (w.w + len)) - len
          ctx.fillRect(x, sy, len, 1)
        }
      }

      // 墙
      const alphaMul = w.mode === 'attract' ? 0.5 : 1
      for (const wl of w.walls) {
        if (wl.kind === 4) {
          ctx.globalAlpha = alphaMul
          drawSpinner(wl)
          continue
        }
        const gt = wl.gapY - wl.gapH / 2
        const gb = wl.gapY + wl.gapH / 2
        if (wl.kind === 3 && wl.live === 0) {
          // 激光预警：行军蚁虚线 + 微填充
          ctx.globalAlpha = (0.35 + 0.2 * Math.sin(w.t * 18)) * alphaMul
          ctx.strokeStyle = MAGENTA
          ctx.lineWidth = 1.5
          ctx.setLineDash(DASH)
          ctx.lineDashOffset = -w.t * 46
          ctx.strokeRect(wl.x, 0.5, wl.bw, Math.max(0, gt - 1))
          ctx.strokeRect(wl.x, gb + 0.5, wl.bw, Math.max(0, w.h - gb - 1))
          ctx.setLineDash(EMPTY_DASH)
          ctx.globalAlpha = 0.07 * alphaMul
          ctx.fillStyle = MAGENTA
          ctx.fillRect(wl.x, 0, wl.bw, gt)
          ctx.fillRect(wl.x, gb, wl.bw, w.h - gb)
          continue
        }
        const spr = wl.kind === 3 ? barMag : barNeon
        if (spr) {
          const dw = wl.bw * 2.6
          const dx = wl.x + wl.bw / 2 - dw / 2
          ctx.globalAlpha = alphaMul
          if (gt > 0) ctx.drawImage(spr, dx, 0, dw, gt)
          if (gb < w.h) ctx.drawImage(spr, dx, gb, dw, w.h - gb)
        }
        // 缝口热帽
        ctx.globalAlpha = 0.95 * alphaMul
        ctx.fillStyle = wl.kind === 3 ? '#ffd9e6' : HOT
        ctx.fillRect(wl.x - 1.5, gt - 2, wl.bw + 3, 2)
        ctx.fillRect(wl.x - 1.5, gb, wl.bw + 3, 2)
        // 缘电火花
        if (Math.random() < 0.3) {
          ctx.globalAlpha = 0.8 * alphaMul
          const sy = Math.random() < 0.5 ? gt : gb
          ctx.fillRect(wl.x + (Math.random() * 10 - 5), sy - 0.8, 4 + Math.random() * 8, 1.6)
        }
      }

      /* —— 发光元素统一 additive —— */
      ctx.globalCompositeOperation = 'lighter'

      // 能量球
      if (orbSpr) {
        for (const o of w.orbs) {
          const r = (8.5 + Math.sin(w.t * 5 + o.ph) * 1.6) * w.sc
          const ds = r * 2.8
          ctx.globalAlpha = 1
          ctx.drawImage(orbSpr[0], o.x - ds / 2, o.y - ds / 2, ds, ds)
          if (o.magT > 0) {
            ctx.globalAlpha = Math.min(1, o.magT / 0.2) * 0.55
            ctx.strokeStyle = AMBER
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(o.x, o.y, r + 7 * w.sc, 0, 6.2832)
            ctx.stroke()
          }
        }
      }

      // 丝带轨迹（宽度渐细 + alpha 渐隐）
      if (w.mode === 'play' && w.trailN > 1) {
        ctx.strokeStyle = NEON
        ctx.lineCap = 'round'
        for (let i = 1; i < w.trailN; i++) {
          const idx = (w.trailHead - i + TRAIL_N) % TRAIL_N
          const prev = (w.trailHead - i + 1 + TRAIL_N) % TRAIL_N
          const k = 1 - i / w.trailN
          const a = 0.05 + 0.3 * k * k
          if (a < 0.055) continue
          ctx.globalAlpha = a
          ctx.lineWidth = Math.max(0.5, shipR() * 1.5 * k * k)
          ctx.beginPath()
          ctx.moveTo(w.trailX[prev], w.trailY[prev])
          ctx.lineTo(w.trailX[idx], w.trailY[idx])
          ctx.stroke()
        }
      }

      // 引擎粒子 / 火花（非碎片）
      drawParts(false)

      // 船（转向倾斜）
      if (w.mode === 'play' && shipSpr) {
        const L = clamp(34 * w.sc, 22, 48)
        const dw = L * 2.5
        const dh = dw * 0.7
        ctx.globalAlpha = 1
        ctx.save()
        ctx.translate(px, w.playerY)
        ctx.rotate(w.tilt)
        ctx.drawImage(shipSpr[0], -dw / 2, -dh / 2, dw, dh)
        ctx.restore()
      }

      // 船碎片段
      drawParts(true)

      ctx.globalCompositeOperation = 'source-over'

      // 弹字
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const p of w.pops) {
        if (!p.alive) continue
        const k = clamp(p.life / p.maxLife, 0, 1)
        ctx.font = p.font
        if (p.chroma) {
          ctx.globalAlpha = k * 0.6
          ctx.fillStyle = MAGENTA
          ctx.fillText(p.text, p.x - 2.5, p.y)
          ctx.fillStyle = NEON
          ctx.fillText(p.text, p.x + 2.5, p.y)
        }
        ctx.globalAlpha = Math.min(1, k * 1.6)
        ctx.fillStyle = p.color
        ctx.fillText(p.text, p.x, p.y)
      }

      // 色差脉冲（擦弹）
      if (w.pulseT > 0) {
        const k = w.pulseT / 0.18
        ctx.globalAlpha = 0.075 * k
        ctx.fillStyle = MAGENTA
        ctx.fillRect(0, 0, w.w * 0.5, w.h)
        ctx.fillStyle = NEON
        ctx.fillRect(w.w * 0.5, 0, w.w * 0.5, w.h)
      }

      // CRT 滚动亮带
      if (bandSpr) {
        const bh = w.h * 0.18
        const by = ((w.t * 0.07) % 1.25) * (w.h + bh) - bh
        ctx.globalAlpha = 0.05
        ctx.drawImage(bandSpr[0], 0, by, w.w, bh)
      }

      // 待机压暗
      if (w.mode === 'attract') {
        ctx.globalAlpha = 0.25
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, w.w, w.h)
      }

      // 死亡白闪
      if (w.flash > 0.012) {
        ctx.globalAlpha = Math.min(1, w.flash) * 0.85
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w.w, w.h)
      }
      ctx.globalAlpha = 1
    }

    /* ---------- 主循环 ---------- */
    const step = (now: number) => {
      const rawDt = Math.min(0.05, Math.max(0.001, (now - w.last) / 1000))
      w.last = now
      w.t += rawDt
      w.deathT += rawDt
      let ts = 1
      if (w.slowT > 0) {
        ts = 0.35
        w.slowT -= rawDt
      } else if (w.mode === 'dead' && w.deathT < 0.4) {
        ts = 0.3
      }
      const dt = rawDt * ts

      w.flash *= Math.exp(-rawDt * 3.6)
      w.shake *= Math.exp(-rawDt * 4.6)
      if (w.pulseT > 0) w.pulseT -= rawDt
      if (w.grazeChainT > 0) {
        w.grazeChainT -= rawDt
        if (w.grazeChainT <= 0) {
          w.grazeStreak = 0
          chipEl?.classList.remove('on')
        }
      }

      // 待机：预置演示墙
      if (w.mode === 'attract' && w.walls.length === 0 && w.w > 40) {
        for (let i = 0; i < 3; i++) {
          spawnWall(true)
          const wl = w.walls[w.walls.length - 1]
          if (wl) wl.x = w.w * (0.5 + i * 0.28)
        }
      }

      // 世界速度
      if (w.mode === 'play') {
        w.speed = (150 + 95 * w.sc + w.score * 1.55) * Math.pow(1.15, w.level)
      } else if (w.mode === 'attract') {
        w.speed = (150 + 95 * w.sc) * 0.72
      } else {
        w.speed = 0
      }
      const spd = w.speed
      w.travel += spd * dt

      // 生成
      if (w.mode !== 'dead') {
        w.dist += spd * dt
        const spacing = clamp(spd * 1.08, w.w * 0.34, w.w * 0.66)
        if (w.dist >= spacing && w.w > 40) {
          w.dist = 0
          spawnWall(w.mode === 'attract')
        }
      }

      // 墙演化
      for (let i = w.walls.length - 1; i >= 0; i--) {
        const wl = w.walls[i]
        wl.x -= spd * dt
        if (wl.kind === 1) {
          wl.ph += wl.spd * dt
          wl.gapY = clamp(
            wl.baseGapY + Math.sin(wl.ph) * wl.amp,
            wl.gapH / 2 + 3, w.h - wl.gapH / 2 - 3,
          )
        } else if (wl.kind === 2) {
          wl.ph += wl.spd * dt
          wl.gapH = Math.max(w.h * 0.12, wl.baseGapH + Math.sin(wl.ph) * wl.amp)
        } else if (wl.kind === 4) {
          wl.ph += wl.spd * dt
        } else if (wl.kind === 3 && wl.live === 0) {
          if (wl.x + wl.bw < shipX() + spd * LASER_AHEAD) {
            wl.live = 1
            const gt = wl.gapY - wl.gapH / 2
            const gb = wl.gapY + wl.gapH / 2
            sparkBurst(wl.x + wl.bw / 2, gt, 4, 3)
            sparkBurst(wl.x + wl.bw / 2, gb, 4, 3)
            sfxSnap()
          }
        }
        if (wl.x < -80) w.walls.splice(i, 1)
      }

      const px = shipX()
      const pr = shipR()

      // 能量球：随缝 / 磁吸 / 拾取
      for (let i = w.orbs.length - 1; i >= 0; i--) {
        const o = w.orbs[i]
        const ow = o.wall
        if (ow) {
          o.x = ow.x + ow.bw * 0.5
          const edge = ow.gapY + o.side * (ow.gapH / 2)
          o.y = edge + o.side * o.off
        } else if (w.mode !== 'dead') {
          o.x -= spd * dt
        }
        if (w.mode === 'play') {
          const dx = px - o.x
          const dy = w.playerY - o.y
          const d2 = dx * dx + dy * dy
          const mr = MAG_R * w.sc
          if (d2 < mr * mr) {
            o.magT = 0.2
            if (ow) o.wall = null
            const k = Math.min(1, dt * 7)
            o.x += dx * k
            o.y += dy * k
          }
          const cr = pr + 9 * w.sc
          if (d2 < cr * cr) {
            addScore(1)
            popup(o.x, o.y - 14 * w.sc, '+1', AMBER, 13, false)
            sparkBurst(o.x, o.y, 12, 2)
            sfxArp()
            w.orbs.splice(i, 1)
            continue
          }
        }
        if (o.magT > 0) o.magT -= rawDt
        if (o.x < -30) w.orbs.splice(i, 1)
      }

      // 船
      if (w.mode === 'play') {
        const prevY = w.playerY
        w.playerY += (w.targetY - w.playerY) * Math.min(1, dt * 11)
        w.playerY = clamp(w.playerY, pr + 3, w.h - pr - 3)
        const instV = (w.playerY - prevY) / Math.max(0.001, rawDt)
        w.vy += (instV - w.vy) * Math.min(1, rawDt * 14)
        const targetTilt = clamp(w.vy * 0.0011, -0.21, 0.21)
        w.tilt += (targetTilt - w.tilt) * Math.min(1, rawDt * 12)

        // 丝带轨迹（整体随世界左移）
        for (let i = 0; i < w.trailN; i++) w.trailX[i] -= spd * dt
        w.trailHead = (w.trailHead + 1) % TRAIL_N
        w.trailX[w.trailHead] = px
        w.trailY[w.trailHead] = w.playerY
        if (w.trailN < TRAIL_N) w.trailN++

        // 引擎粒子尾
        w.emitT -= dt
        while (w.emitT <= 0) {
          w.emitT += 0.02
          spawnPart(
            px - 13 * w.sc,
            w.playerY + (Math.random() - 0.5) * 7 * w.sc,
            -spd * 0.22 - Math.random() * 40,
            (Math.random() - 0.5) * 34 - w.vy * 0.12,
            0.22 + Math.random() * 0.3,
            (1 + Math.random() * 1.8) * w.sc,
            Math.random() < 0.25 ? 1 : 0,
            0,
          )
        }

        // 引擎嗡鸣音高∝速度
        humAcc += rawDt
        if (humAcc > 0.14) {
          humAcc = 0
          humSet(true, 46 + w.speed * 0.16)
        }
      }

      // 粒子演化
      for (let i = 0; i < PARTS_MAX; i++) {
        const p = w.parts[i]
        if (!p.alive) continue
        p.life -= dt
        if (p.life <= 0) {
          p.alive = false
          continue
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += p.grav * dt
        p.rot += p.vr * dt
        if (!p.frag) {
          p.vx *= Math.exp(-dt * 2.2)
          p.vy *= Math.exp(-dt * 2.2)
        }
      }

      // 碰撞 / 过墙 / 擦弹
      if (w.mode === 'play') {
        for (const wl of w.walls) {
          const overlapX = wl.x < px + pr && wl.x + wl.bw > px - pr
          if (wl.kind === 4) {
            const cx = wl.x + wl.bw / 2
            const cy = wl.gapY
            const half = wl.baseGapH / 2
            const dx = Math.cos(wl.ph)
            const dy = Math.sin(wl.ph)
            const rel = clamp((px - cx) * dx + (w.playerY - cy) * dy, -half, half)
            const qx = cx + dx * rel
            const qy = cy + dy * rel
            const d = Math.hypot(px - qx, w.playerY - qy) - pr - wl.bw * 0.5
            if (overlapX) {
              if (d <= 0) {
                die()
                break
              }
              if (d < wl.minD) wl.minD = d
            }
          } else {
            const solid = wl.kind !== 3 || wl.live === 1
            if (overlapX && solid) {
              const gt = wl.gapY - wl.gapH / 2
              const gb = wl.gapY + wl.gapH / 2
              const d = Math.min(
                rectDist(px, w.playerY, wl.x, 0, wl.bw, gt),
                rectDist(px, w.playerY, wl.x, gb, wl.bw, w.h - gb),
              ) - pr
              if (d <= 0) {
                die()
                break
              }
              if (d < wl.minD) wl.minD = d
            }
          }
          if (!wl.passed && wl.x + wl.bw < px - pr) {
            wl.passed = true
            if (w.mode === 'play') {
              addScore(1)
              sfxWhoosh()
              if (wl.minD < GRAZE_PX * clamp(w.sc, 0.8, 1.3)) {
                doGraze(px + 10 * w.sc, w.playerY)
              }
            }
          }
        }
      }

      // 弹字演化
      for (const p of w.pops) {
        if (!p.alive) continue
        p.life -= rawDt
        if (p.life <= 0) {
          p.alive = false
          continue
        }
        p.y += p.vy * rawDt
      }

      draw()
      w.raf = requestAnimationFrame(step)
    }

    /* ---------- 尺寸自适应 ---------- */
    const resize = () => {
      const cw = root.clientWidth
      const chh = root.clientHeight
      if (cw < 40 || chh < 40) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(cw * dpr)
      canvas.height = Math.round(chh * dpr)
      const first = w.w === 0
      w.w = cw
      w.h = chh
      w.dpr = dpr
      w.sc = clamp(Math.min(cw, chh) / 780, 0.6, 1.35)
      if (first) {
        w.playerY = chh / 2
        w.targetY = chh / 2
      }
      w.playerY = clamp(w.playerY, 10, chh - 10)
      if (!running) draw()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    /* ---------- BEST 载入（SSR 安全） ---------- */
    try {
      const v = window.localStorage.getItem(BEST_KEY)
      if (v) {
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && n > 0) {
          w.best = n
          setText(bestEl, String(n))
          if (attractBestEl) {
            attractBestEl.textContent = `BEST ${n}`
            attractBestEl.style.visibility = 'visible'
          }
        }
      }
    } catch {
      /* 隐私模式等场景忽略 */
    }
    attractEl?.classList.add('on')

    /* ---------- 指针（挂 canvas） ---------- */
    const onMove = (e: PointerEvent) => {
      if (w.mode === 'dead') return
      const rect = canvas.getBoundingClientRect()
      w.targetY = clamp(e.clientY - rect.top, 0, w.h)
      if (w.mode === 'attract') beginPlay()
    }
    const onDown = (e: PointerEvent) => {
      ensureAudio()
      if (ac && ac.state === 'suspended') void ac.resume()
      const rect = canvas.getBoundingClientRect()
      w.targetY = clamp(e.clientY - rect.top, 0, w.h)
      if (w.mode === 'attract') beginPlay()
      else if (w.mode === 'dead' && w.deathT > RETRY_GUARD) beginPlay()
      e.preventDefault()
    }
    const onCtx = (e: Event) => e.preventDefault()
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('contextmenu', onCtx)

    /* ---------- 启停 ---------- */
    const start = () => {
      if (disposed || running) return
      running = true
      w.last = performance.now()
      if (ac && ac.state === 'suspended') void ac.resume()
      w.raf = requestAnimationFrame(step)
    }
    const stop = () => {
      running = false
      if (w.raf) cancelAnimationFrame(w.raf)
      w.raf = 0
      if (ac && ac.state === 'running') void ac.suspend()
    }
    ctrlRef.current = { start, stop }

    return () => {
      disposed = true
      running = false
      if (w.raf) cancelAnimationFrame(w.raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('contextmenu', onCtx)
      unsubMute()
      if (ac) {
        void ac.close()
        ac = null
        master = null
        noiseBuf = null
        humOsc = null
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
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: BG, touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ display: 'block' }} />

      {/* 扫描线 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)',
        }}
      />
      {/* 边缘暗角 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.6) 100%)',
        }}
      />
      {/* 顶部微光 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: '28cqh',
          background: 'linear-gradient(180deg, rgba(61,255,110,0.05), transparent)',
        }}
      />

      {/* HUD · SCORE 左上 */}
      <div
        ref={hudRef}
        className="dodge-fade pointer-events-none absolute"
        style={{ left: '9cqw', top: '5cqh' }}
      >
        <div
          className="font-attitude"
          style={{
            fontSize: 'clamp(7px, 1.2cqw, 11px)',
            letterSpacing: '0.34em',
            color: 'rgba(217,210,192,0.6)',
          }}
        >
          SCORE 得分
        </div>
        <div
          ref={scoreRef}
          className="font-attitude"
          style={{
            fontSize: '6.2cqh',
            lineHeight: 1.05,
            color: NEON,
            textShadow: '0 0 18px rgba(61,255,110,0.55)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          0
        </div>
      </div>

      {/* HUD · BEST 右上 */}
      <div
        ref={hudBestRef}
        className="dodge-fade pointer-events-none absolute text-right"
        style={{ right: '9cqw', top: '5cqh' }}
      >
        <div
          className="font-attitude"
          style={{
            fontSize: 'clamp(7px, 1.2cqw, 11px)',
            letterSpacing: '0.34em',
            color: 'rgba(217,210,192,0.6)',
          }}
        >
          BEST 纪录
        </div>
        <div
          ref={bestRef}
          className="font-attitude"
          style={{
            fontSize: '3.4cqh',
            lineHeight: 1.2,
            color: BONE,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          0
        </div>
      </div>

      {/* 连擦计数 chip 左下（首次擦弹后出现） */}
      <div
        ref={chipRef}
        className="dodge-fade dodge-chip font-attitude pointer-events-none absolute"
        style={{ left: '9cqw', bottom: '13cqh' }}
      >
        GRAZE 擦 ×<span ref={chipNumRef}>0</span>
      </div>

      {/* SPEED UP 横幅 */}
      <div
        ref={bannerRef}
        className="dodge-banner font-display pointer-events-none absolute inset-x-0"
        style={{ top: '30cqh', textAlign: 'center', opacity: 0 }}
      >
        SPEED UP
      </div>

      {/* 待机态 */}
      <div
        ref={attractRef}
        className="dodge-fade pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
      >
        <div
          className="font-display"
          style={{
            fontSize: 'min(9cqw, 13cqh)',
            color: NEON,
            textShadow:
              '0 0 34px rgba(61,255,110,0.5), 3px 0 rgba(255,46,136,0.4), -3px 0 rgba(61,255,110,0.4)',
          }}
        >
          NEON DASH
        </div>
        <div
          className="font-cn"
          style={{
            fontSize: 'min(3.4cqw, 4.6cqh)',
            letterSpacing: '0.85em',
            textIndent: '0.85em',
            color: 'rgba(61,255,110,0.85)',
            marginTop: '1.6cqh',
          }}
        >
          霓虹疾驰
        </div>
        <div
          className="font-attitude"
          style={{
            fontSize: 'clamp(8px, 1.4cqw, 12px)',
            letterSpacing: '0.4em',
            color: 'rgba(217,210,192,0.55)',
            marginTop: '2.6cqh',
          }}
        >
          DODGE LINE · 躲避线
        </div>
        <div
          className="dodge-breathe font-cn"
          style={{
            fontSize: 'clamp(10px, 1.9cqw, 16px)',
            letterSpacing: '0.5em',
            textIndent: '0.5em',
            color: HOT,
            marginTop: '4.2cqh',
          }}
        >
          点击 / 触碰 开始
        </div>
        <div
          ref={attractBestRef}
          className="font-attitude"
          style={{
            fontSize: 'clamp(8px, 1.3cqw, 11px)',
            letterSpacing: '0.3em',
            color: 'rgba(217,210,192,0.5)',
            marginTop: '2.2cqh',
            visibility: 'hidden',
          }}
        >
          BEST 0
        </div>
      </div>

      {/* 死亡面板 */}
      <div
        ref={deadRef}
        className="dodge-dead pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div
          style={{
            border: '1px solid rgba(255,46,136,0.6)',
            background: 'rgba(2,18,10,0.88)',
            padding: '3.2cqh 5cqw',
            textAlign: 'center',
            boxShadow: '0 0 44px rgba(255,46,136,0.18)',
          }}
        >
          <div
            className="font-display"
            style={{
              fontSize: 'min(4.2cqw, 6cqh)',
              color: MAGENTA,
              letterSpacing: '0.14em',
              textShadow: '0 0 22px rgba(255,46,136,0.5)',
            }}
          >
            LINE DOWN
          </div>
          <div
            className="font-cn"
            style={{
              fontSize: 'clamp(9px, 1.7cqw, 14px)',
              letterSpacing: '0.6em',
              textIndent: '0.6em',
              color: 'rgba(255,46,136,0.75)',
              margin: '1.2cqh 0 1.8cqh',
            }}
          >
            线路中断
          </div>
          <div
            className="font-attitude"
            style={{
              fontSize: '2cqh',
              letterSpacing: '0.3em',
              color: 'rgba(217,210,192,0.6)',
            }}
          >
            SCORE <span ref={deadScoreRef} style={{ color: NEON }}>0</span>
          </div>
          <div
            className="font-attitude"
            style={{
              fontSize: '1.7cqh',
              letterSpacing: '0.3em',
              color: 'rgba(217,210,192,0.55)',
              margin: '0.6cqh 0 2cqh',
            }}
          >
            BEST <span ref={deadBestRef} style={{ color: BONE }}>0</span>
          </div>
          <div
            className="dodge-breathe font-cn"
            style={{
              fontSize: 'clamp(10px, 1.8cqw, 15px)',
              letterSpacing: '0.4em',
              textIndent: '0.4em',
              color: HOT,
            }}
          >
            点击重来 · RETRY
          </div>
        </div>
      </div>

      {/* 署名（底部居中，避开左右热区与角部页码徽章） */}
      <div
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center"
        style={{ bottom: '3.8cqh' }}
      >
        <div
          style={{
            fontSize: 'clamp(8px, 1.35cqw, 12px)',
            letterSpacing: '0.42em',
            textIndent: '0.42em',
            color: 'rgba(217,210,192,0.62)',
          }}
        >
          <span className="font-cn">躲避线</span>
          <span className="font-attitude" style={{ margin: '0 0.9em', letterSpacing: '0.3em' }}>
            DODGE LINE
          </span>
          <span className="font-cn" style={{ color: 'rgba(61,255,110,0.6)' }}>移动 · 驾驶</span>
        </div>
      </div>

      <style>{`
        .dodge-fade { opacity: 0; transition: opacity 0.25s ease; }
        .dodge-fade.on { opacity: 1; }
        .dodge-dead { opacity: 0; transition: opacity 0.16s ease 0s; }
        .dodge-dead.on { opacity: 1; transition: opacity 0.3s ease 0.4s; }
        .dodge-chip {
          border: 1px solid rgba(61,255,110,0.55);
          background: rgba(2,18,10,0.72);
          color: ${NEON};
          padding: 0.9cqh 1.6cqw;
          font-size: clamp(9px, 1.5cqw, 13px);
          letter-spacing: 0.24em;
          text-shadow: 0 0 12px rgba(61,255,110,0.4);
        }
        .dodge-banner {
          font-size: min(6.5cqw, 9cqh);
          letter-spacing: 0.5em;
          text-indent: 0.5em;
          color: ${HOT};
          text-shadow: 0 0 26px rgba(61,255,110,0.6), 3px 0 rgba(255,46,136,0.55), -3px 0 rgba(61,255,110,0.55);
        }
        @keyframes dodge-breathe {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 1; }
        }
        .dodge-breathe { animation: dodge-breathe 1.8s ease-in-out infinite; }
        @keyframes dodge-pop {
          from { transform: scale(1.3); }
          to { transform: scale(1); }
        }
        .dodge-pop { animation: dodge-pop 0.16s ease-out; }
        @keyframes dodge-banner-fx {
          0% { opacity: 0; transform: scale(1.4); }
          12% { opacity: 1; transform: scale(1); }
          70% { opacity: 1; }
          100% { opacity: 0; transform: scale(0.96); }
        }
        .dodge-banner-go { animation: dodge-banner-fx 1.15s ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .dodge-breathe { animation: none; opacity: 0.8; }
        }
      `}</style>
    </div>
  )
}
