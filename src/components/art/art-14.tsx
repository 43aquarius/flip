'use client'

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/* ═══════════════════════════════════════════════════════
   ROOM 14 · BLOOM 开花 —— 一树四季
   同一棵墨线分形树，活过一整个年轮：
     春 · 红英缀满末梢，偶有花瓣离枝飘坠；
     夏 · 绿荫渐浓，花粉浮金，风过叶浪更深；
     秋 · 叶转琥珀，阵风摇树，落叶纷纷归根成毯；
     冬 · 万叶落尽，枯枝覆霜，细雪无声覆地。
   季节是连续相位（0..4 环形，点击后 ~1.1s 交融过渡），
   一切形色按相位窗口混合——过渡期可见两季同框。
   点击翻季；指针横移为风；长按原地重植新树
   （新树在当前季节里重新生长）。
   ═══════════════════════════════════════════════════════ */

const PAPER = '#faf8f2'
const INK = '#1c1b18'
const RED_SEAL = '#c8384d'
const INK_RGB: readonly [number, number, number] = [28, 27, 24]
const INK_COOL_RGB: readonly [number, number, number] = [58, 66, 75]

/** 夏绿（两调，#3f7d3a / #5da34f）→ 秋琥珀（三调）按 tone × amb 六通道插值 */
const LEAF_GREEN: readonly (readonly [number, number, number])[] = [
  [63, 125, 58],
  [93, 163, 79],
]
const LEAF_AMBER: readonly (readonly [number, number, number])[] = [
  [217, 131, 36],
  [192, 57, 43],
  [224, 161, 63],
]

/** 各季纸面水洗色 [r,g,b,a]：春暖 / 夏绿 / 秋赭 / 冬寒 */
const WASH: readonly (readonly [number, number, number, number])[] = [
  [235, 205, 165, 0.055],
  [214, 228, 178, 0.05],
  [214, 158, 88, 0.085],
  [148, 164, 186, 0.075],
]

/** 暗角随季冷暖 */
const VIGNETTE: readonly (readonly [number, number, number, number])[] = [
  [122, 96, 60, 0.09],
  [105, 110, 66, 0.085],
  [130, 88, 46, 0.115],
  [90, 106, 138, 0.135],
]

/** 小草色：春浅绿 / 夏深绿 / 秋枯黄（冬无草） */
const GRASS: readonly (readonly [number, number, number])[] = [
  [134, 161, 92],
  [63, 125, 58],
  [168, 114, 44],
]

const SEASON_CHARS = ['春', '夏', '秋', '冬']
/** 翻季风铃音高：春 E5 · 夏 G5 · 秋 C5 · 冬 A4 */
const CHIME_FREQ = [659.25, 783.99, 523.25, 440]

interface Seg {
  parent: number
  depth: number
  ang: number
  len: number
  phase: number
  birth: number
}

interface Flower {
  seg: number
  t: number
  size: number
  color: string
  stam: boolean
  delay: number
}

/** 树叶：贴在某段末梢附近的小椭圆（夏绿荫 / 秋琥珀） */
interface TreeLeaf {
  seg: number
  t: number
  off: number
  ang: number
  size: number
  tone: number
  amb: number
  ph: number
  birth: number
}

interface TreeData {
  segs: Seg[]
  depthLists: number[][]
  flowers: Flower[]
  leaves: TreeLeaf[]
  depth: number
}

/** 粒子共池：0 花瓣 · 1 落叶 · 2 雪 · 3 花粉 */
interface Part {
  kind: 0 | 1 | 2 | 3
  x: number
  y: number
  vx: number
  vy: number
  ph: number
  rot: number
  vr: number
  size: number
  r: number
  g: number
  b: number
  sway: number
  age: number
  life: number
}

/** 落叶归根：地面积叶（上限 ~40，最老者渐隐） */
interface Litter {
  x: number
  y: number
  rot: number
  size: number
  r: number
  g: number
  b: number
  a: number
  fading: boolean
}

/** 确定性随机（mulberry32） */
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

