'use client'

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/* ═══════════════════════════════════════════════════════
   ROOM 12 · FERROFLUID 磁流 — 铁磁流体标本装置
   美术馆标本皿里的一滩黑色铁磁流体。指针是一块磁铁：
   靠近即尖峰林立。全部 canvas 2D 手绘（无 goo/blur 滤镜链）。

   · 场景：奶油纸底 #efeae0（预渲染细噪点颗粒）+ 中央偏下
     大圆标本皿（深灰双圈 + 柔和径向投影 + 内壁高光弧）
   · 流体：一维弹簧表面高度场（140 节点，弹簧回复 + 2 次
     邻居松弛传播），路径 = 皿左内壁 → 波浪顶面 → 右内壁 →
     皿底闭合；近黑垂直渐变（#26242e → #08080c）+ 坡度驱动
     的 1.5px 镜面高光线 + 液面下尖峰倒影（alpha 0.13）
   · 尖峰（灵魂）：指针近 → 5-11 根内凹贝塞尔细长刺 + 邻近
     节点次级小峰；高度 ∝ 接近距离^2.2 × 磁场强度，尖端被
     吸向指针；左缘高光 + 右缘暗线 + 尖端镜面闪点
   · 磁场：默认 1.0，按住 1.2s ramp → 2.6（峰更多更尖 +
     ±2px 高频颤抖 + 青柠磁感线），松手粘弹性回落（过冲）
   · 交互：靠近拖曳质量（主鼓包+次级峰）；快移撕下液滴卫
     星球；快点（<300ms & <10px）从液面甩出 3-6 颗抛物线
     液滴（落回 → 涟漪环 + 溅粒）；点在液面上 → 该处短促
     尖峰爆发；空闲 >2s 环境涟漪 + 每 4-7s 一次「呼吸」圆丘
   · 液滴：径向渐变小球（左上白高光 + 近黑主体 + 右下暗），
     上限 24，表面张力回吸并合 + blip
   · 音频：42Hz 次声嗡鸣（增益∝接近度×强度）/ 峰生长咆哮
     （低通锯齿 90-140Hz，pitch∝强度，生长速度门控）/
     液滴 blip（sine 500→140Hz）/ 溅落低通噪声短爆
   调色板：液近黑 #0d0c10 / 纸奶油 #efeae0 / 酸青柠 #c8ff3d
   ═══════════════════════════════════════════════════════ */

const TAU = Math.PI * 2
const PAPER_BG = '#efeae0'
const LIME = '#c8ff3d'
const INK_TOP = '#26242e'
const INK_MID = '#131118'
const INK_BOT = '#08080c'

/** 高度场节点数 */
const N = 140
const MAX_SPIKES = 22
/** 磁铁尖峰簇最大根数（槽 0..MAG_SLOTS-1 排布中央高两侧低） */
const MAG_SLOTS = 11
const MAX_DROPS = 24
const MAX_GRAINS = 48
const MAX_RIPPLES = 12

const K_SPRING = 34
const D_SPRING = 2.15
const SMOOTH = 0.16
/** 尖峰生长弹簧（欠阻尼 → 松手过冲抖动两次再稳） */
const GK = 64
const GD = 5.2
/** 磁场影响半径 = Rin × REACH_F */
const REACH_F = 1.5
const GRAVITY = 1150

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/* ── 磁铁尖峰簇静态排布：槽 0 居中最高，向两侧渐矮（burst 槽 11+ 不用 LAT） ── */
const LAT = new Float32Array(MAX_SPIKES)
const LENS = new Float32Array(MAX_SPIKES)
{
  const pat = [0, 0.22, -0.24, 0.48, -0.5, 0.74, -0.75, 0.98, -1, 1.25, -1.3]
  for (let i = 0; i < MAX_SPIKES; i++) {
    const l = i < MAG_SLOTS ? pat[i] : 0
    LAT[i] = l
    LENS[i] = 1 - 0.34 * Math.abs(l)
  }
}

/* ── 帧循环零分配：模块级暂存 ── */
const YS = new Float32Array(N)
const HTMP = new Float32Array(N)
const SG = new Float32Array(MAX_SPIKES)
const SBX = new Float32Array(MAX_SPIKES)
const SBY = new Float32Array(MAX_SPIKES)
const STX = new Float32Array(MAX_SPIKES)
const STY = new Float32Array(MAX_SPIKES)
const SLN = new Float32Array(MAX_SPIKES)
const SBW = new Float32Array(MAX_SPIKES)
const HL_A: string[] = []
for (let j = 1; j <= 10; j++) HL_A.push(`rgba(255,255,255,${(j / 10).toFixed(1)})`)
const DASH_FS = [2, 5]
const DASH_OFF: number[] = []
const SGEO = {
  lx: 0, ly: 0, rx: 0, ry: 0, clx: 0, cly: 0, crx: 0, cry: 0, tx: 0, ty: 0,
}

interface SpikeSlot {
  /** 0 = 磁铁簇（锚点随指针） 1 = 爆发（锚点固定） */
  kind: number
  /** 爆发锚 x（kind=1）/ 无用（kind=0） */
  ax: number
  /** kind=1 倾角（rad）；kind=0 无用 */
  lat: number
  lenS: number
  /** 生长量（弹簧，可 >1 过冲） */
  g: number
  gv: number
  ph: number
}

interface Drop {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  ph: number
}

interface Grain {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  /** 0 = 近黑溅粒 1 = 青柠闪点 */
  lime: number
}

interface Ripple {
  x: number
  y: number
  r: number
  v: number
  a: number
}

interface PtrState {
  x: number
  y: number
  vx: number
  vy: number
  has: boolean
  down: boolean
  downT: number
  downX: number
  downY: number
  moved: number
  lastMove: number
  lastShed: number
  lastET: number
}

interface AudioState {
  ac: AudioContext | null
  master: GainNode | null
  humGate: GainNode | null
  roarGain: GainNode | null
  roarOsc: OscillatorNode | null
  noise: AudioBuffer | null
  muted: boolean
  humEma: number
  roarEma: number
  roarFreqEma: number
  lastBlip: number
  lastPlip: number
}

interface World {
  w: number
  h: number
  t: number
  /** 皿几何 */
  cx: number
  cy: number
  R: number
  Rin: number
  yL: number
  rSurf: number
  rWall: number
  spanL: number
  spanR: number
  dxs: number
  angR: number
  hF: Float32Array
  hvF: Float32Array
  spikes: SpikeSlot[]
  drops: Drop[]
  dropN: number
  dropVictim: number
  grains: Grain[]
  grainN: number
  ripples: Ripple[]
  rippleN: number
  breath: { on: boolean; x: number; t0: number; dur: number; amp: number }
  nextBreath: number
  intro: number
  ptr: PtrState
  /** 指针的磁铁替身（平滑滞后） */
  mag: { x: number; y: number; a: number }
  strength: number
  sv: number
  /** 接近距离（原始）与平滑值 */
  p: number
  ps: number
  anchorX: number
  magCount: number
  act: number
  paper: HTMLCanvasElement | null
  dropSprite: HTMLCanvasElement | null
  grad: CanvasGradient | null
  audio: AudioState
  disposed: boolean
}

