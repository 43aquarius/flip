'use client'

/**
 * ROOM 04 · GLITCH GARDEN 故障花园 — 数字植物标本园
 * 近黑底 (#060606) 上的硬边几何植物：贝塞尔茎 + 叶片 + 三型几何花头
 * （同心方 / 三角花瓣 / 圆环芯点），品红 #ff2ea6 / 荧光绿 #37ff8b / 白。
 * 交互：轻点空地栽种新株（满 8 株最老一株切片溶解）；指针横移掀起风场，
 * 植株按高度² 弯折；指针逼近花头引发局部腐坏（抖动 / 通道换色）；
 * 按住指针展开腐败区（重切片 + 通道分离），松手回弹一次强故障，
 * 按住 ≥1.2s 触发全屏故障风暴。周期风暴（2.5-5s）随指针活跃度增强。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const TAU = Math.PI * 2
const MAG = '#ff2ea6'
const GRN = '#37ff8b'
const WHT = '#ffffff'
const INK = '#0a0a0a' // 花头深色描边，硬边冲击力

/** 花头三色调色板（品红/绿/白全排列） */
const PALS: string[][] = [
  [MAG, GRN, WHT],
  [MAG, WHT, GRN],
  [GRN, MAG, WHT],
  [GRN, WHT, MAG],
  [WHT, MAG, GRN],
  [WHT, GRN, MAG],
]

interface Leaf {
  /** 茎上位置 0..1 */
  u: number
  side: 1 | -1
  /** 叶长占株高比例 */
  lf: number
  white: boolean
}

interface Plant {
  /** 基部 x 位置（页宽比例） */
  xf: number
  born: number
  dieAt: number | null
  /** 株高（页高比例） */
  hf: number
  lean: number
  phase: number
  swaySpd: number
  stemW: number
  stemWhite: boolean
  headType: 0 | 1 | 2
  /** 花头尺寸（短边比例） */
  headSf: number
  rot0: number
  spin: number
  pal: string[]
  petals: number
  leaves: Leaf[]
  // 溶解缓存（切片死亡动画的离屏快照）
  deathCv: HTMLCanvasElement | null
  deathW: number
  deathH: number
  deathLeft: number
  deathTop: number
}

const MAX_PLANTS = 8