function genTree(seed: number, h: number): TreeData {
  const rng = mulberry32(seed)
  const b = rng() < 0.62 ? 2 : 3
  const D = b === 2 ? 10 : 6
  const segs: Seg[] = []
  const flowers: Flower[] = []
  const leaves: TreeLeaf[] = []
  const pv = rng()
  let palette: string[]
  if (pv < 0.55) palette = ['#e0455a', '#c93a50']
  else if (pv < 0.85) palette = ['#e0455a', '#ef8fa4']
  else palette = ['#ef8fa4', '#f6d9d4']
  const flowerAmount = 0.55 + rng() * 0.45
  const ratio = 0.68 + rng() * 0.1
  const trunkLen = h * (0.19 + rng() * 0.035)
  const a2 = 0.34 + rng() * 0.14
  const A3 = 0.4 + rng() * 0.12

  const grow = (parent: number, depth: number, ang: number, len: number) => {
    const idx = segs.length
    segs.push({ parent, depth, ang, len, phase: rng() * 6.2832, birth: depth / (D + 3) })
    if (depth === D) {
      const n = Math.floor(0.4 + rng() * 2.4 * flowerAmount)
      for (let k = 0; k < n; k++) {
        flowers.push({
          seg: idx,
          t: 0.45 + rng() * 0.55,
          size: 1.7 + rng() * 1.6,
          color: palette[(rng() * palette.length) | 0],
          stam: rng() < 0.4,
          delay: depth / (D + 3) + 0.4 + rng() * 0.28,
        })
      }
      // 末梢叶簇 3–5 片
      const ln = 3 + Math.floor(rng() * 3)
      for (let k = 0; k < ln; k++) {
        leaves.push({
          seg: idx,
          t: 0.3 + rng() * 0.65,
          off: (rng() - 0.5) * 7,
          ang: (rng() - 0.5) * 2.5,
          size: 2.3 + rng() * 2.3,
          tone: rng() < 0.5 ? 0 : 1,
          amb: Math.floor(rng() * 3),
          ph: rng() * 6.2832,
          birth: depth / (D + 3) + 0.12 + rng() * 0.22,
        })
      }
    } else if (depth === D - 1) {
      if (rng() < 0.5 * flowerAmount) {
        flowers.push({
          seg: idx,
          t: 0.7 + rng() * 0.3,
          size: 1.5 + rng() * 1.2,
          color: palette[(rng() * palette.length) | 0],
          stam: false,
          delay: depth / (D + 3) + 0.45,
        })
      }
      if (rng() < 0.55) {
        const ln = 1 + Math.floor(rng() * 2)
        for (let k = 0; k < ln; k++) {
          leaves.push({
            seg: idx,
            t: 0.3 + rng() * 0.6,
            off: (rng() - 0.5) * 6,
            ang: (rng() - 0.5) * 2.2,
            size: 2.1 + rng() * 2.1,
            tone: rng() < 0.5 ? 0 : 1,
            amb: Math.floor(rng() * 3),
            ph: rng() * 6.2832,
            birth: depth / (D + 3) + 0.15 + rng() * 0.2,
          })
        }
      }
    }
    if (depth >= D || segs.length > 1150) return
    const kids = depth === 0 ? b : rng() < 0.94 ? b : 1
    for (let k = 0; k < kids; k++) {
      let da: number
      if (b === 2) da = k === 0 ? -a2 : a2
      else da = k === 0 ? -A3 : k === 1 ? (rng() - 0.5) * 0.14 : A3
      da += (rng() - 0.5) * 0.2
      grow(idx, depth + 1, da, len * ratio * (0.9 + rng() * 0.18))
    }
  }
  grow(-1, 0, -Math.PI / 2 + (rng() - 0.5) * 0.14, trunkLen)
  // 叶量封顶（性能护栏，确定性稀疏）
  while (leaves.length > 2400) {
    leaves.splice((rng() * leaves.length) | 0, 1)
  }
  const depthLists: number[][] = []
  for (let i = 0; i < segs.length; i++) {
    const d = segs[i].depth
    while (depthLists.length <= d) depthLists.push([])
    depthLists[d].push(i)
  }
  return { segs, depthLists, flowers, leaves, depth: D }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeOutCubic = (u: number): number => 1 - Math.pow(1 - u, 3)
const easeOutBack = (u: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2)
}
const easeInOutCubic = (u: number): number =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
const smooth01 = (u: number): number => {
  const c = clamp01(u)
  return c * c * (3 - 2 * c)
}

/** 环形相位距离（周期 4） */
const wrapDist = (a: number, b: number): number => {
  let d = a - b
  d = ((d % 4) + 4) % 4
  return d > 2 ? 4 - d : d
}
/** 季窗：|d|≤full 全量，再经 fade 平滑归零 */
const win = (d: number, full: number, fade: number): number => {
  if (d <= full) return 1
  if (d >= full + fade) return 0
  return smooth01(1 - (d - full) / fade)
}

const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='180' height='180' filter='url(#n)' opacity='0.55'/></svg>",
)}")`

interface World {
  w: number
  h: number
  dpr: number
  t: number
  progress: number
  wind: number
  windTarget: number
  gustEnv: number
  gustT: number
  gustDir: number
  gustAmp: number
  tree: TreeData
  angles: Float64Array
  xs: Float64Array
  ys: Float64Array
  xe: Float64Array
  ye: Float64Array
  gs: Float64Array
  parts: Part[]
  litter: Litter[]
  petalT: number
  leafT: number
  snowT: number
  pollenT: number
  snowCount: number
  pollenCount: number
  /** 季节相位：连续累积（春0 夏1 秋2 冬3，模 4） */
  seasonPhase: number
  seasonFrom: number
  seasonTo: number
  seasonT: number
  raf: number
  last: number
  baseX: number
  groundY: number
  trunkW: number
  tufts: { x: number; a: number; len: number; ph: number }[]
  canopy: { x0: number; x1: number; y0: number; y1: number }
  pdown: boolean
  px: number
  py: number
  downX: number
  downY: number
  downT: number
  moved: boolean
  lpFired: boolean
}