function makeWorld(): World {
  const spikes: SpikeSlot[] = []
  for (let i = 0; i < MAX_SPIKES; i++) {
    spikes.push({ kind: 0, ax: 0, lat: 0, lenS: 1, g: 0, gv: 0, ph: i * 1.7 })
  }
  const drops: Drop[] = []
  for (let i = 0; i < MAX_DROPS; i++) {
    drops.push({ x: 0, y: 0, vx: 0, vy: 0, r: 3, ph: i * 0.9 })
  }
  const grains: Grain[] = []
  for (let i = 0; i < MAX_GRAINS; i++) grains.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, lime: 0 })
  const ripples: Ripple[] = []
  for (let i = 0; i < MAX_RIPPLES; i++) ripples.push({ x: 0, y: 0, r: 0, v: 0, a: 0 })
  return {
    w: 0,
    h: 0,
    t: 0,
    cx: 0,
    cy: 0,
    R: 0,
    Rin: 0,
    yL: 0,
    rSurf: 0,
    rWall: 0,
    spanL: 0,
    spanR: 0,
    dxs: 1,
    angR: 0,
    hF: new Float32Array(N),
    hvF: new Float32Array(N),
    spikes,
    drops,
    dropN: 0,
    dropVictim: 0,
    grains,
    grainN: 0,
    ripples,
    rippleN: 0,
    breath: { on: false, x: 0, t0: 0, dur: 2.6, amp: 10 },
    nextBreath: 1.8,
    intro: 0,
    ptr: { x: 0, y: 0, vx: 0, vy: 0, has: false, down: false, downT: 0, downX: 0, downY: 0, moved: 0, lastMove: -10, lastShed: -10, lastET: 0 },
    mag: { x: 0, y: 0, a: 0 },
    strength: 1,
    sv: 0,
    p: 0,
    ps: 0,
    anchorX: 0,
    magCount: 0,
    act: 0,
    paper: null,
    dropSprite: null,
    grad: null,
    audio: { ac: null, master: null, humGate: null, roarGain: null, roarOsc: null, noise: null, muted: false, humEma: 0, roarEma: 0, roarFreqEma: 95, lastBlip: -1, lastPlip: -1 },
    disposed: false,
  }
}

/* ─────────────────── 高度场采样与注入 ─────────────────── */

function hAt(w: World, x: number): number {
  const u = clamp((x - w.spanL) / w.dxs, 0, N - 1)
  const i = Math.floor(u)
  if (i >= N - 1) return w.hF[N - 1]
  const f = u - i
  return w.hF[i] + (w.hF[i + 1] - w.hF[i]) * f
}

/** 高斯速度注入（弹簧拖曳：表面被吸向 amp） */
function gaussForce(w: World, cx0: number, sig: number, amp: number, blend: number): void {
  const inv = 1 / (sig * sig)
  const lo = Math.max(1, Math.floor((cx0 - sig * 2.6 - w.spanL) / w.dxs))
  const hi = Math.min(N - 2, Math.ceil((cx0 + sig * 2.6 - w.spanL) / w.dxs))
  for (let i = lo; i <= hi; i++) {
    const dx = w.spanL + i * w.dxs - cx0
    const g2 = Math.exp(-dx * dx * inv)
    if (g2 < 0.01) continue
    w.hvF[i] += (amp * g2 - w.hF[i]) * blend
  }
}

/** 高斯位置注入（粘滞呼吸：缓慢拖向圆丘再放手） */
function gaussTarget(w: World, cx0: number, sig: number, amp: number, blend: number): void {
  const inv = 1 / (sig * sig)
  const lo = Math.max(1, Math.floor((cx0 - sig * 2.6 - w.spanL) / w.dxs))
  const hi = Math.min(N - 2, Math.ceil((cx0 + sig * 2.6 - w.spanL) / w.dxs))
  for (let i = lo; i <= hi; i++) {
    const dx = w.spanL + i * w.dxs - cx0
    const g2 = Math.exp(-dx * dx * inv)
    if (g2 < 0.01) continue
    w.hF[i] += (amp * g2 - w.hF[i]) * blend
  }
}

/** 节点速度脉冲（液滴落回的击凹） */
function impulseHv(w: World, x: number, amt: number): void {
  const idx = Math.round((x - w.spanL) / w.dxs)
  for (let j = -3; j <= 3; j++) {
    const i = idx + j
    if (i < 1 || i > N - 2) continue
    w.hvF[i] += amt * Math.exp((-j * j) / 3)
  }
}

/* ─────────────────── 池管理（swap-remove） ─────────────────── */

function spawnDrop(w: World, x: number, y: number, vx: number, vy: number, r: number): void {
  let i: number
  if (w.dropN < MAX_DROPS) i = w.dropN++
  else {
    i = w.dropVictim
    w.dropVictim = (w.dropVictim + 1) % MAX_DROPS
  }
  const d = w.drops[i]
  d.x = x
  d.y = y
  d.vx = vx
  d.vy = vy
  d.r = r
  d.ph = Math.random() * TAU
}

function removeDrop(w: World, i: number): void {
  const last = --w.dropN
  if (i !== last) {
    const a = w.drops[i]
    const b = w.drops[last]
    a.x = b.x
    a.y = b.y
    a.vx = b.vx
    a.vy = b.vy
    a.r = b.r
    a.ph = b.ph
  }
}

function spawnGrain(w: World, x: number, y: number, vx: number, vy: number, life: number, lime: number): void {
  if (w.grainN >= MAX_GRAINS) return
  const g = w.grains[w.grainN++]
  g.x = x
  g.y = y
  g.vx = vx
  g.vy = vy
  g.life = life
  g.lime = lime
}

function removeGrain(w: World, i: number): void {
  const last = --w.grainN
  if (i !== last) {
    const a = w.grains[i]
    const b = w.grains[last]
    a.x = b.x
    a.y = b.y
    a.vx = b.vx
    a.vy = b.vy
    a.life = b.life
    a.lime = b.lime
  }
}

function spawnRipple(w: World, x: number, y: number): void {
  if (w.rippleN >= MAX_RIPPLES) {
    // 满时替换最旧
    const r = w.ripples[0]
    for (let i = 1; i < MAX_RIPPLES; i++) {
      const a = w.ripples[i - 1]
      const b = w.ripples[i]
      a.x = b.x
      a.y = b.y
      a.r = b.r
      a.v = b.v
      a.a = b.a
    }
    r.x = x
    r.y = y
    r.r = 6
    r.v = 100
    r.a = 0.4
    return
  }
  const r = w.ripples[w.rippleN++]
  r.x = x
  r.y = y
  r.r = 6
  r.v = 95 + Math.random() * 45
  r.a = 0.4
}

function removeRipple(w: World, i: number): void {
  const last = --w.rippleN
  if (i !== last) {
    const a = w.ripples[i]
    const b = w.ripples[last]
    a.x = b.x
    a.y = b.y
    a.r = b.r
    a.v = b.v
    a.a = b.a
  }
}

/* ─────────────────── 音频（懒创建 / muted 门控） ─────────────────── */