export default function Art04({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const countRef = useRef<HTMLSpanElement | null>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    let m = 1 // min(w, h)
    let groundY = 0
    let raf = 0
    let running = false
    let disposed = false
    let t = 0
    let last = 0

    // 风场 / 活跃度 / 故障包络
    let wind = 0
    let windTarget = 0
    let activity = 0
    let stormEnv = 0
    let stormPeak = 0
    let stormRising = false
    let snapEnv = 0
    let nextStorm = 1.8

    // 按压状态（轻点=栽种，长按=腐蚀）
    let holding = false
    let holdT0 = 0
    let holdMoved = 0
    let downAtMs = 0
    let downX = 0
    let downY = 0

    let muted = useBookStore.getState().muted
    let lastCount = 4

    const pointer = { x: -9e4, y: -9e4, inside: false, lastX: 0, lastY: 0, lastT: 0 }

    const plants: Plant[] = []
    let dots: Array<{ x: number; y: number; s: number; c: string }> = []
    let ticks: Array<{ x: number; hgt: number; c: string }> = []

    // ---------- 离屏画布 ----------
    const gardenCv = document.createElement('canvas') // 花园缓冲（每帧矢量重绘）
    const gardenCtx = gardenCv.getContext('2d')
    const chMagCv = document.createElement('canvas') // 品红版
    const chGreenCv = document.createElement('canvas') // 荧光绿版
    const chWhiteCv = document.createElement('canvas') // 白版
    const chansDef: Array<[HTMLCanvasElement, string]> = [
      [chMagCv, MAG],
      [chGreenCv, GRN],
      [chWhiteCv, '#ffffff'],
    ]
    // 腐败区（小尺寸通道快照，避免全屏开销）
    const zoneMagCv = document.createElement('canvas')
    const zoneGrnCv = document.createElement('canvas')
    const zoneWhtCv = document.createElement('canvas')

    const ensureSquareCanvas = (cv: HTMLCanvasElement, px: number) => {
      const n = Math.max(2, Math.ceil(px))
      if (cv.width !== n) cv.width = n
      if (cv.height !== n) cv.height = n
    }

    // ---------- 音频 ----------
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let noiseBuf: AudioBuffer | null = null

    const initAudio = () => {
      if (ac || disposed) return
      try {
        const ctxA = new AudioContext()
        ac = ctxA
        master = ctxA.createGain()
        master.gain.value = muted ? 0 : 0.45
        master.connect(ctxA.destination)
        const len = Math.floor(ctxA.sampleRate * 0.6)
        noiseBuf = ctxA.createBuffer(1, len, ctxA.sampleRate)
        const data = noiseBuf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      } catch {
        ac = null
        master = null
      }
    }

    const bleep = (strong: boolean) => {
      if (!ac || !master || muted) return
      const n = ac.currentTime
      const o = ac.createOscillator()
      o.type = 'square'
      const f0 = strong ? 640 : 220 + Math.random() * 700
      o.frequency.setValueAtTime(f0, n)
      o.frequency.exponentialRampToValueAtTime(strong ? 40 : 90, n + (strong ? 0.4 : 0.07))
      const g = ac.createGain()
      g.gain.setValueAtTime(strong ? 0.2 : 0.055, n)
      g.gain.exponentialRampToValueAtTime(0.001, n + (strong ? 0.42 : 0.09))
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + (strong ? 0.45 : 0.1))
      if (strong && noiseBuf) {
        const src = ac.createBufferSource()
        src.buffer = noiseBuf
        const g2 = ac.createGain()
        g2.gain.setValueAtTime(0.16, n)
        g2.gain.exponentialRampToValueAtTime(0.001, n + 0.34)
        src.connect(g2)
        g2.connect(master)
        src.start(n)
        src.stop(n + 0.36)
      }
    }

    /** 栽种：柔和上行双音 */
    const plantSound = () => {
      if (!ac || !master || muted) return
      const A = ac
      const M = master
      const n = A.currentTime
      const note = (f0: number, f1: number, delay: number, vol: number) => {
        const o = A.createOscillator()
        o.type = 'sine'
        o.frequency.setValueAtTime(f0, n + delay)
        o.frequency.exponentialRampToValueAtTime(f1, n + delay + 0.15)
        const g = A.createGain()
        g.gain.setValueAtTime(0.0001, n + delay)
        g.gain.exponentialRampToValueAtTime(vol, n + delay + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, n + delay + 0.26)
        o.connect(g)
        g.connect(M)
        o.start(n + delay)
        o.stop(n + delay + 0.28)
      }
      note(330, 540, 0, 0.1)
      note(540, 810, 0.09, 0.07)
    }

    /** 溶解：下行噪声爆 */
    const dissolveSound = () => {
      if (!ac || !master || muted || !noiseBuf) return
      const A = ac
      const M = master
      const n = A.currentTime
      const src = A.createBufferSource()
      src.buffer = noiseBuf
      src.loop = true
      const filt = A.createBiquadFilter()
      filt.type = 'bandpass'
      filt.Q.value = 0.9
      filt.frequency.setValueAtTime(2800, n)
      filt.frequency.exponentialRampToValueAtTime(150, n + 0.5)
      const g = A.createGain()
      g.gain.setValueAtTime(0.13, n)
      g.gain.exponentialRampToValueAtTime(0.0001, n + 0.55)
      src.connect(filt)
      filt.connect(g)
      g.connect(M)
      src.start(n)
      src.stop(n + 0.58)
    }

    // ---------- 数学小件 ----------
    const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
    const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3)
    const easeOutBack = (x: number) => {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
    }
    const qBez = (u: number, a: number, b: number, c: number) =>
      (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c
    /** 30Hz 确定性闪烁噪声（用于花头腐坏抖动） */
    const noise2 = (seed: number, salt: number) => {
      const v = Math.sin(seed * 127.1 + salt * 311.7 + Math.floor(t * 30) * 74.7) * 43758.5453
      return v - Math.floor(v)
    }

    // ---------- 植株 ----------
    const makePlant = (xf: number, bornAt: number): Plant => {
      const leafN = 2 + Math.floor(Math.random() * 3) // 2-4 叶
      const leaves: Leaf[] = []
      const side0: 1 | -1 = Math.random() < 0.5 ? 1 : -1
      for (let i = 0; i < leafN; i++) {
        const side: 1 | -1 = i % 2 === 0 ? side0 : side0 === 1 ? -1 : 1
        leaves.push({
          u: Math.min(0.78, 0.28 + i * (0.5 / leafN) + Math.random() * 0.08),
          side,
          lf: 0.13 + Math.random() * 0.1,
          white: Math.random() < 0.18,
        })
      }
      return {
        xf,
        born: bornAt,
        dieAt: null,
        hf: 0.2 + Math.random() * 0.2,
        lean: (Math.random() - 0.5) * 0.16,
        phase: Math.random() * TAU,
        swaySpd: 0.9 + Math.random() * 0.9,
        stemW: 1.5 + Math.random() * 1.5,
        stemWhite: Math.random() < 0.3,
        headType: Math.floor(Math.random() * 3) as 0 | 1 | 2,
        headSf: 0.028 + Math.random() * 0.018,
        rot0: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 0.5,
        pal: PALS[Math.floor(Math.random() * PALS.length)],
        petals: 5 + Math.floor(Math.random() * 3), // 5-7 三角花瓣
        leaves,
        deathCv: null,
        deathW: 0,
        deathH: 0,
        deathLeft: 0,
        deathTop: 0,
      }
    }

    /** 当帧几何：茎长 / 弯折 / 花头位置（弯曲量随高度² 增大） */
    const plantGeom = (p: Plant) => {
      const x = p.xf * w
      const H = p.hf * h
      const grow = clamp01((t - p.born) / 0.9)
      const stemP = clamp01(grow / 0.62)
      const headP = clamp01((grow - 0.5) / 0.5)
      const stemLen = H * easeOutCubic(stemP)
      const k = stemLen / H
      const swayF = Math.sin(t * p.swaySpd + p.phase) * (0.025 + Math.abs(wind) * 0.11)
      let wb = wind * Math.pow(H / Math.max(1, h * 0.34), 2) * H * 0.3
      const wbMax = H * 0.6
      if (wb > wbMax) wb = wbMax
      else if (wb < -wbMax) wb = -wbMax
      const bend = (p.lean + swayF) * H + wb
      return {
        x,
        H,
        stemP,
        headP,
        k,
        bend,
        tipX: x + bend * k,
        tipY: groundY - stemLen,
        cxq: x + bend * k * 0.3,
        cyq: groundY - stemLen * 0.52,
      }
    }

    const drawLeafShape = (
      g: CanvasRenderingContext2D,
      lx: number,
      ly: number,
      L: number,
      side: 1 | -1,
      white: boolean,
    ) => {
      if (L < 2) return
      const a = side === 1 ? -0.42 : Math.PI + 0.42
      const tx = lx + Math.cos(a) * L
      const ty = ly + Math.sin(a) * L
      const mx = (lx + tx) / 2
      const my = (ly + ty) / 2
      const px = Math.cos(a - Math.PI / 2)
      const py = Math.sin(a - Math.PI / 2)
      const wd = L * 0.34
      g.beginPath()
      g.moveTo(lx, ly)
      g.quadraticCurveTo(mx + px * wd, my + py * wd, tx, ty)
      g.quadraticCurveTo(mx - px * wd * 0.7, my - py * wd * 0.7, lx, ly)
      g.closePath()
      g.fillStyle = white ? '#e9e9e9' : GRN
      g.fill()
      g.strokeStyle = INK
      g.lineWidth = 1
      g.stroke()
    }

    /** 几何花头：0 同心方 / 1 三角花瓣 / 2 圆环芯点 */
    const drawHead = (g: CanvasRenderingContext2D, p: Plant, S: number, pal: string[]) => {
      g.lineWidth = 1.2
      g.strokeStyle = INK
      if (p.headType === 0) {
        const sizes = [1, 0.62, 0.3]
        const rots = [0, 0.55, 1.05]
        for (let i = 0; i < 3; i++) {
          const s = S * sizes[i]
          g.save()
          g.rotate(rots[i])
          g.fillStyle = pal[i]
          g.fillRect(-s / 2, -s / 2, s, s)
          g.strokeRect(-s / 2, -s / 2, s, s)
          g.restore()
        }
      } else if (p.headType === 1) {
        const n = p.petals
        const R1 = S * 0.95
        const R0 = S * 0.3
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU
          g.beginPath()
          g.moveTo(Math.cos(a) * R1, Math.sin(a) * R1)
          g.lineTo(Math.cos(a - 0.42) * R0, Math.sin(a - 0.42) * R0)
          g.lineTo(Math.cos(a + 0.42) * R0, Math.sin(a + 0.42) * R0)
          g.closePath()
          g.fillStyle = pal[k % 2]
          g.fill()
          g.stroke()
        }
        g.beginPath()
        g.arc(0, 0, S * 0.3, 0, TAU)
        g.fillStyle = pal[2]
        g.fill()
        g.stroke()
      } else {
        g.beginPath()
        g.arc(0, 0, S * 0.8, 0, TAU)
        g.fillStyle = pal[0]
        g.fill()
        g.stroke()
        g.beginPath()
        g.arc(0, 0, S * 0.48, 0, TAU)
        g.strokeStyle = pal[1]
        g.lineWidth = Math.max(1.5, S * 0.13)
        g.stroke()
        g.beginPath()
        g.arc(0, 0, S * 0.2, 0, TAU)
        g.fillStyle = pal[2]
        g.fill()
      }
    }

    const drawPlant = (
      g: CanvasRenderingContext2D,
      p: Plant,
      geo: ReturnType<typeof plantGeom>,
      corr: number,
    ) => {
      if (geo.stemP <= 0) return
      // 茎
      g.strokeStyle = p.stemWhite ? 'rgba(255,255,255,0.92)' : 'rgba(55,255,139,0.95)'
      g.lineWidth = p.stemW
      g.lineCap = 'butt'
      g.beginPath()
      g.moveTo(geo.x, groundY + 2)
      g.quadraticCurveTo(geo.cxq, geo.cyq, geo.tipX, geo.tipY)
      g.stroke()
      // 叶（随茎生长依次展开）
      for (const lf of p.leaves) {
        if (lf.u > geo.stemP) continue
        const ls = clamp01((geo.stemP - lf.u) / 0.25)
        if (ls <= 0) continue
        const lx = qBez(lf.u, geo.x, geo.cxq, geo.tipX)
        const ly = qBez(lf.u, groundY, geo.cyq, geo.tipY)
        const L = lf.lf * geo.H * ls * (1 + Math.abs(wind) * 0.18)
        drawLeafShape(g, lx, ly, L, lf.side, lf.white)
      }
      // 花头（先茎后头，弹性绽放）
      if (geo.headP > 0) {
        let pal = p.pal
        if (corr > 0.12 && noise2(p.phase, 0) < 0.28 + corr * 0.4) {
          pal = [p.pal[1], p.pal[0], p.pal[2]] // 通道换色闪烁
        }
        const amp = 2 + corr * 2 // 2-4px 抖动
        const jx = (noise2(p.phase, 1) - 0.5) * 2 * amp
        const jy = (noise2(p.phase, 2) - 0.5) * 2 * amp
        const S = p.headSf * m
        const hs = Math.max(0, easeOutBack(geo.headP))
        g.save()
        g.translate(geo.tipX + jx, geo.tipY + jy)
        g.rotate(p.rot0 + t * p.spin + wind * 0.12)
        g.scale(hs, hs)
        drawHead(g, p, S, pal)
        g.restore()
      }
    }

    /** 切片溶解：水平条带位移 + 淡出，~0.6s */
    const drawDyingPlant = (g: CanvasRenderingContext2D, p: Plant) => {
      const p01 = (t - (p.dieAt ?? t)) / 0.62
      if (p01 >= 1) return
      const geo = plantGeom(p)
      const S = p.headSf * m
      if (!p.deathCv) {
        const bw = Math.ceil(geo.H * 1.4 + S * 2.6 + 24)
        const bh = Math.ceil(geo.H + S * 3.2 + 24)
        const cv = document.createElement('canvas')
        cv.width = Math.max(2, Math.ceil(bw * dpr))
        cv.height = Math.max(2, Math.ceil(bh * dpr))
        p.deathCv = cv
        p.deathW = bw
        p.deathH = bh
        p.deathLeft = geo.x - bw / 2
        p.deathTop = groundY + 8 - bh
      }
      const c = p.deathCv.getContext('2d')
      if (!c) return
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, p.deathW, p.deathH)
      c.save()
      c.translate(p.deathW / 2 - geo.x, p.deathH - 8 - groundY)
      drawPlant(c, p, geo, 0)
      c.restore()
      const stripH = 4
      for (let yy = 0; yy < p.deathH; yy += stripH) {
        if (Math.random() < p01 * 0.5) continue // 条带随机脱落
        const dx = (Math.random() - 0.5) * (6 + 36 * p01)
        g.globalAlpha = Math.max(0, 1 - p01) * (0.6 + Math.random() * 0.4)
        g.drawImage(
          p.deathCv,
          0,
          yy * dpr,
          p.deathCv.width,
          stripH * dpr,
          p.deathLeft + dx,
          p.deathTop + yy,
          p.deathW,
          stripH,
        )
      }
      g.globalAlpha = 1
    }

    /** 轻点栽种：满 8 株时最老一株 glitch-dissolve */
    const plantAt = (x: number) => {
      let xf = x / w
      for (const p of plants) {
        if (p.dieAt !== null) continue
        if (Math.abs(p.xf * w - x) < 20) {
          xf = (x + (p.xf * w > x ? -26 : 26)) / w
          break
        }
      }
      xf = Math.max(0.05, Math.min(0.95, xf))
      const alive = plants.filter((p) => p.dieAt === null)
      if (alive.length >= MAX_PLANTS) {
        let oldest = alive[0]
        for (const p of alive) if (p.born < oldest.born) oldest = p
        oldest.dieAt = t
        oldest.deathCv = null
        dissolveSound()
      }
      plants.push(makePlant(xf, t))
      plantSound()
      snapEnv = Math.max(snapEnv, 0.22) // 栽种瞬间的轻微数字插入感
    }

    // ---------- 花园缓冲（每帧矢量重绘，硬边 crisp） ----------
    const drawGarden = () => {
      const g = gardenCtx
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.globalAlpha = 1
      g.globalCompositeOperation = 'source-over'
      g.fillStyle = '#060606'
      g.fillRect(0, 0, w, h)
      // 孢子噪点
      for (const d of dots) {
        g.fillStyle = d.c
        g.fillRect(d.x, d.y, d.s, d.s)
      }
      // 土壤微染 + 地平线
      g.fillStyle = 'rgba(255,46,166,0.045)'
      g.fillRect(0, groundY + 1, w, h - groundY - 1)
      g.strokeStyle = 'rgba(242,242,242,0.34)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(0, groundY + 0.5)
      g.lineTo(w, groundY + 0.5)
      g.stroke()
      for (const tk of ticks) {
        g.strokeStyle = tk.c
        g.beginPath()
        g.moveTo(tk.x + 0.5, groundY + 2)
        g.lineTo(tk.x + 0.5, groundY + 2 + tk.hgt)
        g.stroke()
      }
      // 植株（活体矢量 / 死亡切片）
      for (const p of plants) {
        if (p.dieAt !== null) {
          drawDyingPlant(g, p)
          continue
        }
        const geo = plantGeom(p)
        let corr = 0
        if (pointer.inside && geo.headP > 0) {
          const dd = Math.hypot(pointer.x - geo.tipX, pointer.y - geo.tipY)
          if (dd < 120) corr = Math.pow(1 - dd / 120, 1.4)
        }
        drawPlant(g, p, geo, corr)
      }
    }

    // ---------- 通道分离 ----------
    const buildChannels = () => {
      for (const [cv, col] of chansDef) {
        const c = cv.getContext('2d')
        if (!c) continue
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.globalCompositeOperation = 'source-over'
        c.drawImage(gardenCv, 0, 0)
        c.globalCompositeOperation = 'multiply'
        c.fillStyle = col
        c.fillRect(0, 0, cv.width, cv.height)
        c.globalCompositeOperation = 'source-over'
      }
    }

    const buildZoneChannels = (zx: number, zy: number, side: number) => {
      const px = side * dpr
      ensureSquareCanvas(zoneMagCv, px)
      ensureSquareCanvas(zoneGrnCv, px)
      ensureSquareCanvas(zoneWhtCv, px)
      const src: Array<[HTMLCanvasElement, string]> = [
        [zoneMagCv, MAG],
        [zoneGrnCv, GRN],
        [zoneWhtCv, '#ffffff'],
      ]
      for (const [cv, col] of src) {
        const c = cv.getContext('2d')
        if (!c) continue
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.globalCompositeOperation = 'source-over'
        c.clearRect(0, 0, cv.width, cv.height)
        c.drawImage(gardenCv, zx * dpr, zy * dpr, px, px, 0, 0, px, px)
        c.globalCompositeOperation = 'multiply'
        c.fillStyle = col
        c.fillRect(0, 0, px, px)
        c.globalCompositeOperation = 'source-over'
      }
    }

    // ---------- 腐败区（按住指针） ----------
    const drawCorruptZone = () => {
      const holdT = t - holdT0
      if (holdT < 0.12) return
      const grow = Math.min(1, holdT / 1.4)
      const zInt = Math.min(1, 0.3 + holdT * 0.5)
      let side = (76 + grow * 74) * (1 + (Math.random() - 0.5) * 0.1) // ~76-150px 闪烁
      side = Math.min(side, Math.min(w, h) * 0.92)
      const zx = Math.max(0, Math.min(w - side, pointer.x - side / 2))
      const zy = Math.max(0, Math.min(h - side, pointer.y - side / 2))
      buildZoneChannels(zx, zy, side)
      ctx.save()
      ctx.beginPath()
      ctx.rect(zx, zy, side, side)
      ctx.clip()
      ctx.fillStyle = '#060606'
      ctx.fillRect(zx, zy, side, side)
      const off = 2 + zInt * 8
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 0.45
      ctx.drawImage(zoneMagCv, 0, 0, side * dpr, side * dpr, zx + off * 0.9, zy + off * 0.3, side, side)
      ctx.drawImage(zoneGrnCv, 0, 0, side * dpr, side * dpr, zx - off * 0.85, zy - off * 0.4, side, side)
      ctx.globalAlpha = 1
      ctx.drawImage(zoneWhtCv, 0, 0, side * dpr, side * dpr, zx + (Math.random() - 0.5) * off, zy + off * 0.15, side, side)
      ctx.globalCompositeOperation = 'source-over'
      // 区域内重切片位移
      const ns = 3 + Math.floor(zInt * 5)
      for (let i = 0; i < ns; i++) {
        const sy = zy + Math.random() * side
        let sh = 2 + Math.random() * 8
        sh = Math.min(sh, zy + side - sy)
        if (sh <= 0.5) continue
        const dx = (Math.random() - 0.5) * (16 + zInt * 56)
        ctx.drawImage(gardenCv, zx * dpr, sy * dpr, side * dpr, sh * dpr, zx + dx, sy, side, sh)
      }
      if (Math.random() < 0.32) {
        ctx.globalCompositeOperation = 'difference'
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(
          zx + Math.random() * side * 0.6,
          zy + Math.random() * side * 0.6,
          10 + Math.random() * side * 0.35,
          6 + Math.random() * 16,
        )
        ctx.globalCompositeOperation = 'source-over'
      }
      ctx.restore()
      // 闪烁硬边框 + 角标
      const cyc = Math.floor(t * 24) % 3
      ctx.strokeStyle = cyc === 0 ? MAG : cyc === 1 ? GRN : 'rgba(242,242,242,0.9)'
      ctx.lineWidth = 1
      const rx = Math.round(zx) + 0.5
      const ry = Math.round(zy) + 0.5
      const rs = Math.round(side) - 1
      ctx.strokeRect(rx, ry, rs, rs)
      const tl = 7
      ctx.beginPath()
      ctx.moveTo(rx, ry + tl)
      ctx.lineTo(rx, ry)
      ctx.lineTo(rx + tl, ry)
      ctx.moveTo(rx + rs - tl, ry)
      ctx.lineTo(rx + rs, ry)
      ctx.lineTo(rx + rs, ry + tl)
      ctx.moveTo(rx + rs, ry + rs - tl)
      ctx.lineTo(rx + rs, ry + rs)
      ctx.lineTo(rx + rs - tl, ry + rs)
      ctx.moveTo(rx + tl, ry + rs)
      ctx.lineTo(rx, ry + rs)
      ctx.lineTo(rx, ry + rs - tl)
      ctx.stroke()
    }

    // ---------- 主合成 ----------
    const renderFrame = () => {
      drawGarden()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      const env = Math.max(stormEnv, snapEnv)
      if (env > 0.035) {
        // 风暴 / 回弹：三色版偏移复合（品红/绿/白 通道分离）
        buildChannels()
        ctx.fillStyle = '#060606'
        ctx.fillRect(0, 0, w, h)
        const off = 1.5 + env * 9
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.45
        ctx.drawImage(chMagCv, off * 0.9, off * 0.3, w, h)
        ctx.drawImage(chGreenCv, -off * 0.85, -off * 0.4, w, h)
        ctx.globalAlpha = 1
        ctx.drawImage(chWhiteCv, (Math.random() - 0.5) * off * 0.8, off * 0.15, w, h)
        ctx.globalCompositeOperation = 'source-over'
        // 横向切片位移
        const n = Math.min(20, 1 + Math.floor(env * 6 + Math.random() * 3))
        for (let i = 0; i < n; i++) {
          const sy = Math.random() * h
          let sh = 3 + Math.random() * (10 + env * 26)
          sh = Math.min(sh, h - sy)
          if (sh <= 0.5) continue
          const dx = (Math.random() - 0.5) * (26 + env * 130)
          ctx.drawImage(gardenCv, 0, sy * dpr, w * dpr, sh * dpr, dx, sy, w, sh)
        }
        // 块 Shuffle（整块位移拷贝）
        if (env > 0.4) {
          const bn = 1 + Math.floor(Math.random() * 2)
          for (let i = 0; i < bn; i++) {
            const bw2 = 26 + Math.random() * 80
            const bh2 = 12 + Math.random() * 34
            const bx = Math.random() * Math.max(1, w - bw2)
            const by = Math.random() * Math.max(1, h - bh2)
            const dx = (Math.random() - 0.5) * 90
            const dy = (Math.random() - 0.5) * 22
            ctx.drawImage(gardenCv, bx * dpr, by * dpr, bw2 * dpr, bh2 * dpr, bx + dx, by + dy, bw2, bh2)
          }
        }
        // 随机反色块
        if (env > 0.7 && Math.random() < 0.3) {
          ctx.globalCompositeOperation = 'difference'
          ctx.fillStyle = '#ffffff'
          const bn = 1 + Math.floor(Math.random() * 2)
          for (let i = 0; i < bn; i++) {
            ctx.fillRect(Math.random() * w, Math.random() * h, 12 + Math.random() * 70, 6 + Math.random() * 26)
          }
          ctx.globalCompositeOperation = 'source-over'
        }
        // 调色横条
        if (Math.random() < env * 0.5) {
          ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,46,166,0.18)' : 'rgba(55,255,139,0.16)'
          ctx.fillRect(0, Math.random() * h, w, 2 + Math.random() * 5)
        }
      } else {
        // 平静期：整园 crisp 直绘
        ctx.drawImage(gardenCv, 0, 0, w, h)
      }
      if (holding && (t - holdT0 > 0.35 || holdMoved >= 10)) drawCorruptZone()
    }

    // ---------- 步进 ----------
    const fireStorm = (peak: number) => {
      stormPeak = peak
      stormRising = true
    }

    const step = (dt: number) => {
      t += dt
      activity *= Math.exp(-1.6 * dt)
      windTarget *= Math.exp(-2.6 * dt)
      wind += (windTarget - wind) * (1 - Math.exp(-7 * dt))
      if (holding) activity = Math.min(1, activity + dt * 0.1)
      // 风暴调度
      if (stormRising) {
        stormEnv += dt * 12 // 0→1 快攻
        if (stormEnv >= stormPeak) {
          stormEnv = stormPeak
          stormRising = false
        }
      } else {
        stormEnv *= Math.exp(-2.4 * dt)
      }
      snapEnv *= Math.exp(-7 * dt)
      if (t >= nextStorm) {
        fireStorm(Math.min(1.35, 0.55 + activity * 0.65 + Math.random() * 0.2))
        nextStorm = t + 2.5 + Math.random() * 2.5
        bleep(false)
      }
      // 清理死透的植株
      for (let i = plants.length - 1; i >= 0; i--) {
        const p = plants[i]
        if (p.dieAt !== null && t - p.dieAt >= 0.62) plants.splice(i, 1)
      }
      // 标本计数（DOM 直写，不经 React state）
      const n = plants.reduce((a, p) => a + (p.dieAt === null ? 1 : 0), 0)
      if (n !== lastCount && countRef.current) {
        lastCount = n
        countRef.current.textContent = String(n).padStart(2, '0')
      }
    }

    const frame = (now: number) => {
      if (!running || disposed) return
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      if (dt <= 0) dt = 1 / 120
      step(dt)
      renderFrame()
      raf = requestAnimationFrame(frame)
    }

    // ---------- 尺寸 ----------
    const renderStatic = () => {
      drawGarden()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(gardenCv, 0, 0, w, h)
    }

    const resize = () => {
      const rect = root.getBoundingClientRect()
      const nw = Math.max(1, Math.round(rect.width))
      const nh = Math.max(1, Math.round(rect.height))
      const ndpr = Math.min(window.devicePixelRatio || 1, 2)
      if (nw === w && nh === h && ndpr === dpr) return
      w = nw
      h = nh
      dpr = ndpr
      m = Math.min(w, h)
      groundY = Math.round(h * 0.87)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gardenCv.width = canvas.width
      gardenCv.height = canvas.height
      for (const [cv] of chansDef) {
        cv.width = canvas.width
        cv.height = canvas.height
      }
      // 孢子噪点
      dots = []
      for (let i = 0; i < 110; i++) {
        const r = Math.random()
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          s: Math.random() < 0.12 ? 2 : 1,
          c:
            r < 0.1
              ? 'rgba(255,46,166,0.28)'
              : r < 0.2
                ? 'rgba(55,255,139,0.24)'
                : `rgba(255,255,255,${(0.04 + Math.random() * 0.14).toFixed(3)})`,
        })
      }
      // 地平线刻度
      ticks = []
      const stepX = Math.max(24, w / 30)
      let k = 0
      for (let x = stepX * 0.5; x < w; x += stepX) {
        ticks.push({
          x,
          hgt: k % 4 === 0 ? 6 : 3,
          c:
            k % 4 === 0
              ? 'rgba(242,242,242,0.4)'
              : k % 2 === 0
                ? 'rgba(255,46,166,0.4)'
                : 'rgba(55,255,139,0.35)',
        })
        k++
      }
      // 失效溶解缓存（尺寸相关）
      for (const p of plants) p.deathCv = null
      if (!running) renderStatic()
    }

    // ---------- 指针 ----------
    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      initAudio()
      if (ac && ac.state === 'suspended') void ac.resume()
      const p = toLocal(e)
      pointer.x = p.x
      pointer.y = p.y
      pointer.inside = true
      pointer.lastX = p.x
      pointer.lastY = p.y
      pointer.lastT = e.timeStamp || performance.now()
      holding = true
      holdT0 = t
      holdMoved = 0
      downAtMs = e.timeStamp || performance.now()
      downX = p.x
      downY = p.y
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* 指针已消失时忽略 */
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!e.isPrimary) return
      const p = toLocal(e)
      const now = e.timeStamp || performance.now()
      const dtE = Math.max(1, now - pointer.lastT) / 1000
      if (pointer.inside && dtE < 0.4) {
        const vx = Math.max(-4200, Math.min(4200, (p.x - pointer.lastX) / dtE))
        windTarget = Math.max(-1.7, Math.min(1.7, vx / 1400))
        activity = Math.min(1, activity + Math.abs(vx) / 9000)
      }
      if (holding) holdMoved = Math.max(holdMoved, Math.hypot(p.x - downX, p.y - downY))
      pointer.lastX = p.x
      pointer.lastY = p.y
      pointer.lastT = now
      pointer.x = p.x
      pointer.y = p.y
      pointer.inside = true
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!e.isPrimary || !holding) return
      holding = false
      const p = toLocal(e)
      const durMs = (e.timeStamp || performance.now()) - downAtMs
      if (durMs < 350 && holdMoved < 10) {
        // 轻点：栽种
        plantAt(p.x)
      } else {
        // 腐蚀回弹：强一次性 glitch
        snapEnv = Math.min(1.25, 0.75 + durMs / 2600)
        if (durMs >= 1200) {
          fireStorm(Math.min(1.35, 1.05 + activity * 0.4))
          nextStorm = t + 3 + Math.random() * 2
          bleep(true)
        } else {
          bleep(false)
        }
      }
    }

    const onPointerCancel = () => {
      holding = false
    }

    const onPointerLeave = () => {
      pointer.inside = false
      pointer.x = -9e4
      pointer.y = -9e4
    }

    // 预植 4 株（错峰生长入场）
    const startXf = [0.16, 0.38, 0.61, 0.83]
    for (let i = 0; i < 4; i++) {
      plants.push(makePlant(startXf[i] + (Math.random() - 0.5) * 0.04, 0.35 + i * 0.3))
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerleave', onPointerLeave)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 0.45, ac.currentTime, 0.05)
    })

    const start = () => {
      if (disposed || running) return
      running = true
      last = performance.now()
      if (ac && ac.state === 'suspended') void ac.resume()
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      running = false
      holding = false
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
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      unsubMute()
      if (ac) {
        void ac.close()
        ac = null
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
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: '#060606' }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />

      {/* 扫描线 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0 1px, transparent 1px 3px)',
          opacity: 0.55,
        }}
        aria-hidden
      />
      {/* CRT 滚动亮带 */}
      <div
        className="pointer-events-none absolute inset-x-0"
        style={{
          height: '14%',
          top: '-14%',
          background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.045), transparent)',
          animation: 'glitch-garden-roll 9s linear infinite',
        }}
        aria-hidden
      />

      {/* 标本记录（左上，canvas 直写计数） */}
      <div className="pointer-events-none absolute left-[5.5%] top-[6.5%] z-10 flex flex-col" aria-hidden>
        <div
          className="font-attitude"
          style={{ fontSize: 'clamp(8px, 1.45cqw, 11px)', letterSpacing: '0.34em', color: 'rgba(55,255,139,0.72)' }}
        >
          SPECIMEN LOG
          <span className="font-cn" style={{ letterSpacing: '0.3em', marginLeft: '0.9em', color: 'rgba(55,255,139,0.5)' }}>
            标本录
          </span>
        </div>
        <div
          className="font-attitude"
          style={{
            fontSize: 'clamp(10px, 1.9cqw, 14px)',
            letterSpacing: '0.22em',
            color: 'rgba(242,242,242,0.66)',
            marginTop: '0.9cqh',
          }}
        >
          <span ref={countRef}>04</span>
          <span style={{ color: 'rgba(242,242,242,0.34)' }}> / 08</span>
        </div>
      </div>

      {/* 主标题：CSS 故障动画 */}
      <div className="pointer-events-none absolute inset-x-0 top-[38%] z-10 flex flex-col items-center">
        <div
          className="font-display glitch-garden-title"
          style={{
            fontSize: 'min(9.5cqw, 7cqh)',
            lineHeight: 1,
            letterSpacing: '0.02em',
            color: '#f2f2f2',
            whiteSpace: 'nowrap',
          }}
        >
          GLITCH GARDEN
        </div>
        <div
          className="font-cn glitch-garden-title"
          style={{
            fontSize: 'min(4.6cqw, 3.4cqh)',
            letterSpacing: '0.68em',
            color: '#f2f2f2',
            marginTop: '2.4cqh',
            paddingLeft: '0.68em',
          }}
        >
          故障花园
        </div>
      </div>

      <style>{`
        @keyframes glitch-garden-roll {
          0% { transform: translateY(0); }
          100% { transform: translateY(120cqh); }
        }
        .glitch-garden-roll { animation: glitch-garden-roll 9s linear infinite; }
        @keyframes glitch-garden-shift {
          0%, 100% { text-shadow: 3px 0 #ff2ea6, -3px 0 #37ff8b; transform: translate(0, 0) skewX(0deg); }
          12% { text-shadow: -5px 1px #ff2ea6, 5px -1px #37ff8b; }
          13% { transform: translate(2px, -1px) skewX(-5deg); }
          26% { text-shadow: 2px 2px #ff2ea6, -2px -2px #37ff8b; transform: translate(0, 0); }
          39% { text-shadow: -4px 0 #ff2ea6, 4px 0 #37ff8b; }
          40% { transform: translate(-2px, 1px) skewX(4deg); }
          54% { text-shadow: 5px -1px #ff2ea6, -5px 1px #37ff8b; transform: translate(1px, 0); }
          68% { text-shadow: 2px 0 #ff2ea6, -2px 0 #37ff8b; transform: translate(0, 0) skewX(0deg); }
          82% { text-shadow: -6px 0 #ff2ea6, 6px 0 #37ff8b; }
          83% { transform: translate(2px, 1px) skewX(-3deg); }
          84% { transform: translate(0, 0); }
        }
        .glitch-garden-title { animation: glitch-garden-shift 1.9s steps(1) infinite; }
      `}</style>

      {/* 角落署名 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[4%] z-10 flex flex-col items-center">
        <div
          className="font-attitude"
          style={{ fontSize: 'clamp(8px, 1.7cqw, 12px)', letterSpacing: '0.5em', color: 'rgba(242, 242, 242, 0.6)' }}
        >
          GLITCH GARDEN
          <span className="font-cn" style={{ letterSpacing: '0.3em', margin: '0 0 0 0.9em' }}>
            · 故障花园
          </span>
        </div>
        <div
          className="font-cn"
          style={{
            fontSize: 'clamp(7px, 1.3cqw, 10px)',
            letterSpacing: '0.42em',
            color: 'rgba(242, 242, 242, 0.34)',
            marginTop: '0.7cqh',
          }}
        >
          点击 · 栽种 — 按住 · 腐蚀
        </div>
      </div>
    </div>
  )
}