export default function Art14({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const vigRef = useRef<HTMLDivElement | null>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  const W = useRef<World>({
    w: 0, h: 0, dpr: 1, t: 0, progress: 0,
    wind: 0, windTarget: 0, gustEnv: 0, gustT: 3, gustDir: 1, gustAmp: 0,
    tree: { segs: [], depthLists: [], flowers: [], leaves: [], depth: 1 },
    angles: new Float64Array(1), xs: new Float64Array(1), ys: new Float64Array(1),
    xe: new Float64Array(1), ye: new Float64Array(1), gs: new Float64Array(1),
    parts: [], litter: [],
    petalT: 1.2, leafT: 0.5, snowT: 0, pollenT: 0, snowCount: 0, pollenCount: 0,
    seasonPhase: 0, seasonFrom: 0, seasonTo: 0, seasonT: 1,
    raf: 0, last: 0,
    baseX: 0, groundY: 0, trunkW: 6,
    tufts: [], canopy: { x0: 0, x1: 0, y0: 0, y1: 0 },
    pdown: false, px: 0, py: 0, downX: 0, downY: 0, downT: 0, moved: false, lpFired: false,
  })

  useEffect(() => {
    const w = W.current
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const off = document.createElement('canvas')
    const octx = off.getContext('2d')
    if (!octx) return
    const hasFilter = 'filter' in ctx

    const seasonEls = Array.from(root.querySelectorAll<HTMLElement>('[data-char]'))
    const dotEls = Array.from(root.querySelectorAll<HTMLElement>('[data-dot]'))
    let lastDomPh = -1
    let lastVigPh = -1
    let running = false
    let disposed = false
    let muted = useBookStore.getState().muted

    /* ---------- 音频：风铃（翻季）· 闷响（落土） ---------- */
    let ac: AudioContext | null = null
    let master: GainNode | null = null

    const initAudio = () => {
      if (ac || disposed) return
      try {
        const ctxA = new AudioContext()
        ac = ctxA
        master = ctxA.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(ctxA.destination)
        void ctxA.resume()
      } catch {
        ac = null
        master = null
      }
    }

    /** 翻季风铃：正弦主音（1.2s 缓释）+ 微弱不谐和泛音 */
    const chime = (season: number) => {
      if (!ac || !master || muted) return
      if (ac.state === 'suspended') void ac.resume()
      const n = ac.currentTime
      const f = CHIME_FREQ[season]
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = ac.createGain()
      g.gain.setValueAtTime(0.0001, n)
      g.gain.exponentialRampToValueAtTime(0.085, n + 0.025)
      g.gain.exponentialRampToValueAtTime(0.0001, n + 1.2)
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + 1.25)
      const o2 = ac.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = f * 2.756
      const g2 = ac.createGain()
      g2.gain.setValueAtTime(0.0001, n)
      g2.gain.exponentialRampToValueAtTime(0.022, n + 0.02)
      g2.gain.exponentialRampToValueAtTime(0.0001, n + 0.65)
      o2.connect(g2)
      g2.connect(master)
      o2.start(n)
      o2.stop(n + 0.7)
    }

    /** 长按落土：低频闷响 */
    const thump = () => {
      if (!ac || !master || muted) return
      const n = ac.currentTime
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(120, n)
      o.frequency.exponentialRampToValueAtTime(46, n + 0.16)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.0001, n)
      g.gain.exponentialRampToValueAtTime(0.3, n + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, n + 0.34)
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + 0.36)
    }

    /* ---------- 树姿查询 ---------- */
    const growOf = (s: Seg): number => easeOutCubic(clamp01((w.progress - s.birth) / 0.3))
    const popOf = (f: Flower): number => easeOutBack(clamp01((w.progress - f.delay) / 0.28))

    const leafPose = (L: TreeLeaf): { x: number; y: number; a: number } => {
      const i = L.seg
      const x = w.xs[i] + (w.xe[i] - w.xs[i]) * L.t
      const y = w.ys[i] + (w.ye[i] - w.ys[i]) * L.t
      const a = w.angles[i] + L.ang
      return { x: x + Math.cos(a + 1.5708) * L.off, y: y + Math.sin(a + 1.5708) * L.off, a }
    }

    /* ---------- 粒子生成 ---------- */
    const makePetal = (x: number, y: number, color: string, burst: boolean) => {
      const c = hexRgb(color)
      w.parts.push({
        kind: 0, x, y,
        vx: (Math.random() - 0.5) * (burst ? 60 : 26),
        vy: (burst ? 14 : 6) + Math.random() * 16,
        ph: Math.random() * 6.2832, rot: Math.random() * 6.2832,
        vr: (Math.random() - 0.5) * 3,
        size: 1.4 + Math.random() * 1.2,
        r: c[0], g: c[1], b: c[2],
        sway: 10 + Math.random() * 8, age: 0, life: 99,
      })
    }

    const makeLeafBit = (x: number, y: number, rot: number, mixA: number, burst: boolean) => {
      const tone = LEAF_GREEN[Math.random() < 0.5 ? 0 : 1]
      const amb = LEAF_AMBER[Math.floor(Math.random() * 3)]
      const j = (Math.random() - 0.5) * 16
      const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v + j)))
      w.parts.push({
        kind: 1, x, y,
        vx: (Math.random() - 0.5) * (burst ? 70 : 30),
        vy: (burst ? 12 : 4) + Math.random() * 10,
        ph: Math.random() * 6.2832, rot,
        vr: (Math.random() - 0.5) * 5,
        size: 2 + Math.random() * 1.7,
        r: cl(tone[0] + (amb[0] - tone[0]) * mixA),
        g: cl(tone[1] + (amb[1] - tone[1]) * mixA),
        b: cl(tone[2] + (amb[2] - tone[2]) * mixA),
        sway: 12 + Math.random() * 18, age: 0, life: 99,
      })
    }

    const makeSnow = () => {
      w.parts.push({
        kind: 2,
        x: Math.random() * (w.w + 40) - 20, y: -8,
        vx: 0, vy: 16 + Math.random() * 40,
        ph: Math.random() * 6.2832, rot: 0, vr: 0,
        size: 0.8 + Math.random() * 1.7,
        r: 252, g: 251, b: 247,
        sway: 5 + Math.random() * 14, age: 0, life: 99,
      })
    }

    const makePollen = () => {
      const c = w.canopy
      w.parts.push({
        kind: 3,
        x: c.x0 + Math.random() * Math.max(1, c.x1 - c.x0),
        y: c.y0 + Math.random() * Math.max(1, c.y1 - c.y0) * 0.85,
        vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 8,
        ph: Math.random() * 6.2832, rot: 0, vr: 0,
        size: 0.9 + Math.random() * 0.9,
        r: 240, g: 221, b: 138,
        sway: 0, age: 0, life: 8 + Math.random() * 5,
      })
    }

    const litterPush = (p: Part) => {
      w.litter.push({
        x: p.x, y: w.groundY + 2 + Math.random() * 5,
        rot: p.rot, size: p.size, r: p.r, g: p.g, b: p.b,
        a: 0.85, fading: false,
      })
      if (w.litter.length > 40) {
        const idx = w.litter.findIndex((l) => !l.fading)
        if (idx >= 0) w.litter[idx].fading = true
      }
      if (w.litter.length > 60) w.litter.splice(0, w.litter.length - 60)
    }

    /* ---------- 交互：翻季 / 重植 ---------- */
    const advanceSeason = () => {
      w.seasonFrom = w.seasonPhase
      w.seasonTo += 1
      w.seasonT = 0
      chime(((w.seasonTo % 4) + 4) % 4)
    }

    /** 长按重植：旧冠散作一阵花雨 / 叶雨，新树在当前季节重新生长 */
    const replant = (blossomA: number, leafA: number, autumnMix: number) => {
      const tree = w.tree
      for (let k = 0; k < 10; k++) {
        if (blossomA > 0.25 && tree.flowers.length > 0 && Math.random() < blossomA) {
          const f = tree.flowers[(Math.random() * tree.flowers.length) | 0]
          const i = f.seg
          if (i >= w.xs.length) continue
          makePetal(
            w.xs[i] + (w.xe[i] - w.xs[i]) * f.t,
            w.ys[i] + (w.ye[i] - w.ys[i]) * f.t,
            f.color, true,
          )
        } else if (leafA > 0.25 && tree.leaves.length > 0) {
          const L = tree.leaves[(Math.random() * tree.leaves.length) | 0]
          const pose = leafPose(L)
          makeLeafBit(pose.x, pose.y, pose.a, autumnMix, true)
        }
      }
      if (w.parts.length > 90) w.parts.splice(0, w.parts.length - 90)
      const seed = (Math.random() * 2147483647) | 0
      w.tree = genTree(seed, w.h)
      const n = w.tree.segs.length
      w.angles = new Float64Array(n)
      w.xs = new Float64Array(n)
      w.ys = new Float64Array(n)
      w.xe = new Float64Array(n)
      w.ye = new Float64Array(n)
      w.gs = new Float64Array(n)
      w.progress = 0
    }

    /* ---------- 粒子补给 / 绘制 ---------- */
    const spawnParticles = (
      dt: number, blossomA: number, leafA: number, snowA: number, pollenA: number, autumnMix: number,
    ) => {
      const tree = w.tree
      // 花瓣（春 · 疏）
      w.petalT -= dt
      if (w.petalT <= 0) {
        w.petalT = 0.75 + Math.random() * 1.6
        if (blossomA > 0.25 && w.progress > 0.9 && tree.flowers.length > 0 && w.parts.length < 160) {
          const f = tree.flowers[(Math.random() * tree.flowers.length) | 0]
          const i = f.seg
          const x = w.xs[i] + (w.xe[i] - w.xs[i]) * f.t
          const y = w.ys[i] + (w.ye[i] - w.ys[i]) * f.t
          makePetal(x, y, f.color, false)
        }
      }
      // 落叶（秋 · 密，约为春之 3–6 倍；阵风加急）
      const fallRate = leafA * autumnMix
      if (fallRate > 0.08 && w.progress > 0.85 && tree.leaves.length > 0 && w.parts.length < 160) {
        w.leafT -= dt * (1 + 1.8 * fallRate + (w.gustEnv > 0.35 ? 1.4 : 0))
        if (w.leafT <= 0) {
          w.leafT = 0.95 + Math.random() * 0.45
          const cnt = 1 + (Math.random() < 0.5 ? 1 : 0)
          for (let k = 0; k < cnt; k++) {
            const L = tree.leaves[(Math.random() * tree.leaves.length) | 0]
            const pose = leafPose(L)
            makeLeafBit(pose.x, pose.y, pose.a, autumnMix, false)
          }
        }
      }
      // 雪（冬 · 维持 30–45 片）
      const wantSnow = Math.round(40 * snowA)
      if (w.snowCount < wantSnow && w.parts.length < 220) {
        w.snowT -= dt
        if (w.snowT <= 0) {
          w.snowT = 0.05
          makeSnow()
        }
      }
      // 花粉（夏 · 4–7 粒浮金）
      const wantPollen = Math.round(6.5 * pollenA)
      if (w.pollenCount < wantPollen && w.parts.length < 220) {
        w.pollenT -= dt
        if (w.pollenT <= 0) {
          w.pollenT = 0.25
          makePollen()
        }
      }
    }

    const drawPart = (p: Part, snowA: number, pollenA: number) => {
      if (p.kind === 2) {
        ctx.globalAlpha = 0.9 * snowA
        ctx.fillStyle = 'rgb(252,251,247)'
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, 6.2832)
        ctx.fill()
      } else if (p.kind === 3) {
        const pulse = 0.45 + 0.45 * Math.sin(p.age * 2.4 + p.ph)
        ctx.globalAlpha = pollenA * pulse
        ctx.fillStyle = 'rgb(240,221,138)'
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, 6.2832)
        ctx.fill()
      } else {
        ctx.globalAlpha = p.kind === 1 ? 0.92 : 0.85
        ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`
        ctx.beginPath()
        ctx.ellipse(p.x, p.y, p.size * 1.5, p.size * (p.kind === 1 ? 0.78 : 1), p.rot, 0, 6.2832)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    /* ---------- 主渲染 ---------- */
    const render = (dt: number) => {
      const tree = w.tree
      const n = tree.segs.length
      if (n === 0) return
      w.t += dt
      w.progress = Math.min(1, w.progress + dt / 2.5)

      // —— 季节相位补间（~1.1s 交融） ——
      if (w.seasonT < 1) {
        w.seasonT = Math.min(1, w.seasonT + dt / 1.1)
        w.seasonPhase = w.seasonFrom + (w.seasonTo - w.seasonFrom) * easeInOutCubic(w.seasonT)
      }
      const phm = ((w.seasonPhase % 4) + 4) % 4
      const blossomA = win(wrapDist(phm, 0), 0.32, 0.5)
      const leafA = win(wrapDist(phm, 1.5), 0.5, 0.95)
      const snowA = win(wrapDist(phm, 3), 0.25, 0.5)
      const pollenA = win(wrapDist(phm, 1.15), 0.35, 0.45)
      const autumnMix = smooth01((phm - 1.35) / 0.55)
      const coldMix = win(wrapDist(phm, 3), 0.55, 0.45)

      // 四季归一权重（水洗 / 暗角 / 小草 / 指示字共用）
      const mix = [0, 0, 0, 0]
      let msum = 0
      for (let s = 0; s < 4; s++) {
        const v = win(wrapDist(phm, s), 0.5, 0.5)
        mix[s] = v
        msum += v
      }
      if (msum > 0) for (let s = 0; s < 4; s++) mix[s] /= msum

      // —— 风（指针 + 秋季阵风） ——
      w.wind += (w.windTarget - w.wind) * Math.min(1, dt * 2.5)
      w.gustT -= dt
      if (w.gustT <= 0) {
        if (leafA > 0.25 && autumnMix > 0.25) {
          w.gustEnv = 1
          w.gustDir = Math.random() < 0.5 ? -1 : 1
          w.gustAmp = 0.55 + Math.random() * 0.45
        }
        w.gustT = 2.6 + Math.random() * 3.4
      }
      if (w.gustEnv > 0.003) w.gustEnv *= Math.exp(-dt * 1.5)
      else w.gustEnv = 0
      const windEff = w.wind + w.gustEnv * w.gustAmp * w.gustDir * 0.9

      // —— 全树姿态（微风 + 张角 + 生长，夏荫摆幅 ×1.3） ——
      const segs = tree.segs
      const spreadScale = Math.max(0.45, Math.min(1.6, 1 + windEff * 0.5))
      const lean = windEff * 0.15
      const ampMul = 1 + 0.3 * leafA
      const g0 = growOf(segs[0])
      w.gs[0] = g0
      w.angles[0] = segs[0].ang + lean
      w.xs[0] = w.baseX
      w.ys[0] = w.groundY
      w.xe[0] = w.baseX + Math.cos(w.angles[0]) * segs[0].len * g0
      w.ye[0] = w.groundY + Math.sin(w.angles[0]) * segs[0].len * g0
      let cx0 = w.baseX, cx1 = w.baseX, cy0 = w.groundY, cy1 = w.groundY
      const tipDepth = Math.max(0, tree.depth - 2)
      for (let i = 1; i < n; i++) {
        const s = segs[i]
        const p = s.parent
        const g = growOf(s)
        w.gs[i] = g
        const sway = Math.sin(w.t * 1.15 + s.phase + s.depth * 0.55) * (0.01 + s.depth * 0.011) * ampMul
        w.angles[i] = w.angles[p] + s.ang * spreadScale + sway
        w.xs[i] = w.xe[p]
        w.ys[i] = w.ye[p]
        w.xe[i] = w.xs[i] + Math.cos(w.angles[i]) * s.len * g
        w.ye[i] = w.ys[i] + Math.sin(w.angles[i]) * s.len * g
        if (s.depth >= tipDepth && g > 0.5) {
          if (w.xe[i] < cx0) cx0 = w.xe[i]
          if (w.xe[i] > cx1) cx1 = w.xe[i]
          if (w.ye[i] < cy0) cy0 = w.ye[i]
          if (w.ye[i] > cy1) cy1 = w.ye[i]
        }
      }
      w.canopy = { x0: cx0, x1: cx1, y0: cy0, y1: cy1 }

      // —— 墨色（冬 · 枝上寒霜灰蓝，极轻） ——
      const inkR = Math.round(INK_RGB[0] + (INK_COOL_RGB[0] - INK_RGB[0]) * coldMix)
      const inkG = Math.round(INK_RGB[1] + (INK_COOL_RGB[1] - INK_RGB[1]) * coldMix)
      const inkB = Math.round(INK_RGB[2] + (INK_COOL_RGB[2] - INK_RGB[2]) * coldMix)
      const inkCol = `rgb(${inkR},${inkG},${inkB})`

      // —— 树画进离屏（墨枝 + 绿/琥叶 + 红英） ——
      octx.setTransform(w.dpr, 0, 0, w.dpr, 0, 0)
      octx.clearRect(0, 0, w.w, w.h)
      octx.lineCap = 'round'
      octx.strokeStyle = inkCol
      for (let d = 0; d < tree.depthLists.length; d++) {
        const list = tree.depthLists[d]
        octx.lineWidth = Math.max(0.55, w.trunkW * Math.pow(0.78, d))
        octx.beginPath()
        for (const i of list) {
          if (w.gs[i] <= 0.01) continue
          octx.moveTo(w.xs[i], w.ys[i])
          octx.lineTo(w.xe[i], w.ye[i])
        }
        octx.stroke()
      }
      // 叶（tone×amb 六通道，夏绿→秋琥按相位插值；Path2D 批量）
      if (leafA > 0.01 && tree.leaves.length > 0) {
        const paths: Path2D[] = []
        for (let k = 0; k < 6; k++) paths.push(new Path2D())
        for (const L of tree.leaves) {
          const u = clamp01((w.progress - L.birth) / 0.35)
          if (u <= 0.02) continue
          const pop = easeOutBack(u)
          const i = L.seg
          const x = w.xs[i] + (w.xe[i] - w.xs[i]) * L.t
          const y = w.ys[i] + (w.ye[i] - w.ys[i]) * L.t
          const a = w.angles[i] + L.ang + Math.sin(w.t * 1.8 + L.ph) * (0.05 + Math.abs(windEff) * 0.2)
          const px = x + Math.cos(a + 1.5708) * L.off
          const py = y + Math.sin(a + 1.5708) * L.off
          const sz = L.size * Math.max(0.05, pop)
          const pth = paths[L.tone * 3 + L.amb]
          pth.moveTo(px + sz * 1.5 * Math.cos(a), py + sz * 1.5 * Math.sin(a))
          pth.ellipse(px, py, sz * 1.5, sz * 0.72, a, 0, 6.2832)
        }
        octx.globalAlpha = leafA
        for (let tg = 0; tg < 2; tg++) {
          for (let am = 0; am < 3; am++) {
            const gg = LEAF_GREEN[tg]
            const aa = LEAF_AMBER[am]
            octx.fillStyle =
              `rgb(${Math.round(gg[0] + (aa[0] - gg[0]) * autumnMix)},` +
              `${Math.round(gg[1] + (aa[1] - gg[1]) * autumnMix)},` +
              `${Math.round(gg[2] + (aa[2] - gg[2]) * autumnMix)})`
            octx.fill(paths[tg * 3 + am])
          }
        }
        octx.globalAlpha = 1
      }
      // 花（红英 · 春窗，按色分批）
      if (blossomA > 0.01 && tree.flowers.length > 0) {
        octx.globalAlpha = blossomA
        const palette = Array.from(new Set(tree.flowers.map((f) => f.color)))
        for (const color of palette) {
          octx.fillStyle = color
          octx.beginPath()
          for (const f of tree.flowers) {
            if (f.color !== color) continue
            const pop = popOf(f)
            if (pop <= 0.03) continue
            const i = f.seg
            const x = w.xs[i] + (w.xe[i] - w.xs[i]) * f.t
            const y = w.ys[i] + (w.ye[i] - w.ys[i]) * f.t
            const r = f.size * Math.max(0, pop)
            octx.moveTo(x + r, y)
            octx.arc(x, y, r, 0, 6.2832)
          }
          octx.fill()
        }
        // 花丝
        octx.strokeStyle = 'rgba(143,29,49,0.8)'
        octx.lineWidth = 0.6
        octx.beginPath()
        for (const f of tree.flowers) {
          if (!f.stam) continue
          const pop = popOf(f)
          if (pop < 0.6) continue
          const i = f.seg
          const x = w.xs[i] + (w.xe[i] - w.xs[i]) * f.t
          const y = w.ys[i] + (w.ye[i] - w.ys[i]) * f.t
          const l = f.size * 1.7
          for (let k = 0; k < 3; k++) {
            const aa = -Math.PI / 2 + (k - 1) * 0.7
            octx.moveTo(x, y)
            octx.lineTo(x + Math.cos(aa) * l, y + Math.sin(aa) * l)
          }
        }
        octx.stroke()
        octx.globalAlpha = 1
      }

      // —— 主画布：水洗 / 地面 / 草 / 积叶 / 雪线 / 倒影 / 树 ——
      ctx.setTransform(w.dpr, 0, 0, w.dpr, 0, 0)
      ctx.clearRect(0, 0, w.w, w.h)
      // 季节水洗
      let wr = 0, wg = 0, wb = 0, wa = 0
      for (let s = 0; s < 4; s++) {
        wr += WASH[s][0] * mix[s]
        wg += WASH[s][1] * mix[s]
        wb += WASH[s][2] * mix[s]
        wa += WASH[s][3] * mix[s]
      }
      if (wa > 0.003) {
        ctx.fillStyle = `rgba(${Math.round(wr)},${Math.round(wg)},${Math.round(wb)},${wa.toFixed(3)})`
        ctx.fillRect(0, 0, w.w, w.h)
      }
      // 地面墨线（轻微手绘波动）
      ctx.strokeStyle = 'rgba(28,27,24,0.5)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      const gx0 = w.w * 0.14
      const gx1 = w.w * 0.86
      ctx.moveTo(gx0, w.groundY + Math.sin(gx0 * 0.02) * 1.4)
      for (let x = gx0 + 14; x <= gx1; x += 14) {
        ctx.lineTo(x, w.groundY + Math.sin(x * 0.021) * 1.5)
      }
      ctx.stroke()
      // 小草（春浅绿 / 夏深 / 秋枯黄 / 冬无）
      const grassW = mix[0] + mix[1] + mix[2]
      if (grassW > 0.02 && w.tufts.length > 0) {
        let gr = 0, gg2 = 0, gb = 0
        for (let s = 0; s < 3; s++) {
          const wt = mix[s] / grassW
          gr += GRASS[s][0] * wt
          gg2 += GRASS[s][1] * wt
          gb += GRASS[s][2] * wt
        }
        ctx.strokeStyle = `rgba(${Math.round(gr)},${Math.round(gg2)},${Math.round(gb)},${(0.6 * Math.min(1, grassW * 1.2)).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        for (const tf of w.tufts) {
          const bend = Math.sin(w.t * 1.3 + tf.ph) * (1.5 + Math.abs(windEff) * 5)
          ctx.moveTo(tf.x, w.groundY)
          ctx.lineTo(tf.x + tf.a * tf.len + bend, w.groundY - tf.len)
          ctx.moveTo(tf.x, w.groundY)
          ctx.lineTo(tf.x - tf.a * tf.len * 0.6 + bend * 0.7, w.groundY - tf.len * 0.72)
        }
        ctx.stroke()
      }
      // 落叶归根 · 地面残叶（冬被雪掩）
      if (w.litter.length > 0) {
        const litterFade = 1 - 0.85 * snowA
        for (const l of w.litter) {
          ctx.fillStyle = `rgba(${l.r},${l.g},${l.b},${(l.a * litterFade).toFixed(3)})`
          ctx.beginPath()
          ctx.ellipse(l.x, l.y, l.size * 1.5, l.size * 0.62, l.rot, 0, 6.2832)
          ctx.fill()
        }
      }
      // 冬 · 雪覆地线
      if (snowA > 0.01) {
        ctx.strokeStyle = `rgba(252,251,247,${(0.92 * snowA).toFixed(3)})`
        ctx.lineWidth = 2 + 3.5 * snowA
        ctx.beginPath()
        const sx0 = w.w * 0.12
        const sx1 = w.w * 0.88
        ctx.moveTo(sx0, w.groundY - 1.5 + Math.sin(sx0 * 0.03) * 1.2)
        for (let x = sx0 + 12; x <= sx1; x += 12) {
          ctx.lineTo(x, w.groundY - 1.5 + Math.sin(x * 0.031) * 1.3)
        }
        ctx.stroke()
      }
      // 倒影（翻转 + 模糊 + 浅灰）
      ctx.save()
      ctx.translate(0, w.groundY)
      ctx.scale(1, -0.42)
      ctx.translate(0, -w.groundY)
      if (hasFilter) ctx.filter = 'blur(5px)'
      ctx.globalAlpha = 0.13
      ctx.drawImage(off, 0, 0)
      ctx.restore()
      if (hasFilter) ctx.filter = 'none'
      ctx.globalAlpha = 1
      // 正树
      ctx.drawImage(off, 0, 0)

      // —— 粒子共池（花瓣 / 落叶 / 雪 / 花粉） ——
      w.snowCount = 0
      w.pollenCount = 0
      const canopy = w.canopy
      for (let i = w.parts.length - 1; i >= 0; i--) {
        const p = w.parts[i]
        p.age += dt
        let dead = false
        if (p.kind === 2) {
          w.snowCount++
          p.x += (p.vx + Math.sin(w.t * 0.9 + p.ph) * p.sway + windEff * 16) * dt
          p.y += p.vy * dt
          if (p.x < -14) p.x += w.w + 28
          else if (p.x > w.w + 14) p.x -= w.w + 28
          if (p.y > w.groundY + 6 || p.y > w.h + 10) dead = true
        } else if (p.kind === 3) {
          w.pollenCount++
          p.vx += Math.sin(w.t * 0.6 + p.ph) * 16 * dt
          p.vy += Math.cos(w.t * 0.5 + p.ph * 1.7) * 14 * dt
          p.vx *= Math.exp(-dt * 0.7)
          p.vy *= Math.exp(-dt * 0.7)
          p.x += (p.vx + windEff * 12) * dt
          p.y += p.vy * dt
          if (p.age > p.life || pollenA < 0.04 || p.y > w.groundY - 4) dead = true
          if (p.x < canopy.x0 - 50 || p.x > canopy.x1 + 50 || p.y < canopy.y0 - 50) dead = true
        } else {
          p.vy = Math.min(p.vy + (p.kind === 1 ? 9 : 7) * dt, p.kind === 1 ? 27 : 34)
          p.x += (p.vx + Math.sin(w.t * (p.kind === 1 ? 1.7 : 2.2) + p.ph) * p.sway + windEff * (p.kind === 1 ? 34 : 22)) * dt
          p.y += p.vy * dt
          p.rot += p.vr * dt + Math.sin(w.t * 3 + p.ph) * dt * (p.kind === 1 ? 1.1 : 0.5)
          if (p.y >= w.groundY - 1) {
            if (p.kind === 1) litterPush(p)
            dead = true
          } else if (p.x < -30 || p.x > w.w + 30) {
            dead = true
          }
        }
        if (!dead) drawPart(p, snowA, pollenA)
        if (dead) {
          w.parts[i] = w.parts[w.parts.length - 1]
          w.parts.pop()
        }
      }
      spawnParticles(dt, blossomA, leafA, snowA, pollenA, autumnMix)

      // —— 长按手势（原地重植 · 圆弧进度） ——
      if (w.pdown && !w.moved && !w.lpFired) {
        const hold = w.t - w.downT
        const frac = Math.min(1, hold / 0.6)
        if (frac > 0.02) {
          ctx.strokeStyle = 'rgba(28,27,24,0.13)'
          ctx.lineWidth = 1.3
          ctx.beginPath()
          ctx.arc(w.px, w.py, 23, 0, 6.2832)
          ctx.stroke()
          ctx.strokeStyle = 'rgba(28,27,24,0.5)'
          ctx.beginPath()
          ctx.arc(w.px, w.py, 23, -1.5708, -1.5708 + frac * 6.2832)
          ctx.stroke()
        }
        if (hold >= 0.6) {
          w.lpFired = true
          replant(blossomA, leafA, autumnMix)
          thump()
        }
      }

      // —— 积叶老化 ——
      for (let i = w.litter.length - 1; i >= 0; i--) {
        const l = w.litter[i]
        if (l.fading) {
          l.a -= dt * 0.55
          if (l.a <= 0) w.litter.splice(i, 1)
        }
      }

      // —— DOM 同步：四季字 / 圆点 / 暗角冷暖 ——
      if (Math.abs(phm - lastDomPh) > 0.004) {
        lastDomPh = phm
        for (let s = 0; s < 4; s++) {
          const v = mix[s]
          const el = seasonEls[s]
          if (el) {
            el.style.opacity = (0.16 + 0.84 * v).toFixed(3)
            el.style.transform = `scale(${(0.88 + 0.14 * v).toFixed(3)})`
          }
          const dot = dotEls[s]
          if (dot) dot.style.opacity = (0.18 + 0.82 * v).toFixed(3)
        }
      }
      if (Math.abs(phm - lastVigPh) > 0.02) {
        lastVigPh = phm
        let vr2 = 0, vg = 0, vb = 0, va = 0
        for (let s = 0; s < 4; s++) {
          vr2 += VIGNETTE[s][0] * mix[s]
          vg += VIGNETTE[s][1] * mix[s]
          vb += VIGNETTE[s][2] * mix[s]
          va += VIGNETTE[s][3] * mix[s]
        }
        const vig = vigRef.current
        if (vig) {
          vig.style.background =
            `radial-gradient(ellipse at 50% 42%, transparent 58%, rgba(${Math.round(vr2)},${Math.round(vg)},${Math.round(vb)},${va.toFixed(3)}) 100%)`
        }
      }
    }

    /* ---------- 尺寸自适应 ---------- */
    const resize = () => {
      const cw = root.clientWidth
      const chh = root.clientHeight
      if (cw < 40 || chh < 40) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(cw * dpr)
      canvas.height = Math.round(chh * dpr)
      off.width = canvas.width
      off.height = canvas.height
      const first = w.tree.segs.length === 0
      w.w = cw
      w.h = chh
      w.dpr = dpr
      w.baseX = cw * 0.5
      w.groundY = chh * 0.78
      w.trunkW = Math.min(cw, chh) * 0.016
      // 小草笔触（确定性散布）
      w.tufts = []
      const tg = mulberry32(1401)
      const tn = Math.max(6, Math.min(16, Math.round(cw / 64)))
      for (let k = 0; k < tn; k++) {
        const side = tg() < 0.5 ? -1 : 1
        const dist = 24 + tg() * cw * 0.3
        w.tufts.push({
          x: w.baseX + side * dist,
          a: (tg() - 0.5) * 0.7,
          len: 5 + tg() * 8,
          ph: tg() * 6.2832,
        })
      }
      if (first) plantFirst()
      render(0)
    }

    const plantFirst = () => {
      const seed = 20250514
      w.tree = genTree(seed, w.h)
      const n = w.tree.segs.length
      w.angles = new Float64Array(n)
      w.xs = new Float64Array(n)
      w.ys = new Float64Array(n)
      w.xe = new Float64Array(n)
      w.ye = new Float64Array(n)
      w.gs = new Float64Array(n)
      w.progress = 0
    }

    /* ---------- 指针：横移为风 · 轻点翻季 · 长按重植 ---------- */
    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return
      initAudio()
      const rect = root.getBoundingClientRect()
      w.px = e.clientX - rect.left
      w.py = e.clientY - rect.top
      w.pdown = true
      w.downX = w.px
      w.downY = w.py
      w.downT = w.t
      w.moved = false
      w.lpFired = false
      w.windTarget = Math.max(-1, Math.min(1, (w.px / Math.max(1, root.clientWidth)) * 2 - 1))
      try {
        root.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!e.isPrimary) return
      const rect = root.getBoundingClientRect()
      w.px = e.clientX - rect.left
      w.py = e.clientY - rect.top
      w.windTarget = Math.max(-1, Math.min(1, (w.px / Math.max(1, root.clientWidth)) * 2 - 1))
      if (w.pdown && Math.hypot(w.px - w.downX, w.py - w.downY) > 10) w.moved = true
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!e.isPrimary) return
      if (w.pdown && running && !w.lpFired && !w.moved && w.t - w.downT < 0.3) advanceSeason()
      w.pdown = false
      try {
        root.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    const onPointerCancel = () => {
      w.pdown = false
    }
    const onContextMenu = (e: Event) => e.preventDefault()

    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('pointermove', onPointerMove)
    root.addEventListener('pointerup', onPointerUp)
    root.addEventListener('pointercancel', onPointerCancel)
    root.addEventListener('contextmenu', onContextMenu)

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05)
    })

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - w.last) / 1000))
      w.last = now
      render(dt)
      w.raf = requestAnimationFrame(step)
    }
    const start = () => {
      if (disposed || running) return
      running = true
      w.last = performance.now()
      if (ac && ac.state === 'suspended') void ac.resume()
      w.raf = requestAnimationFrame(step)
    }
    const stop = () => {
      running = false
      w.pdown = false
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
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerup', onPointerUp)
      root.removeEventListener('pointercancel', onPointerCancel)
      root.removeEventListener('contextmenu', onContextMenu)
      unsubMute()
      if (ac) {
        void ac.close()
        ac = null
        master = null
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
      style={{
        background: PAPER,
        touchAction: 'none',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ display: 'block' }} />
      {/* 纸张颗粒 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: GRAIN,
          opacity: 0.05,
          mixBlendMode: 'multiply',
        }}
      />
      {/* 季节暗角（随四季冷暖，引擎直写） */}
      <div
        ref={vigRef}
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 42%, transparent 58%, rgba(122,96,60,0.09) 100%)',
        }}
      />
      {/* 四季指示 · 右缘竖排（当前季淡入淡出） */}
      <div
        className="pointer-events-none absolute flex flex-col items-center"
        style={{ right: '3.2%', top: '50%', transform: 'translateY(-50%)', gap: '1.1cqh' }}
        aria-hidden
      >
        {SEASON_CHARS.map((c, s) => (
          <div key={c} className="flex items-center" style={{ gap: '0.8cqw' }}>
            <span
              data-dot
              style={{
                width: 'clamp(4px, 0.55cqw, 7px)',
                height: 'clamp(4px, 0.55cqw, 7px)',
                borderRadius: '50%',
                background: RED_SEAL,
                display: 'inline-block',
                opacity: s === 0 ? 1 : 0.18,
              }}
            />
            <span
              data-char
              className="font-cn"
              style={{
                fontSize: 'clamp(13px, 2.25cqw, 30px)',
                lineHeight: 1,
                color: INK,
                opacity: s === 0 ? 1 : 0.16,
                transform: s === 0 ? 'scale(1)' : 'scale(0.88)',
              }}
            >
              {c}
            </span>
          </div>
        ))}
      </div>
      {/* 署名（右上竖排 + 朱印） */}
      <div
        className="pointer-events-none absolute flex flex-col items-center"
        style={{ right: '11.5%', top: '5.5%', gap: '1.6cqh' }}
      >
        <div
          className="font-attitude"
          style={{ fontSize: '1.25cqw', letterSpacing: '0.34em', color: 'rgba(28,27,24,0.55)' }}
        >
          BLOOM
        </div>
        <div
          className="font-cn"
          style={{
            writingMode: 'vertical-rl',
            fontSize: '1.9cqw',
            letterSpacing: '0.42em',
            color: INK,
          }}
        >
          开花　一树四季
        </div>
        <div
          style={{
            width: '2.7cqw',
            height: '2.7cqw',
            background: RED_SEAL,
            borderRadius: 2,
            transform: 'rotate(2.5deg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 0 rgba(28,27,24,0.22)',
          }}
        >
          <span
            className="font-cn"
            style={{ color: PAPER, fontSize: '1.55cqw', lineHeight: 1 }}
          >
            翻
          </span>
        </div>
      </div>
      {/* 操作提示 */}
      <div
        className="font-cn pointer-events-none absolute inset-x-0"
        style={{
          bottom: '4.5%',
          textAlign: 'center',
          fontSize: 'clamp(8px, 1.35cqw, 12px)',
          letterSpacing: '0.5em',
          color: 'rgba(28,27,24,0.34)',
          whiteSpace: 'nowrap',
        }}
        aria-hidden
      >
        横移 · 风 — 点击 · 四季 — 长按 · 重植
      </div>
    </div>
  )
}