function ensureAudio(w: World): void {
  const a = w.audio
  if (a.ac || w.disposed) return
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ac = new AC()
    const master = ac.createGain()
    master.gain.value = a.muted ? 0 : 0.55
    master.connect(ac.destination)
    // 42Hz 次声嗡鸣（双失谐正弦，gate 随接近度×强度开合）
    const humOsc = ac.createOscillator()
    humOsc.type = 'sine'
    humOsc.frequency.value = 42
    const humOsc2 = ac.createOscillator()
    humOsc2.type = 'sine'
    humOsc2.frequency.value = 42.6
    const humMix = ac.createGain()
    humMix.gain.value = 0.5
    const humGain = ac.createGain()
    humGain.gain.value = 0.5
    const humGate = ac.createGain()
    humGate.gain.value = 0
    humOsc.connect(humMix)
    humOsc2.connect(humMix)
    humMix.connect(humGain)
    humGain.connect(humGate)
    humGate.connect(master)
    humOsc.start()
    humOsc2.start()
    // 峰生长咆哮：低通锯齿 90-140Hz
    const roarOsc = ac.createOscillator()
    roarOsc.type = 'sawtooth'
    roarOsc.frequency.value = 95
    const roarLP = ac.createBiquadFilter()
    roarLP.type = 'lowpass'
    roarLP.frequency.value = 340
    roarLP.Q.value = 0.7
    const roarGain = ac.createGain()
    roarGain.gain.value = 0
    roarOsc.connect(roarLP)
    roarLP.connect(roarGain)
    roarGain.connect(master)
    roarOsc.start()
    // 共用噪声缓冲
    const len = Math.floor(ac.sampleRate * 0.5)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const ch0 = buf.getChannelData(0)
    for (let i = 0; i < len; i++) ch0[i] = Math.random() * 2 - 1
    a.ac = ac
    a.master = master
    a.humGate = humGate
    a.roarGain = roarGain
    a.roarOsc = roarOsc
    a.noise = buf
    if (ac.state === 'suspended') void ac.resume().catch(() => {})
  } catch {
    /* 音频异常静默 */
  }
}

/** 液滴并合 blip：sine 500→140Hz */
function blipSound(w: World): void {
  const a = w.audio
  if (!a.ac || !a.master || a.muted) return
  try {
    const ac = a.ac
    const n = ac.currentTime
    if (n - a.lastBlip < 0.05) return
    a.lastBlip = n
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(500, n)
    o.frequency.exponentialRampToValueAtTime(140, n + 0.085)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, n)
    g.gain.exponentialRampToValueAtTime(0.055, n + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, n + 0.1)
    o.connect(g)
    g.connect(a.master)
    o.start(n)
    o.stop(n + 0.12)
  } catch {
    /* 音频异常静默 */
  }
}

/** 溅落：低通噪声短爆（k = 强度 0..1，重落附带低频闷响） */
function plipSound(w: World, k: number): void {
  const a = w.audio
  if (!a.ac || !a.master || a.muted || !a.noise) return
  try {
    const ac = a.ac
    const n = ac.currentTime
    if (n - a.lastPlip < 0.05) return
    a.lastPlip = n
    const kk = clamp(k, 0, 1)
    const src = ac.createBufferSource()
    src.buffer = a.noise
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 480 + 720 * kk
    const g = ac.createGain()
    g.gain.setValueAtTime(0.04 + 0.11 * kk, n)
    g.gain.exponentialRampToValueAtTime(0.0001, n + 0.13)
    src.connect(lp)
    lp.connect(g)
    g.connect(a.master)
    src.start(n, Math.random() * 0.2)
    src.stop(n + 0.15)
    if (kk > 0.55) {
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(170, n)
      o.frequency.exponentialRampToValueAtTime(62, n + 0.12)
      const og = ac.createGain()
      og.gain.setValueAtTime(0.055, n)
      og.gain.exponentialRampToValueAtTime(0.0001, n + 0.14)
      o.connect(og)
      og.connect(a.master)
      o.start(n)
      o.stop(n + 0.16)
    }
  } catch {
    /* 音频异常静默 */
  }
}

/** 连续声部：嗡鸣 gate / 咆哮 pitch+gain（EMA + 直写，零分配） */
function updateDrone(w: World, dt: number): void {
  const a = w.audio
  if (!a.ac || !a.humGate || !a.roarGain || !a.roarOsc) return
  const stN = clamp((w.strength - 1) / 1.6, 0, 1)
  const humT = 0.05 * w.ps * (w.strength / 2.6) * (0.82 + 0.18 * Math.sin(w.t * 0.7))
  a.humEma += (humT - a.humEma) * (1 - Math.exp(-7 * dt))
  a.humGate.gain.value = a.humEma
  const roarT = clamp(w.act * 0.1, 0, 1) * (0.02 + 0.05 * stN)
  a.roarEma += (roarT - a.roarEma) * (1 - Math.exp(-9 * dt))
  a.roarGain.gain.value = a.roarEma
  const ft = 90 + 50 * stN
  a.roarFreqEma += (ft - a.roarFreqEma) * (1 - Math.exp(-5 * dt))
  a.roarOsc.frequency.value = a.roarFreqEma
}

/* ─────────────────── 交互响应 ─────────────────── */

/** 液面上短促尖峰爆发（点击液面） */
function kickBurst(w: World, x: number): void {
  const n = 4 + Math.floor(Math.random() * 3)
  let cursor = MAG_SLOTS
  for (let k = 0; k < n; k++) {
    let slot: SpikeSlot | null = null
    for (let s = 0; s < MAX_SPIKES - MAG_SLOTS; s++) {
      const idx = MAG_SLOTS + ((cursor - MAG_SLOTS + s) % (MAX_SPIKES - MAG_SLOTS))
      if (w.spikes[idx].g < 0.06) {
        slot = w.spikes[idx]
        cursor = idx + 1
        break
      }
    }
    if (!slot) {
      // 全忙：取最低者
      let low = w.spikes[MAG_SLOTS]
      for (let s = MAG_SLOTS + 1; s < MAX_SPIKES; s++) {
        if (w.spikes[s].g < low.g) low = w.spikes[s]
      }
      slot = low
    }
    slot.kind = 1
    slot.ax = x + (Math.random() * 2 - 1) * w.rSurf * 0.07
    slot.lat = (Math.random() * 2 - 1) * 0.3
    slot.lenS = 0.32 + Math.random() * 0.26
    slot.g = 1
    slot.gv = 1.5 + Math.random() * 2.5
    slot.ph = Math.random() * TAU
  }
}

/** 快速点击：液面甩出液滴 / 液面处尖峰爆发 */
function tapAt(w: World, x: number, y: number): void {
  const ax = clamp(x, w.spanL + 4, w.spanR - 4)
  const ay = w.yL - hAt(w, ax)
  const inside = Math.hypot(x - w.cx, y - w.cy) < w.Rin
  if (inside && y > ay - 12) {
    // 点击在液面上：短促尖峰爆发后回落
    kickBurst(w, x)
    impulseHv(w, x, -62)
    spawnRipple(w, x, ay)
    const n = 1 + (Math.random() < 0.5 ? 1 : 0)
    for (let k = 0; k < n; k++) {
      spawnDrop(w, x, ay - 5, (Math.random() * 2 - 1) * 70, -150 - Math.random() * 130, 2.4 + Math.random() * 2)
    }
    plipSound(w, 0.5)
  } else {
    // 从液面向点击方向甩出 3-6 颗光泽液滴
    const dx = x - ax
    const dy = y - ay
    const dl = Math.hypot(dx, dy) || 1
    const spd = clamp(dl * 3.1, 230, 620)
    const n = 3 + Math.floor(Math.random() * 4)
    for (let k = 0; k < n; k++) {
      const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.85
      const s = spd + Math.random() * 70
      spawnDrop(w, ax + (Math.random() - 0.5) * 10, ay - 2, Math.cos(ang) * s, Math.sin(ang) * s - 60, 2.6 + Math.random() * 3.2)
    }
    impulseHv(w, ax, -38)
    plipSound(w, 0.28)
  }
}

/** 液滴并合：涟漪 + 溅粒 + 凹陷 + 声 */
function mergeDrop(w: World, i: number, sy: number): void {
  const d = w.drops[i]
  spawnRipple(w, d.x, sy)
  impulseHv(w, d.x, -d.r * 4.2)
  const gn = 2 + Math.floor(Math.random() * 3)
  for (let k = 0; k < gn; k++) {
    spawnGrain(w, d.x, sy - 2, (Math.random() * 2 - 1) * 130, -90 - Math.random() * 170, 0.5 + Math.random() * 0.3, Math.random() < 0.25 ? 1 : 0)
  }
  blipSound(w)
  if (d.vy > 240) plipSound(w, clamp(0.5 + d.vy / 900, 0.5, 1))
  else plipSound(w, 0.3)
  removeDrop(w, i)
}

/** 撞到皿壁：小涟漪 + blip */
function wallSplat(w: World, i: number): void {
  const d = w.drops[i]
  const dx = d.x - w.cx
  const dy = d.y - w.cy
  const dl = Math.hypot(dx, dy) || 1
  spawnRipple(w, w.cx + (dx / dl) * w.rWall, w.cy + (dy / dl) * w.rWall)
  blipSound(w)
  removeDrop(w, i)
}

/* ─────────────────── 物理帧 ─────────────────── */

function tick(w: World, dt: number): void {
  if (w.w < 40) return
  w.t += dt
  const ptr = w.ptr
  const h = w.hF
  const hv = w.hvF

  /* 磁铁替身（略滞后 → 粘滞手感） */
  const km = 1 - Math.exp(-12 * dt)
  w.mag.x += (ptr.x - w.mag.x) * km
  w.mag.y += (ptr.y - w.mag.y) * km
  const ka = 1 - Math.exp(-7 * dt)
  w.mag.a += ((ptr.has ? 1 : 0) - w.mag.a) * ka
  const dvv = Math.exp(-5 * dt)
  ptr.vx *= dvv
  ptr.vy *= dvv

  /* 磁场强度：按住 ramp → 2.6，松手粘弹性回落 */
  const sT = ptr.down && ptr.has ? 2.6 : 1
  w.sv += ((sT - w.strength) * 26 - w.sv * 6.5) * dt
  w.strength += w.sv * dt
  if (w.strength < 0.72) {
    w.strength = 0.72
    if (w.sv < 0) w.sv = -w.sv * 0.4
  } else if (w.strength > 2.9) {
    w.strength = 2.9
    if (w.sv > 0) w.sv = -w.sv * 0.4
  }
  const stN = clamp((w.strength - 1) / 1.6, 0, 1)

  /* 接近距离 p（平滑 ps 防跳变消失） */
  let p = 0
  if (ptr.has) {
    const sx = clamp(w.mag.x, w.spanL, w.spanR)
    const sy = w.yL - hAt(w, sx)
    if (w.mag.y >= sy) p = 1
    else p = clamp(1 - Math.hypot(w.mag.x - sx, w.mag.y - sy) / (w.Rin * REACH_F), 0, 1)
  }
  w.p = p
  w.ps += (p - w.ps) * (1 - Math.exp(-10 * dt))

  const idle = !ptr.has || w.t - ptr.lastMove > 2

  /* 开卷：两滴铁磁液落定（睁眼即活） */
  if (w.intro === 0 && w.t > 0.75) {
    w.intro = 1
    spawnDrop(w, w.cx - w.Rin * 0.28, w.cy - w.Rin * 0.7, 6, 40, 3.6)
  }
  if (w.intro === 1 && w.t > 1.5) {
    w.intro = 2
    spawnDrop(w, w.cx + w.Rin * 0.34, w.cy - w.Rin * 0.64, -10, 20, 3.1)
  }

  /* 呼吸圆丘（空闲每 4-7s） */
  const br = w.breath
  if (br.on) {
    const pr = (w.t - br.t0) / br.dur
    if (pr >= 1) br.on = false
    else {
      const env = Math.sin(pr * Math.PI)
      gaussTarget(w, br.x, w.Rin * 0.34, br.amp * env * env, Math.min(0.3, 3 * dt))
    }
  } else if (idle && w.t > w.nextBreath) {
    br.on = true
    br.t0 = w.t
    br.dur = 2.4 + Math.random() * 1.2
    br.amp = w.Rin * 0.05 + Math.random() * w.Rin * 0.035
    br.x = w.cx + (Math.random() * 2 - 1) * w.rSurf * 0.6
    w.nextBreath = w.t + 4 + Math.random() * 3
  }

  /* 环境涟漪（常驻微幅，空闲略强） */
  const ambA = idle ? 2.1 : 0.7
  for (let i = 1; i < N - 1; i++) {
    const x = w.spanL + i * w.dxs
    const tgt = ambA * Math.sin(w.t * 1.35 + x * 0.012 + Math.sin(w.t * 0.21) * 1.7)
    hv[i] += (tgt - h[i]) * 1.6 * dt
  }

  /* 磁铁影响：质量拖曳（主鼓包 + 两个次级小峰） + 快移撕滴 */
  if (w.ps > 0.02) {
    const ax = clamp(w.mag.x, w.spanL + w.rSurf * 0.05, w.spanR - w.rSurf * 0.05)
    w.anchorX = ax
    const lift = clamp((w.yL - w.mag.y) * 0.34, 0, 30)
    const bump = (3 + lift) * (0.35 + 0.65 * w.ps) * (0.55 + 0.45 * stN)
    gaussForce(w, ax, w.rSurf * 0.24, bump, 5 * dt)
    gaussForce(w, ax - w.rSurf * 0.34, w.rSurf * 0.13, bump * 0.34, 5 * dt)
    gaussForce(w, ax + w.rSurf * 0.38, w.rSurf * 0.13, bump * 0.3, 5 * dt)
    const spd = Math.hypot(ptr.vx, ptr.vy)
    if (spd > 820 && w.ps > 0.35 && w.t - ptr.lastShed > 0.34) {
      ptr.lastShed = w.t
      const n = spd > 1400 ? 2 : 1
      const sy = w.yL - hAt(w, ax)
      for (let k = 0; k < n; k++) {
        spawnDrop(w, ax + (Math.random() * 2 - 1) * 7, sy - 5, ptr.vx * 0.42 + (Math.random() * 2 - 1) * 60, ptr.vy * 0.16 - 110 - Math.random() * 90, 2.6 + Math.random() * 2.4)
      }
    }
  }

  /* 表面弹簧 + 邻居传播（2 次位置松弛） */
  for (let i = 1; i < N - 1; i++) hv[i] += (-K_SPRING * h[i] - D_SPRING * hv[i]) * dt
  for (let i = 1; i < N - 1; i++) h[i] += hv[i] * dt
  for (let pass = 0; pass < 2; pass++) {
    HTMP[0] = 0
    HTMP[N - 1] = 0
    for (let i = 1; i < N - 1; i++) HTMP[i] = h[i] + SMOOTH * ((h[i - 1] + h[i + 1]) * 0.5 - h[i])
    h.set(HTMP)
  }
  h[0] = 0
  h[N - 1] = 0
  hv[0] = 0
  hv[N - 1] = 0

  /* 尖峰生长（欠阻尼弹簧 → 回落过冲抖动） */
  const magCount = w.ps > 0.03 ? Math.min(MAG_SLOTS, 5 + Math.round(6 * clamp(w.ps * (0.3 + 0.7 * stN), 0, 1))) : 0
  w.magCount = magCount
  let act = 0
  for (let i = 0; i < MAX_SPIKES; i++) {
    const sp = w.spikes[i]
    let target = 0
    if (i < magCount) {
      sp.kind = 0
      target = clamp(w.ps * 2.6, 0, 1)
    }
    sp.gv += ((target - sp.g) * GK - sp.gv * GD) * dt
    sp.g += sp.gv * dt
    if (sp.g < -0.05) {
      sp.g = -0.05
      sp.gv = -sp.gv * 0.35
    } else if (sp.g > 1.45) {
      sp.g = 1.45
      sp.gv = -sp.gv * 0.35
    }
    act += sp.gv < 0 ? -sp.gv : sp.gv
  }
  w.act = act

  /* 液滴：重力 + 表面张力回吸 + 落回并合 */
  for (let i = w.dropN - 1; i >= 0; i--) {
    const d = w.drops[i]
    d.vy += GRAVITY * dt
    if (d.x > w.spanL && d.x < w.spanR) {
      const sy = w.yL - hAt(w, d.x)
      const gap = sy - d.y
      if (gap > 0 && gap < 34) d.vy += gap * 9 * dt
      if (d.y + d.r * 0.6 >= sy) {
        mergeDrop(w, i, sy)
        continue
      }
    }
    d.x += d.vx * dt
    d.y += d.vy * dt
    const ddx = d.x - w.cx
    const ddy = d.y - w.cy
    const rr = w.Rin - d.r * 0.4
    if (ddx * ddx + ddy * ddy > rr * rr) {
      wallSplat(w, i)
      continue
    }
    if (d.y > w.cy + w.Rin + 80) removeDrop(w, i)
  }

  /* 溅粒 */
  for (let i = w.grainN - 1; i >= 0; i--) {
    const g = w.grains[i]
    g.vy += GRAVITY * 1.15 * dt
    g.x += g.vx * dt
    g.y += g.vy * dt
    g.life -= dt
    if (g.life <= 0) {
      removeGrain(w, i)
      continue
    }
    if (g.x > w.spanL && g.x < w.spanR && g.y >= w.yL - hAt(w, g.x)) removeGrain(w, i)
  }

  /* 涟漪环 */
  for (let i = w.rippleN - 1; i >= 0; i--) {
    const r = w.ripples[i]
    r.r += r.v * dt
    r.a -= 1.15 * dt
    if (r.a <= 0 || r.r > w.rSurf * 1.15) removeRipple(w, i)
  }

  updateDrone(w, dt)
}

/* ─────────────────── 渲染 ─────────────────── */

/** 计算尖峰世界几何 → 模块暂存（反射 / 本体 / 磁感线共用） */
function computeSpikes(w: World): void {
  const stN = clamp((w.strength - 1) / 1.6, 0, 1)
  for (let i = 0; i < MAX_SPIKES; i++) {
    SG[i] = 0
    const sp = w.spikes[i]
    if (sp.g <= 0.05) continue
    const bx = sp.kind === 0
      ? clamp(w.anchorX + LAT[i] * w.rSurf * 0.17, w.spanL + 6, w.spanR - 6)
      : clamp(sp.ax, w.spanL + 6, w.spanR - 6)
    const by = w.yL - hAt(w, bx)
    let tx: number
    let ty: number
    let len: number
    let bw: number
    if (sp.kind === 0) {
      len = w.Rin * 0.92 * Math.pow(w.ps, 2.2) * w.strength * LENS[i] * sp.g
      let dx = w.mag.x - bx
      let dy = w.mag.y - by
      if (dy > -10) dy = -10 - (dy + 10) * 0.25
      const jA = 2.2 * stN
      if (jA > 0.05) {
        dx += Math.sin(w.t * 37 + sp.ph) * jA
        dy += Math.cos(w.t * 31 + sp.ph * 1.9) * jA * 0.6
      }
      const dl = Math.hypot(dx, dy) || 1
      const cap = Math.min(w.Rin * 1.05, Math.max(dl * 1.18 + 8, 26 + w.Rin * 0.24 * stN))
      if (len > cap) len = cap
      tx = bx + (dx / dl) * len
      ty = by + (dy / dl) * len
      bw = clamp(2.5 + 3.2 * LENS[i] - 1.5 * stN, 1.4, 5.6)
    } else {
      len = w.Rin * 0.5 * sp.lenS * sp.g
      tx = bx + Math.sin(sp.lat) * len
      ty = by - Math.cos(sp.lat) * len
      bw = 1.8 + 2 * sp.lenS
    }
    SG[i] = sp.g
    SBX[i] = bx
    SBY[i] = by
    STX[i] = tx
    STY[i] = ty
    SLN[i] = len
    SBW[i] = bw
  }
}

/** 细长三角（两侧二次贝塞尔内凹 → 锋利的刺）。part: 0=闭合 1=左缘 2=右缘 */
function spikePath(ctx: CanvasRenderingContext2D, bx: number, by: number, tx: number, ty: number, bw: number, part: number): void {
  const dx = tx - bx
  const dy = ty - by
  const L = Math.hypot(dx, dy) || 1
  const ux = dx / L
  const uy = dy / L
  const nx = -uy
  const ny = ux
  const lx = bx - nx * bw
  const ly = by - ny * bw
  const rx = bx + nx * bw
  const ry = by + ny * bw
  const clx = bx + ux * L * 0.42 - nx * bw * 0.12
  const cly = by + uy * L * 0.42 - ny * bw * 0.12
  const crx = bx + ux * L * 0.42 + nx * bw * 0.12
  const cry = by + uy * L * 0.42 + ny * bw * 0.12
  SGEO.lx = lx
  SGEO.ly = ly
  SGEO.rx = rx
  SGEO.ry = ry
  SGEO.clx = clx
  SGEO.cly = cly
  SGEO.crx = crx
  SGEO.cry = cry
  SGEO.tx = tx
  SGEO.ty = ty
  ctx.beginPath()
  if (part === 0) {
    ctx.moveTo(lx, ly)
    ctx.quadraticCurveTo(clx, cly, tx, ty)
    ctx.quadraticCurveTo(crx, cry, rx, ry)
    ctx.closePath()
  } else if (part === 1) {
    ctx.moveTo(lx, ly)
    ctx.quadraticCurveTo(clx, cly, tx, ty)
  } else {
    ctx.moveTo(rx, ry)
    ctx.quadraticCurveTo(crx, cry, tx, ty)
  }
}

/** 圆角矩形（磁铁光标条） */
function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, ww: number, hh: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + ww, y, x + ww, y + hh, r)
  ctx.arcTo(x + ww, y + hh, x, y + hh, r)
  ctx.arcTo(x, y + hh, x, y, r)
  ctx.arcTo(x, y, x + ww, y, r)
  ctx.closePath()
}

/** 液滴 sprite（预渲染一次：左上白高光 + 近黑主体 + 右下暗） */
function makeDropSprite(): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')
    if (!ctx) return null
    const g = ctx.createRadialGradient(26, 22, 2, 32, 32, 30)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.18, '#8d8a99')
    g.addColorStop(0.45, INK_TOP)
    g.addColorStop(0.8, '#100f14')
    g.addColorStop(1, INK_BOT)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(32, 32, 30, 0, TAU)
    ctx.fill()
    const g2 = ctx.createRadialGradient(42, 44, 4, 42, 44, 26)
    g2.addColorStop(0, 'rgba(0,0,0,0.5)')
    g2.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.arc(32, 32, 30, 0, TAU)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.arc(24, 20, 4.2, 0, TAU)
    ctx.fill()
    return c
  } catch {
    return null
  }
}

/** 纸底 + 标本皿静态层（预渲染：噪点 / 暗角 / 投影 / 双圈） */
function buildPaper(w: World, devW: number, devH: number, dpr: number): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas')
    c.width = devW
    c.height = devH
    const p = c.getContext('2d')
    if (!p) return null
    p.setTransform(dpr, 0, 0, dpr, 0, 0)
    p.fillStyle = PAPER_BG
    p.fillRect(0, 0, w.w, w.h)
    // 细噪点颗粒（alpha ~0.04）
    const t = document.createElement('canvas')
    t.width = 128
    t.height = 128
    const tc = t.getContext('2d')
    if (tc) {
      const img = tc.createImageData(128, 128)
      const dd = img.data
      for (let i = 0; i < dd.length; i += 4) {
        const v = (Math.random() * 255) | 0
        dd[i] = v
        dd[i + 1] = v
        dd[i + 2] = v
        dd[i + 3] = Math.random() < 0.5 ? 0 : (8 + Math.random() * 8) | 0
      }
      tc.putImageData(img, 0, 0)
      const pat = p.createPattern(t, 'repeat')
      if (pat) {
        p.fillStyle = pat
        p.fillRect(0, 0, w.w, w.h)
      }
    }
    // 极轻暗角（画廊海报感）
    const vg = p.createRadialGradient(w.cx, w.h * 0.5, Math.min(w.w, w.h) * 0.44, w.cx, w.h * 0.5, Math.max(w.w, w.h) * 0.78)
    vg.addColorStop(0, 'rgba(46,42,50,0)')
    vg.addColorStop(1, 'rgba(46,42,50,0.07)')
    p.fillStyle = vg
    p.fillRect(0, 0, w.w, w.h)
    // 皿外缘柔和投影（径向渐变）
    const sh = p.createRadialGradient(w.cx, w.cy + w.R * 0.05, w.R * 0.84, w.cx, w.cy + w.R * 0.05, w.R * 1.24)
    sh.addColorStop(0, 'rgba(28,26,32,0.2)')
    sh.addColorStop(0.62, 'rgba(28,26,32,0.1)')
    sh.addColorStop(1, 'rgba(28,26,32,0)')
    p.fillStyle = sh
    p.beginPath()
    p.arc(w.cx, w.cy + w.R * 0.05, w.R * 1.24, 0, TAU)
    p.fill()
    // 皿内壁极淡衬底
    p.fillStyle = 'rgba(58,58,64,0.05)'
    p.beginPath()
    p.arc(w.cx, w.cy, w.Rin, 0, TAU)
    p.fill()
    // 深灰双圈（外圈偏冷 / 内圈）
    p.strokeStyle = '#3a3a40'
    p.lineWidth = 2.5
    p.beginPath()
    p.arc(w.cx, w.cy, w.R + 1, 0, TAU)
    p.stroke()
    p.strokeStyle = '#6a6a72'
    p.lineWidth = 1.5
    p.beginPath()
    p.arc(w.cx, w.cy, w.R - 2.6, 0, TAU)
    p.stroke()
    return c
  } catch {
    return null
  }
}

function strokeRun(ctx: CanvasRenderingContext2D, w: World, s: number, e: number): void {
  ctx.beginPath()
  ctx.moveTo(w.spanL + s * w.dxs, YS[s])
  for (let j = s + 1; j <= e; j++) ctx.lineTo(w.spanL + j * w.dxs, YS[j])
  ctx.stroke()
}

function draw(w: World, ctx: CanvasRenderingContext2D): void {
  if (w.w < 40 || w.h < 40) return
  const cx = w.cx
  const cy = w.cy
  const Rin = w.Rin
  const h = w.hF
  const stN = clamp((w.strength - 1) / 1.6, 0, 1)

  /* 纸底 + 皿 */
  if (w.paper) ctx.drawImage(w.paper, 0, 0, w.w, w.h)
  else {
    ctx.fillStyle = PAPER_BG
    ctx.fillRect(0, 0, w.w, w.h)
    ctx.strokeStyle = '#3a3a40'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(cx, cy, w.R + 1, 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = '#6a6a72'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, w.R - 2.6, 0, TAU)
    ctx.stroke()
  }

  computeSpikes(w)

  /* 皿内（裁剪） */
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, Rin, 0, TAU)
  ctx.clip()

  /* 流体主体：左内壁 → 高度场顶面 → 右内壁 → 皿底闭合 */
  ctx.beginPath()
  ctx.moveTo(w.spanL, w.yL)
  for (let i = 0; i < N; i++) {
    YS[i] = w.yL - h[i]
    ctx.lineTo(w.spanL + i * w.dxs, YS[i])
  }
  ctx.lineTo(cx + w.rWall, w.yL)
  ctx.arc(cx, cy, Rin, w.angR, Math.PI - w.angR, false)
  ctx.closePath()
  ctx.fillStyle = w.grad ?? INK_MID
  ctx.fill()

  /* 液面之下的尖峰倒影（浅色幽灵 alpha 0.13） */
  ctx.fillStyle = 'rgba(74,70,88,0.13)'
  for (let i = 0; i < MAX_SPIKES; i++) {
    if (SG[i] <= 0.05 || SLN[i] < 6) continue
    spikePath(ctx, SBX[i], SBY[i], STX[i], 2 * SBY[i] - STY[i], SBW[i], 0)
    ctx.fill()
  }

  /* 尖峰本体：同渐变填充 + 左缘高光 + 右缘暗线 + 尖端闪点 */
  const grad = w.grad
  for (let i = 0; i < MAX_SPIKES; i++) {
    if (SG[i] <= 0.045 || SLN[i] < 2) continue
    const bx = SBX[i]
    const by = SBY[i]
    const tx = STX[i]
    const ty = STY[i]
    const bw = SBW[i]
    spikePath(ctx, bx, by, tx, ty, bw, 0)
    ctx.fillStyle = grad ?? INK_MID
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    spikePath(ctx, bx, by, tx, ty, bw, 1)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    spikePath(ctx, bx, by, tx, ty, bw, 2)
    ctx.stroke()
    if (SG[i] > 0.55) {
      ctx.globalAlpha = clamp(0.3 + 0.5 * SG[i], 0, 0.85)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(tx, ty, 1 + 0.7 * stN, 0, TAU)
      ctx.fill()
      if (stN > 0.35 && SG[i] > 0.75) {
        ctx.globalAlpha = 0.5 * stN
        ctx.fillStyle = LIME
        ctx.beginPath()
        ctx.arc(tx - 0.6, ty - 0.6, 0.9, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }

  /* 顶面镜面高光线（坡度朝左上的段更亮，分桶批量描边） */
  ctx.lineWidth = 1.5
  ctx.lineCap = 'butt'
  let runS = -1
  let runB = 0
  for (let i = 0; i < N - 1; i++) {
    const sl = (YS[i + 1] - YS[i]) / w.dxs
    let b = 0
    if (sl < -0.05) b = Math.max(1, Math.round(clamp(0.12 + 0.4 * (-sl / 1.5), 0, 1) * 10))
    if (b !== runB) {
      if (runB > 0 && runS >= 0) {
        ctx.strokeStyle = HL_A[runB]
        strokeRun(ctx, w, runS, i)
      }
      runB = b
      runS = b > 0 ? i : -1
    }
  }
  if (runB > 0 && runS >= 0) {
    ctx.strokeStyle = HL_A[runB]
    strokeRun(ctx, w, runS, N - 1)
  }

  /* 涟漪环（椭圆透视弧） */
  ctx.lineWidth = 1.2
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  for (let i = 0; i < w.rippleN; i++) {
    const r = w.ripples[i]
    ctx.globalAlpha = clamp(r.a, 0, 1)
    ctx.beginPath()
    ctx.ellipse(r.x, r.y, r.r, Math.max(1, r.r * 0.22), 0, 0, TAU)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  /* 溅粒（近黑 + 偶发青柠闪点） */
  for (let i = 0; i < w.grainN; i++) {
    const g = w.grains[i]
    if (g.lime > 0) {
      ctx.globalAlpha = 0.9
      ctx.fillStyle = LIME
    } else {
      ctx.globalAlpha = 0.85
      ctx.fillStyle = '#0d0c10'
    }
    ctx.fillRect(g.x - 1, g.y - 1, 2, 2)
  }
  ctx.globalAlpha = 1

  ctx.restore()

  /* 皿内壁高光弧（左上白弧）+ 右下内影弧（玻璃体积感） */
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.arc(cx, cy, Rin + 1.4, Math.PI * 1.03, Math.PI * 1.47)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, Rin + 1.2, Math.PI * 0.12, Math.PI * 0.5)
  ctx.stroke()
  ctx.restore()

  /* 液滴（皿外上方也可短暂越过皿口，不裁剪） */
  const spr = w.dropSprite
  if (spr) {
    for (let i = 0; i < w.dropN; i++) {
      const d = w.drops[i]
      ctx.drawImage(spr, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2)
      const ph = (w.t * 1.7 + d.ph) % 3
      if (ph < 0.14) {
        ctx.globalAlpha = 0.85
        ctx.fillStyle = LIME
        ctx.fillRect(d.x - d.r * 0.7 - 0.9, d.y - d.r * 0.7 - 0.9, 1.8, 1.8)
        ctx.globalAlpha = 1
      }
    }
  } else {
    ctx.fillStyle = '#101014'
    for (let i = 0; i < w.dropN; i++) {
      const d = w.drops[i]
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r, 0, TAU)
      ctx.fill()
    }
  }

  /* 磁感线：指针 → 各峰尖的虚点弧线（高强度时显示） */
  if (stN > 0.05 && w.ps > 0.08 && w.mag.a > 0.4 && w.magCount > 0) {
    ctx.save()
    ctx.setLineDash(DASH_FS)
    ctx.lineWidth = 1
    ctx.strokeStyle = LIME
    ctx.globalAlpha = w.mag.a * (0.08 + 0.32 * stN) * clamp(w.ps * 1.5, 0, 1)
    for (let i = 0; i < w.magCount; i++) {
      if (SG[i] < 0.4 || SLN[i] < 8) continue
      const mx0 = w.mag.x
      const my0 = w.mag.y
      const tx = STX[i]
      const ty = STY[i]
      const dx = tx - mx0
      const dy = ty - my0
      const dl = Math.hypot(dx, dy) || 1
      const off = dl * 0.14 * (i % 2 === 0 ? 1 : -1)
      ctx.beginPath()
      ctx.moveTo(mx0, my0)
      ctx.quadraticCurveTo((mx0 + tx) / 2 + (-dy / dl) * off, (my0 + ty) / 2 + (dx / dl) * off, tx, ty)
      ctx.stroke()
    }
    ctx.restore()
  }

  /* 磁铁光标（指针即磁体：条形磁铁朝向皿心，N 极青柠） */
  if (w.mag.a > 0.03) {
    const mx = w.mag.x
    const my = w.mag.y
    const ang = Math.atan2(w.cy - my, w.cx - mx)
    ctx.save()
    ctx.globalAlpha = w.mag.a
    ctx.translate(mx, my)
    ctx.rotate(ang)
    rrPath(ctx, -12, -4.5, 24, 9, 3)
    ctx.fillStyle = '#17161c'
    ctx.fill()
    ctx.strokeStyle = '#43434b'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = LIME
    ctx.fillRect(7, -4.5, 5, 9)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(9.5, 0, 1.6, 0, TAU)
    ctx.fill()
    ctx.restore()
    if (stN > 0.04) {
      for (let k = 0; k < 2; k++) {
        const ph = (w.t * 1.6 + k * 0.5) % 1
        ctx.globalAlpha = w.mag.a * stN * 0.5 * (1 - ph)
        ctx.strokeStyle = LIME
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(mx, my, 14 + ph * 24, 0, TAU)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  }
}

/* ─────────────────── 组件 ─────────────────── */

export default function Art12Ferrofluid({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = makeWorld()
    let running = false
    let disposed = false
    let raf = 0
    let last = performance.now()
    let muted = useBookStore.getState().muted
    w.audio.muted = muted
    w.dropSprite = makeDropSprite()

    const resize = () => {
      const rect = root.getBoundingClientRect()
      const cw = Math.floor(rect.width)
      const chh = Math.floor(rect.height)
      if (cw < 40 || chh < 40) {
        w.w = 0
        w.h = 0
        return
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(cw * dpr)
      canvas.height = Math.round(chh * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      w.w = cw
      w.h = chh
      /* 皿：直径 ≈ 页高 62%（窄页按宽钳制），中央偏下 */
      w.R = Math.min(chh * 0.31, cw * 0.43)
      w.Rin = w.R - 4.5
      w.cx = cw * 0.5
      w.cy = chh * 0.535
      w.yL = w.cy + w.Rin * 0.1
      w.rWall = Math.sqrt(Math.max(1, w.Rin * w.Rin - (w.yL - w.cy) * (w.yL - w.cy)))
      w.rSurf = w.rWall * 0.985
      w.spanL = w.cx - w.rSurf
      w.spanR = w.cx + w.rSurf
      w.dxs = (w.spanR - w.spanL) / (N - 1)
      w.angR = Math.atan2(w.yL - w.cy, w.rWall)
      /* 静液重置（resize 后液面重新落定） */
      w.hF.fill(0)
      w.hvF.fill(0)
      w.dropN = 0
      w.grainN = 0
      w.rippleN = 0
      for (let i = 0; i < MAX_SPIKES; i++) {
        const sp = w.spikes[i]
        sp.g = 0
        sp.gv = 0
        sp.kind = 0
      }
      w.breath.on = false
      w.nextBreath = w.t > 0.5 ? w.t + 1.5 : 1.8
      w.intro = w.t > 3 ? 2 : 0
      const g = ctx.createLinearGradient(w.cx, w.cy - w.Rin, w.cx, w.cy + w.Rin)
      g.addColorStop(0, INK_TOP)
      g.addColorStop(0.55, INK_MID)
      g.addColorStop(1, INK_BOT)
      w.grad = g
      w.paper = buildPaper(w, canvas.width, canvas.height, dpr)
      if (!running && !disposed) draw(w, ctx)
    }

    /* ── 指针（挂 canvas + capture） ── */
    const local = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onMove = (e: PointerEvent) => {
      const pt = local(e)
      const ptr = w.ptr
      const ts = e.timeStamp
      const dtv = (ts - ptr.lastET) / 1000
      if (dtv > 0.001 && dtv < 0.25) {
        ptr.vx = ptr.vx * 0.55 + ((pt.x - ptr.x) / dtv) * 0.45
        ptr.vy = ptr.vy * 0.55 + ((pt.y - ptr.y) / dtv) * 0.45
      }
      ptr.lastET = ts
      if (ptr.down) ptr.moved += Math.hypot(pt.x - ptr.x, pt.y - ptr.y)
      ptr.x = pt.x
      ptr.y = pt.y
      ptr.has = true
      ptr.lastMove = w.t
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const pt = local(e)
      const ptr = w.ptr
      ptr.x = pt.x
      ptr.y = pt.y
      ptr.has = true
      ptr.down = true
      ptr.downT = performance.now()
      ptr.downX = pt.x
      ptr.downY = pt.y
      ptr.moved = 0
      ptr.lastMove = w.t
      ensureAudio(w) // 首次手势内懒创建
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    }

    const onUp = (e: PointerEvent) => {
      const ptr = w.ptr
      if (!ptr.down) return
      ptr.down = false
      const dur = performance.now() - ptr.downT
      if (dur < 300 && ptr.moved < 10 && w.w >= 40) {
        const r = canvas.getBoundingClientRect()
        tapAt(w, e.clientX - r.left, e.clientY - r.top)
      }
    }

    const onCancel = () => {
      w.ptr.down = false
    }

    const onLeave = () => {
      w.ptr.has = false
      w.ptr.down = false
    }

    const onContextMenu = (e: Event) => {
      e.preventDefault() // 长按聚峰时屏蔽移动端右键菜单
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('contextmenu', onContextMenu)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      const a = w.audio
      a.muted = muted
      if (a.ac && a.master) {
        try {
          a.master.gain.setTargetAtTime(muted ? 0 : 0.55, a.ac.currentTime, 0.05)
        } catch {
          /* 音频异常静默 */
        }
      }
    })

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    /* 帧循环 */
    const frame = (now: number) => {
      if (!running || disposed) return
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      if (dt <= 0) dt = 1 / 60
      tick(w, dt)
      draw(w, ctx)
      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (running || disposed) return
      running = true
      last = performance.now()
      const a = w.audio
      if (a.ac && a.ac.state === 'suspended') void a.ac.resume().catch(() => {})
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      const a = w.audio
      if (a.ac) void a.ac.suspend().catch(() => {})
    }

    ctrlRef.current = { start, stop }

    return () => {
      disposed = true
      w.disposed = true
      stop()
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('contextmenu', onContextMenu)
      unsubMute()
      const a = w.audio
      if (a.ac) {
        try {
          void a.ac.close()
        } catch {
          /* noop */
        }
        a.ac = null
        a.master = null
        a.humGate = null
        a.roarGain = null
        a.roarOsc = null
        a.noise = null
      }
      ctrlRef.current = null
    }
  }, [])

  /* active 启停：暂停冻结末帧 + 悬置音频 */
  useEffect(() => {
    const ctrl = ctrlRef.current
    if (!ctrl) return
    if (active) ctrl.start()
    else ctrl.stop()
  }, [active])

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: PAPER_BG }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'none' }}
      />

      {/* 左上铭牌（等宽小字，青柠方块点缀） */}
      <div
        className="font-attitude pointer-events-none absolute z-10 flex items-center"
        style={{
          left: '13%',
          top: '7.5%',
          gap: '0.7cqw',
          fontSize: 'clamp(8px, 1.5cqw, 11px)',
          letterSpacing: '0.3em',
          color: 'rgba(26,25,30,0.58)',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          aria-hidden
          style={{ width: 'max(5px, 0.8cqw)', height: 'max(5px, 0.8cqw)', background: LIME, display: 'inline-block' }}
        />
        <span>
          FERROFLUID · <span className="font-cn">磁流</span> — SPECIMEN N°12
        </span>
      </div>

      {/* 右上：指针即磁体 */}
      <div
        className="pointer-events-none absolute z-10"
        style={{
          right: '12.5%',
          top: '7.5%',
          fontSize: 'clamp(7px, 1.35cqw, 10px)',
          letterSpacing: '0.26em',
          color: 'rgba(26,25,30,0.5)',
          whiteSpace: 'nowrap',
        }}
      >
        <span className="font-attitude">MAGNET&nbsp;</span>
        <span style={{ color: LIME }}>▸</span>
        <span className="font-cn">&nbsp;指针即磁体</span>
      </div>

      {/* 底部署名（居中，避开左右 10% 热区与角部页码徽章） */}
      <div
        className="font-cn pointer-events-none absolute inset-x-0 z-10 text-center"
        style={{
          bottom: '3.5%',
          fontSize: 'clamp(7px, 1.3cqw, 10px)',
          letterSpacing: '0.34em',
          color: 'rgba(26,25,30,0.45)',
          whiteSpace: 'nowrap',
        }}
      >
        磁流　<span className="font-attitude">FERROFLUID</span> — 指针即磁体 · 按住聚峰 · 点击滴溅
      </div>
    </div>
  )
}
