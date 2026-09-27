'use client'

/**
 * ROOM 03 · INK TIDE 墨潮 — 实时流体墨海
 *
 * 一汪活的墨之海，读者亲手搅动。核心是简化版实时流体模拟（Stam stable fluids）：
 * 粗网格（cell ≈ 8–10px，约 6000–9000 格点）上的速度场 + 双染料场
 * （黑墨 inkB / 朱砂 inkR）。每帧：注入力与染料 → 半拉格朗日平流（速度与染料，
 * 双线性插值）→ 压力投影（Gauss-Seidel 12 次迭代）→ 染料缓慢衰减
 * （×0.999/帧，保留记忆但终会消散）。边界：速度法向分量置零。
 *
 * 渲染：染料场写入一张网格分辨率的小离屏 canvas（1 格 = 1px；黑墨
 * rgba(20,17,14) 与朱砂 rgba(192,57,43) 两遍洗染因子合成——数学上等价于
 * 两次 multiply 罩染叠加），再 drawImage 放大（imageSmoothingEnabled=true）
 * 到预渲染纸底上 → 柔和的墨云晕染。纸底 #f5f1e6 + 噪点纹理（离屏，≈0.05）+
 * 轻内阴影暗角（画框感，像一幅水墨装裱）。
 *
 * 金粉：150 粒微小金色尘点（1–2px #d9c88f）被速度场平流（直接采样速度场移动），
 * 让无墨处的流动也可见。
 *
 * 交互（全部 pointer 事件挂 canvas + setPointerCapture）：
 * - 移动（无需按键）：沿途注入动量（∝指针速度）+ 细墨丝（低浓度染料线）
 * - 轻点（<300ms 且位移 <10px）：墨爆——大团染料径向爆发 + 径向冲量 +
 *   5–9 颗墨点飞溅落远处各自晕开小圈；每第 5 次墨爆为朱砂红
 * - 按住（≥400ms）：泉眼——按点持续涌出深墨 + 向上的力场，松开即止
 * - 空闲：每 8–14s 一次自动潮汐（正弦包络的横穿力带）+ 柔和潮声；
 *   叠加极缓慢的环境旋转漂移（小涡），墨永远不会完全静止
 * - 开卷第一幕：挂载即注入 3 团错落的墨 + 一次小潮汐，页面一睁眼就是活的
 *
 * 音频（全部经 master gain / useBookStore.muted 订阅联动 / 首次手势懒创建 /
 * inactive 时 suspend / 卸载 close）：深水低鸣（55Hz 正弦 + 棕噪低通，随搅动
 * 强度短暂起伏）；墨爆 plip（正弦 800→180Hz 下滑 + 噪声 tick）；泉眼汩汩
 * （随机短促 sine blip 序列）；潮汐 swell。
 *
 * 性能：DPR ≤ 2；canvas 宽或高 < 40px 跳过渲染；帧耗时 EMA > 40ms 一次性降级
 * （压力迭代 12→8、金粉减半）；渲染循环零对象分配（TypedArray 复用 + 对象池）；
 * resize 重建网格并按比例双线性重采样保留染料与速度场。
 *
 * 调色板：纸白 #f5f1e6 / 墨黑 #14110e / 朱砂红 #c0392b / 金 #d9c88f。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const TAU = Math.PI * 2
const PAPER = '#f5f1e6'
const GOLD = '#d9c88f'
const VERMILION_STR = '#c0392b'

/** 金粉粒子上限（降级时减半） */
const GOLD_N = 150
/** 飞溅墨点对象池 */
const SPLASH_N = 48
/** 涟漪环对象池 */
const RING_N = 10
/** 速度上限（格/秒） */
const CAPV = 120
/** 染料浓度上限 */
const DMAX = 3.2

export default function Art03({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // ---------- 离屏资源 ----------
    // 染料画布：网格分辨率（1 格 = 1px），放大后即为墨云
    const dyeCv = document.createElement('canvas')
    const dctx = dyeCv.getContext('2d')
    if (!dctx) return
    // 纸底画布：满分辨率预渲染（底色 + 噪点 + 内阴影暗角），每帧仅 1 次 drawImage
    const paperCv = document.createElement('canvas')
    const pg = paperCv.getContext('2d')
    if (!pg) return

    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let running = false
    let disposed = false
    let simT = 0
    let last = 0
    let muted = useBookStore.getState().muted

    // ---------- 流体网格状态 ----------
    let cell = 9 // 每格对应的 CSS 像素
    let gw = 0
    let gh = 0
    let gsize = 0
    let u = new Float32Array(0) // 速度 x（格/秒）
    let v = new Float32Array(0) // 速度 y（格/秒）
    let u0 = new Float32Array(0)
    let v0 = new Float32Array(0)
    let dB = new Float32Array(0) // 黑墨染料
    let dR = new Float32Array(0) // 朱砂染料
    let dB0 = new Float32Array(0)
    let dR0 = new Float32Array(0)
    let prs = new Float32Array(0) // 压力（Gauss-Seidel 暖启动）
    let div = new Float32Array(0)
    let img: ImageData | null = null
    let pressIters = 12

    // ---------- 交互状态 ----------
    const ptr = {
      x: 0,
      y: 0,
      tMs: 0,
      has: false,
      down: false,
      downX: 0,
      downY: 0,
      downT: 0,
      moved: 0,
      lastInkX: 0,
      lastInkY: 0,
    }
    const spring = { on: false, x: 0, y: 0, blip: 0, ring: 0 }
    let burstCount = 0
    let lastUserT = -30
    let stirEnergy = 0

    // 潮汐（空闲自动 + 开卷小潮汐）
    const tide = { on: false, t: 0, dur: 4, dir: 1, amp: 1, phase: 0 }
    let tideWait = 9.5

    // 开卷第一幕时间线（按时间升序：三团错落的墨 → 小潮汐）
    const openAt = [0.08, 0.7, 1.15, 1.6]
    let openStep = 0

    // 飞溅墨点池（零分配）
    const spOn = new Uint8Array(SPLASH_N)
    const spX = new Float32Array(SPLASH_N)
    const spY = new Float32Array(SPLASH_N)
    const spAt = new Float32Array(SPLASH_N)
    const spR = new Float32Array(SPLASH_N)
    const spRed = new Uint8Array(SPLASH_N)
    let spHead = 0

    // 涟漪环池（零分配）
    const rgOn = new Uint8Array(RING_N)
    const rgX = new Float32Array(RING_N)
    const rgY = new Float32Array(RING_N)
    const rgT0 = new Float32Array(RING_N)
    const rgMax = new Float32Array(RING_N)
    const rgRed = new Uint8Array(RING_N)
    let rgHead = 0

    // 金粉（一次分配，复用）
    const goldX = new Float32Array(GOLD_N)
    const goldY = new Float32Array(GOLD_N)
    const goldS = new Float32Array(GOLD_N)
    const goldPh = new Float32Array(GOLD_N)
    const goldTw = new Float32Array(GOLD_N)
    let goldCount = GOLD_N
    const velOut = { x: 0, y: 0 }

    // 性能监测（EMA 降级）
    let emaMs = 16.7
    let framesSeen = 0
    let degraded = false
    let audioT = 0

    // ---------- 音频（首次手势懒创建） ----------
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let humGain: GainNode | null = null
    let brownBuf: AudioBuffer | null = null

    const initAudio = () => {
      if (ac || disposed) return
      try {
        const ctxA = new AudioContext()
        ac = ctxA
        master = ctxA.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(ctxA.destination)
        // 棕噪循环缓冲（2s，供低鸣/汩汩/潮声共用）
        const len = Math.floor(ctxA.sampleRate * 2)
        const buf = ctxA.createBuffer(1, len, ctxA.sampleRate)
        const ch = buf.getChannelData(0)
        let lv = 0
        for (let i = 0; i < len; i++) {
          const wn = Math.random() * 2 - 1
          lv = (lv + 0.021 * wn) / 1.02
          ch[i] = lv * 3.4
        }
        brownBuf = buf
        // 深水低鸣：55Hz 正弦 + 棕噪低通（humGain 随搅动强度起伏）
        humGain = ctxA.createGain()
        humGain.gain.value = 0.8
        humGain.connect(master)
        const osc = ctxA.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = 55
        const og = ctxA.createGain()
        og.gain.value = 0.05
        osc.connect(og)
        og.connect(humGain)
        osc.start()
        const ns = ctxA.createBufferSource()
        ns.buffer = buf
        ns.loop = true
        const lp = ctxA.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 170
        const ng = ctxA.createGain()
        ng.gain.value = 0.055
        ns.connect(lp)
        lp.connect(ng)
        ng.connect(humGain)
        ns.start()
      } catch {
        ac = null
      }
    }

    /** 墨爆 plip：正弦下滑 + 噪声 tick */
    const plip = (red: boolean) => {
      if (!ac || !master || muted) return
      const n = ac.currentTime
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(red ? 640 : 820, n)
      o.frequency.exponentialRampToValueAtTime(red ? 150 : 185, n + 0.13)
      const g = ac.createGain()
      g.gain.setValueAtTime(red ? 0.26 : 0.2, n)
      g.gain.exponentialRampToValueAtTime(0.001, n + 0.19)
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + 0.21)
      if (brownBuf) {
        const src = ac.createBufferSource()
        src.buffer = brownBuf
        src.playbackRate.value = 2.6
        const hp = ac.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 1900
        const tg = ac.createGain()
        tg.gain.setValueAtTime(0.09, n)
        tg.gain.exponentialRampToValueAtTime(0.001, n + 0.045)
        src.connect(hp)
        hp.connect(tg)
        tg.connect(master)
        src.start(n, Math.random() * 1.5)
        src.stop(n + 0.05)
      }
    }

    /** 泉眼汩汩：随机短促 sine blip（幅值随随机起伏近似流速） */
    const springBlip = () => {
      if (!ac || !master || muted) return
      const n = ac.currentTime
      const o = ac.createOscillator()
      o.type = 'sine'
      const f = 230 + Math.random() * 420
      o.frequency.setValueAtTime(f, n)
      o.frequency.exponentialRampToValueAtTime(f * (0.55 + Math.random() * 0.7), n + 0.07)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.028 + Math.random() * 0.048, n)
      g.gain.exponentialRampToValueAtTime(0.001, n + 0.09)
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + 0.1)
    }

    /** 潮汐 swell：低通棕噪缓起缓落 */
    const tideSwell = (amp: number) => {
      if (!ac || !master || muted || !brownBuf) return
      const n = ac.currentTime
      const src = ac.createBufferSource()
      src.buffer = brownBuf
      src.loop = true
      src.playbackRate.value = 0.7
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 340
      const g = ac.createGain()
      g.gain.setValueAtTime(0.0001, n)
      g.gain.linearRampToValueAtTime(0.12 * amp, n + 1.5)
      g.gain.setTargetAtTime(0.0001, n + 2.6, 0.8)
      src.connect(lp)
      lp.connect(g)
      g.connect(master)
      src.start(n)
      src.stop(n + 5.5)
    }

    // ---------- 流体力学 ----------
    /** 局部注入：力（直接加速度×dt 已折算）与染料，二次衰减包络 */
    const splat = (
      gx: number,
      gy: number,
      fx: number,
      fy: number,
      r: number,
      addB: number,
      addR: number,
    ) => {
      if (gw < 4) return
      const x0 = Math.max(0, Math.ceil(gx - r))
      const x1 = Math.min(gw - 1, Math.floor(gx + r))
      const y0 = Math.max(0, Math.ceil(gy - r))
      const y1 = Math.min(gh - 1, Math.floor(gy + r))
      if (x1 < x0 || y1 < y0) return
      const r2 = r * r
      for (let j = y0; j <= y1; j++) {
        const row = j * gw
        for (let i = x0; i <= x1; i++) {
          const dx = i - gx
          const dy = j - gy
          const d2 = dx * dx + dy * dy
          if (d2 >= r2) continue
          const fall = 1 - d2 / r2
          const idx = i + row
          if (fx !== 0 || fy !== 0) {
            let nu = u[idx] + fx * fall
            let nv = v[idx] + fy * fall
            if (nu > CAPV) nu = CAPV
            else if (nu < -CAPV) nu = -CAPV
            if (nv > CAPV) nv = CAPV
            else if (nv < -CAPV) nv = -CAPV
            u[idx] = nu
            v[idx] = nv
          }
          if (addB > 0) {
            const nd = dB[idx] + addB * fall
            dB[idx] = nd > DMAX ? DMAX : nd
          }
          if (addR > 0) {
            const nd = dR[idx] + addR * fall
            dR[idx] = nd > DMAX ? DMAX : nd
          }
        }
      }
    }

    /** 径向冲量（带切向卷曲分量 → 涡） */
    const radial = (gx: number, gy: number, r: number, s: number, curl: number) => {
      if (gw < 4) return
      const x0 = Math.max(0, Math.ceil(gx - r))
      const x1 = Math.min(gw - 1, Math.floor(gx + r))
      const y0 = Math.max(0, Math.ceil(gy - r))
      const y1 = Math.min(gh - 1, Math.floor(gy + r))
      if (x1 < x0 || y1 < y0) return
      for (let j = y0; j <= y1; j++) {
        const row = j * gw
        for (let i = x0; i <= x1; i++) {
          const dx = i - gx
          const dy = j - gy
          const d2 = dx * dx + dy * dy
          const d = Math.sqrt(d2)
          if (d > r || d < 0.3) continue
          let fall = 1 - d / r
          fall *= fall
          const nx = dx / d
          const ny = dy / d
          const idx = i + row
          let nu = u[idx] + s * fall * (nx - curl * ny)
          let nv = v[idx] + s * fall * (ny + curl * nx)
          if (nu > CAPV) nu = CAPV
          else if (nu < -CAPV) nu = -CAPV
          if (nv > CAPV) nv = CAPV
          else if (nv < -CAPV) nv = -CAPV
          u[idx] = nu
          v[idx] = nv
        }
      }
    }

    /** 边界：速度法向分量置零（切向同置零：无滑移壁，避免边缘残留速度） */
    const velBnd = () => {
      const lastCol = gw - 1
      const lastRow = (gh - 1) * gw
      for (let j = 0; j < gh; j++) {
        const row = j * gw
        u[row] = 0
        v[row] = 0
        u[lastCol + row] = 0
        v[lastCol + row] = 0
      }
      for (let i = 0; i < gw; i++) {
        u[i] = 0
        v[i] = 0
        u[i + lastRow] = 0
        v[i + lastRow] = 0
      }
    }

    /** 压力投影（Gauss-Seidel），Stam 离散格式（h = 1 格） */
    const project = () => {
      for (let j = 1; j < gh - 1; j++) {
        const row = j * gw
        for (let i = 1; i < gw - 1; i++) {
          const idx = i + row
          div[idx] = -0.5 * (u[idx + 1] - u[idx - 1] + v[idx + gw] - v[idx - gw])
        }
      }
      const lastRow = (gh - 1) * gw
      for (let k = 0; k < pressIters; k++) {
        for (let j = 1; j < gh - 1; j++) {
          const row = j * gw
          for (let i = 1; i < gw - 1; i++) {
            const idx = i + row
            prs[idx] =
              (div[idx] + prs[idx - 1] + prs[idx + 1] + prs[idx - gw] + prs[idx + gw]) * 0.25
          }
        }
        // 压力边界：Neumann（镜像内值）
        for (let i = 1; i < gw - 1; i++) {
          prs[i] = prs[i + gw]
          prs[i + lastRow] = prs[i + lastRow - gw]
        }
        for (let j = 1; j < gh - 1; j++) {
          const row = j * gw
          prs[row] = prs[row + 1]
          prs[row + gw - 1] = prs[row + gw - 2]
        }
        prs[0] = (prs[1] + prs[gw]) * 0.5
        prs[gw - 1] = (prs[gw - 2] + prs[2 * gw - 1]) * 0.5
        prs[lastRow] = (prs[lastRow + 1] + prs[lastRow - gw]) * 0.5
        prs[gsize - 1] = (prs[gsize - 2] + prs[gsize - 1 - gw]) * 0.5
      }
      for (let j = 1; j < gh - 1; j++) {
        const row = j * gw
        for (let i = 1; i < gw - 1; i++) {
          const idx = i + row
          u[idx] -= 0.5 * (prs[idx + 1] - prs[idx - 1])
          v[idx] -= 0.5 * (prs[idx + gw] - prs[idx - gw])
        }
      }
    }

    /** 半拉格朗日平流（双线性回溯采样），cl 为写入钳制 */
    const advectField = (
      dst: Float32Array,
      src: Float32Array,
      vu: Float32Array,
      vv: Float32Array,
      dt: number,
      decay: number,
      cl: number,
      border: boolean,
    ) => {
      const iLo = border ? 0 : 1
      const jLo = border ? 0 : 1
      const iHi = border ? gw : gw - 1
      const jHi = border ? gh : gh - 1
      const xmax = gw - 1.5
      const ymax = gh - 1.5
      for (let j = jLo; j < jHi; j++) {
        const row = j * gw
        for (let i = iLo; i < iHi; i++) {
          const idx = i + row
          let x = i - dt * vu[idx]
          let y = j - dt * vv[idx]
          if (x < 0.5) x = 0.5
          else if (x > xmax) x = xmax
          if (y < 0.5) y = 0.5
          else if (y > ymax) y = ymax
          const i0 = x | 0
          const j0 = y | 0
          const s = x - i0
          const tt = y - j0
          const r0 = j0 * gw
          const r1 = r0 + gw
          const a = src[i0 + r0]
          const b = src[i0 + 1 + r0]
          const c = src[i0 + r1]
          const dd = src[i0 + 1 + r1]
          const top = a + (b - a) * s
          const bot = c + (dd - c) * s
          let val = (top + (bot - top) * tt) * decay
          if (val > cl) val = cl
          dst[idx] = val
        }
      }
    }

    /** 速度场双线性采样（金粉平流用），结果写入复用的 velOut */
    const velAt = (gx: number, gy: number) => {
      let x = gx
      let y = gy
      const xmax = gw - 1.5
      const ymax = gh - 1.5
      if (x < 0.5) x = 0.5
      else if (x > xmax) x = xmax
      if (y < 0.5) y = 0.5
      else if (y > ymax) y = ymax
      const i0 = x | 0
      const j0 = y | 0
      const s = x - i0
      const tt = y - j0
      const r0 = j0 * gw
      const r1 = r0 + gw
      const ua = u[i0 + r0]
      const ub = u[i0 + 1 + r0]
      const uc = u[i0 + r1]
      const ud = u[i0 + 1 + r1]
      const va = v[i0 + r0]
      const vb = v[i0 + 1 + r0]
      const vc = v[i0 + r1]
      const vd = v[i0 + 1 + r1]
      const topU = ua + (ub - ua) * s
      const botU = uc + (ud - uc) * s
      const topV = va + (vb - va) * s
      const botV = vc + (vd - vc) * s
      velOut.x = topU + (botU - topU) * tt
      velOut.y = topV + (botV - topV) * tt
    }

    // ---------- 事件效果 ----------
    const spawnRing = (x: number, y: number, red: boolean, max: number) => {
      const k = rgHead % RING_N
      rgHead++
      rgOn[k] = 1
      rgX[k] = x
      rgY[k] = y
      rgT0[k] = simT
      rgMax[k] = max
      rgRed[k] = red ? 1 : 0
    }

    const scheduleSplash = (x: number, y: number, at: number, r: number, red: boolean) => {
      const k = spHead % SPLASH_N
      spHead++
      spOn[k] = 1
      spX[k] = x
      spY[k] = y
      spAt[k] = at
      spR[k] = r
      spRed[k] = red ? 1 : 0
    }

    const startTide = (amp: number, dur?: number) => {
      tide.on = true
      tide.t = 0
      tide.dur = dur === undefined ? 3.6 + Math.random() * 1.6 : dur
      tide.amp = amp
      tide.dir = Math.random() < 0.5 ? -1 : 1
      tide.phase = Math.random() * TAU
      tideSwell(amp)
    }

    /** 开卷墨团：染料 + 轻微旋涡（大而深，扛得住潮汐剪切） */
    const stampBlob = (x: number, y: number, rpx: number, amt: number) => {
      if (gw < 4) return
      const gx = x / cell
      const gy = y / cell
      splat(gx, gy, 0, 0, rpx / cell, amt, 0)
      radial(gx, gy, (rpx * 1.7) / cell, 5, 1)
    }

    /** 墨爆：大团染料 + 径向冲量 + 飞溅墨点 + 涟漪；每第 5 次为朱砂红 */
    const burst = (x: number, y: number) => {
      if (gw < 4 || w < 40) return
      burstCount++
      const red = burstCount % 5 === 0
      const m = Math.min(w, h)
      const R = m * 0.052
      const gx = x / cell
      const gy = y / cell
      radial(gx, gy, (R * 2.3) / cell, 52, 0.42)
      splat(gx, gy, 0, 0, (R * 1.4) / cell, red ? 0 : 1.3, red ? 1.15 : 0)
      const n = 5 + Math.floor(Math.random() * 5)
      for (let k = 0; k < n; k++) {
        const a = Math.random() * TAU
        const d = R * (1.7 + Math.random() * 1.6)
        let sx = x + Math.cos(a) * d
        let sy = y + Math.sin(a) * d
        if (sx < 14) sx = 14
        else if (sx > w - 14) sx = w - 14
        if (sy < 14) sy = 14
        else if (sy > h - 14) sy = h - 14
        scheduleSplash(sx, sy, simT + 0.05 + Math.random() * 0.24, m * (0.012 + Math.random() * 0.02), red)
      }
      spawnRing(x, y, red, R * 2.1)
      plip(red)
      lastUserT = simT
      stirEnergy += 1.2
    }

    // ---------- 纸底预渲染 ----------
    const buildPaper = () => {
      if (w < 4 || h < 4) return
      paperCv.width = Math.max(2, Math.round(w * dpr))
      paperCv.height = Math.max(2, Math.round(h * dpr))
      pg.setTransform(dpr, 0, 0, dpr, 0, 0)
      // 纸底
      pg.fillStyle = PAPER
      pg.fillRect(0, 0, w, h)
      // 旧化暖色晕
      let g1 = pg.createRadialGradient(w * 0.3, h * 0.18, 0, w * 0.3, h * 0.18, Math.max(w, h) * 0.62)
      g1.addColorStop(0, 'rgba(70,58,34,0.05)')
      g1.addColorStop(1, 'rgba(70,58,34,0)')
      pg.fillStyle = g1
      pg.fillRect(0, 0, w, h)
      g1 = pg.createRadialGradient(w * 0.78, h * 0.86, 0, w * 0.78, h * 0.86, Math.max(w, h) * 0.55)
      g1.addColorStop(0, 'rgba(70,58,34,0.06)')
      g1.addColorStop(1, 'rgba(70,58,34,0)')
      pg.fillStyle = g1
      pg.fillRect(0, 0, w, h)
      // 噪点纹理（离屏 tile，整体 ≈ 0.05）
      const tile = document.createElement('canvas')
      tile.width = 96
      tile.height = 96
      const tg = tile.getContext('2d')
      if (tg) {
        for (let i = 0; i < 640; i++) {
          const a = 0.04 + Math.random() * 0.1
          tg.fillStyle =
            Math.random() < 0.55 ? `rgba(88,72,44,${a})` : `rgba(255,255,250,${a * 0.9})`
          tg.fillRect(Math.random() * 96, Math.random() * 96, 1, 1)
        }
        const pat = pg.createPattern(tile, 'repeat')
        if (pat) {
          pg.globalAlpha = 0.5
          pg.fillStyle = pat
          pg.fillRect(0, 0, w, h)
          pg.globalAlpha = 1
        }
      }
      // 内阴影暗角（画框感）
      const cx = w / 2
      const cy = h / 2
      const vg = pg.createRadialGradient(cx, cy, Math.min(w, h) * 0.36, cx, cy, Math.hypot(w, h) * 0.58)
      vg.addColorStop(0, 'rgba(60,47,26,0)')
      vg.addColorStop(1, 'rgba(60,47,26,0.16)')
      pg.fillStyle = vg
      pg.fillRect(0, 0, w, h)
      const edge = (x0: number, y0: number, x1: number, y1: number, a: number) => {
        const eg = pg.createLinearGradient(x0, y0, x1, y1)
        eg.addColorStop(0, `rgba(58,46,26,${a})`)
        eg.addColorStop(1, 'rgba(58,46,26,0)')
        pg.fillStyle = eg
        pg.fillRect(0, 0, w, h)
      }
      edge(0, 0, w * 0.07, 0, 0.13) // 装订侧
      edge(w, 0, w * 0.93, 0, 0.1)
      edge(0, 0, 0, h * 0.06, 0.09)
      edge(0, h, 0, h * 0.94, 0.09)
      // 装裱细框线
      pg.strokeStyle = 'rgba(74,58,32,0.22)'
      pg.lineWidth = 1
      const inset = Math.max(7, Math.min(w, h) * 0.022)
      pg.strokeRect(inset, inset, w - inset * 2, h - inset * 2)
    }

    // ---------- 主渲染帧 ----------
    const renderFrame = (dt: number) => {
      if (w < 40 || h < 40 || gw < 12 || gh < 12 || !img) return
      const m = Math.min(w, h)

      // —— 开卷第一幕：3 团错落的深墨 + 一次温和小潮汐
      if (openStep < 4 && simT >= openAt[openStep]) {
        if (openStep === 0) stampBlob(w * 0.36, h * 0.32, m * 0.12, 1.6)
        else if (openStep === 1) stampBlob(w * 0.64, h * 0.58, m * 0.09, 1.3)
        else if (openStep === 2) stampBlob(w * 0.46, h * 0.78, m * 0.1, 1.4)
        else startTide(0.42, 4.5)
        openStep++
      }

      // —— 泉眼激活（按住 ≥400ms 且未拖走）
      if (
        ptr.down &&
        !spring.on &&
        gw > 0 &&
        performance.now() - ptr.downT >= 400 &&
        ptr.moved < 26
      ) {
        spring.on = true
        spring.x = ptr.downX
        spring.y = ptr.downY
        spring.blip = 0
        spring.ring = 0
        lastUserT = simT
      }

      // —— 飞溅墨点落定（各自晕开小圈）
      for (let k = 0; k < SPLASH_N; k++) {
        if (spOn[k] === 0 || simT < spAt[k]) continue
        spOn[k] = 0
        const gx = spX[k] / cell
        const gy = spY[k] / cell
        splat(gx, gy, 0, 0, Math.max(1.4, spR[k] / cell), spRed[k] ? 0 : 0.6 + Math.random() * 0.3, spRed[k] ? 0.55 : 0)
        radial(gx, gy, 2.6, 5, 0.6)
      }

      // —— 泉眼：持续涌出深墨 + 向上的力场
      if (spring.on && gw > 0) {
        spring.blip -= dt
        if (spring.blip <= 0) {
          spring.blip = 0.06 + Math.random() * 0.11
          springBlip()
        }
        spring.ring -= dt
        if (spring.ring <= 0) {
          spring.ring = 0.55
          spawnRing(spring.x, spring.y, false, m * 0.045)
        }
        const gx = spring.x / cell
        const gy = spring.y / cell
        const wob = Math.sin(simT * 6.5) * 7
        splat(gx, gy, wob * dt, -46 * dt, 2.6, 8.5 * dt, 0)
      }

      // —— 潮汐：正弦包络的横穿力带
      if (tide.on) {
        tide.t += dt / tide.dur
        if (tide.t >= 1) {
          tide.on = false
          tideWait = 8 + Math.random() * 6
        } else {
          const bx = (-0.18 + 1.36 * tide.t) * (gw - 1)
          const bw = gw * 0.24
          const x0 = Math.max(1, Math.ceil(bx - bw))
          const x1 = Math.min(gw - 2, Math.floor(bx + bw))
          const S = 50 * tide.amp
          for (let j = 1; j < gh - 1; j++) {
            const yn = j / (gh - 1)
            let env = Math.sin(Math.PI * yn) * (0.72 + 0.28 * Math.sin(yn * 6.3 + tide.phase + simT * 1.6))
            if (env < 0.05) env = 0.05
            const row = j * gw
            for (let i = x0; i <= x1; i++) {
              const dxn = (i - bx) / bw
              const fall = 1 - dxn * dxn
              if (fall <= 0) continue
              const idx = i + row
              let nu = u[idx] + tide.dir * S * fall * env * dt
              if (nu > CAPV) nu = CAPV
              else if (nu < -CAPV) nu = -CAPV
              u[idx] = nu
            }
          }
        }
      } else if (openStep >= 4 && simT - lastUserT > 2.5) {
        // 空闲潮汐调度（开卷序幕完成后开始计时）
        tideWait -= dt
        if (tideWait <= 0) startTide(1)
      }

      // —— 极缓慢的环境旋转漂移（小涡，墨永不完全静止）
      if (gw > 4) {
        const cxg = (gw - 1) * 0.5
        const cyg = (gh - 1) * 0.5
        const om = 0.006
        for (let j = 1; j < gh - 1; j++) {
          const fu = -om * (j - cyg)
          const row = j * gw
          for (let i = 1; i < gw - 1; i++) {
            const idx = i + row
            u[idx] += fu * dt
            v[idx] += om * (i - cxg) * dt
          }
        }
      }

      // —— 速度：阻尼 + 半拉格朗日平流
      const dampF = Math.exp(-0.25 * dt)
      for (let k = 0; k < gsize; k++) {
        u0[k] = u[k] * dampF
        v0[k] = v[k] * dampF
      }
      advectField(u, u0, u0, v0, dt, 1, CAPV, false)
      advectField(v, v0, u0, v0, dt, 1, CAPV, false)
      velBnd()
      project()
      velBnd()

      // —— 染料：平流 + 缓慢衰减（×0.999/帧）
      const decay = Math.pow(0.999, dt * 60)
      for (let k = 0; k < gsize; k++) {
        dB0[k] = dB[k]
        dR0[k] = dR[k]
      }
      advectField(dB, dB0, u, v, dt, decay, DMAX, true)
      advectField(dR, dR0, u, v, dt, decay, DMAX, true)

      // ================= 绘制 =================
      // 纸底（1:1 拷贝）
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(paperCv, 0, 0, w, h)

      // 墨云：两遍洗染因子合成到网格分辨率像素（黑墨 rgba(20,17,14) 一遍、
      // 朱砂 rgba(192,57,43) 一遍；f = (1-a+a·ink/255)，乘积等价两次 multiply 罩染）
      const dat = img.data
      for (let k = 0; k < gsize; k++) {
        const b = dB[k]
        const r = dR[k]
        const o = k << 2
        if (b < 0.003 && r < 0.003) {
          dat[o] = 255
          dat[o + 1] = 255
          dat[o + 2] = 255
        } else {
          const aB = b / (b + 0.34)
          const aR = r / (r + 0.34)
          dat[o] = 255 * (1 - aB * 0.9216) * (1 - aR * 0.2471)
          dat[o + 1] = 255 * (1 - aB * 0.9333) * (1 - aR * 0.7765)
          dat[o + 2] = 255 * (1 - aB * 0.9451) * (1 - aR * 0.8314)
        }
      }
      dctx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(dyeCv, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'

      // 金粉尘点（速度场平流 + 微颤 + 闪烁）
      ctx.fillStyle = GOLD
      for (let k = 0; k < goldCount; k++) {
        velAt(goldX[k] / cell, goldY[k] / cell)
        goldX[k] += (velOut.x * cell + (Math.random() - 0.5) * 0.6) * dt
        goldY[k] += (velOut.y * cell + (Math.random() - 0.5) * 0.6) * dt
        if (goldX[k] < 2) goldX[k] += w - 4
        else if (goldX[k] > w - 2) goldX[k] -= w - 4
        if (goldY[k] < 2) goldY[k] += h - 4
        else if (goldY[k] > h - 2) goldY[k] -= h - 4
        const tw = 0.5 + 0.5 * Math.sin(simT * goldTw[k] + goldPh[k])
        ctx.globalAlpha = 0.26 + 0.6 * tw
        const s = goldS[k]
        ctx.fillRect(goldX[k] - s * 0.5, goldY[k] - s * 0.5, s, s)
      }
      ctx.globalAlpha = 1

      // 涟漪环（墨爆/泉眼反馈）
      for (let k = 0; k < RING_N; k++) {
        if (rgOn[k] === 0) continue
        const p = (simT - rgT0[k]) / 0.5
        if (p >= 1) {
          rgOn[k] = 0
          continue
        }
        if (p < 0) continue
        ctx.globalAlpha = (1 - p) * 0.4
        ctx.strokeStyle = rgRed[k] ? VERMILION_STR : 'rgba(20,17,14,0.9)'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(rgX[k], rgY[k], 2 + p * rgMax[k], 0, TAU)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // —— 音频参数（低鸣随搅动强度起伏）
      stirEnergy *= Math.exp(-1.8 * dt)
      audioT -= dt
      if (audioT <= 0) {
        audioT = 0.12
        if (ac && humGain) {
          const boost = Math.min(1.5, stirEnergy * 2.6)
          humGain.gain.setTargetAtTime(0.8 + boost, ac.currentTime, 0.22)
        }
      }
    }

    const frame = (now: number) => {
      if (!running || disposed) return
      const rawMs = now - last
      let dt = rawMs / 1000
      last = now
      if (dt > 0.045) dt = 0.045
      if (dt <= 0) dt = 1 / 120
      simT += dt
      // 帧耗时 EMA → 一次性降级（无头/软件渲染环境兜底）
      emaMs = emaMs * 0.92 + rawMs * 0.08
      framesSeen++
      if (!degraded && framesSeen > 45 && emaMs > 40) {
        degraded = true
        pressIters = 8
        goldCount = GOLD_N >> 1
      }
      renderFrame(dt)
      raf = requestAnimationFrame(frame)
    }

    // ---------- 尺寸（重建网格，染料/速度按比例双线性重采样保留） ----------
    const resize = () => {
      const rect = root.getBoundingClientRect()
      const nw = Math.max(1, Math.round(rect.width))
      const nh = Math.max(1, Math.round(rect.height))
      const ndpr = Math.min(window.devicePixelRatio || 1, 2)
      if (nw === w && nh === h && ndpr === dpr) return
      const oldW = w
      const oldH = h
      const oldGw = gw
      const oldGh = gh
      const oldCell = cell
      w = nw
      h = nh
      dpr = ndpr
      canvas.width = Math.max(2, Math.round(w * dpr))
      canvas.height = Math.max(2, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // 目标 6000–9000 格点：cell ≈ sqrt(面积/7200)，钳制 7–13px
      cell = Math.sqrt((w * h) / 7200)
      if (cell < 7) cell = 7
      if (cell > 13) cell = 13
      gw = Math.max(16, Math.min(150, Math.round(w / cell) + 1))
      gh = Math.max(16, Math.min(150, Math.round(h / cell) + 1))
      gsize = gw * gh

      const resample = (src: Float32Array, dst: Float32Array, mul: number) => {
        if (oldGw < 2 || oldGh < 2) return
        for (let j = 0; j < gh; j++) {
          let oy = (j + 0.5) * (oldGh / gh) - 0.5
          if (oy < 0) oy = 0
          else if (oy > oldGh - 1) oy = oldGh - 1
          const j0 = oy >= oldGh - 1 ? oldGh - 2 : Math.floor(oy)
          const ty = oy - j0
          const r0 = j0 * oldGw
          const r1 = r0 + oldGw
          for (let i = 0; i < gw; i++) {
            let ox = (i + 0.5) * (oldGw / gw) - 0.5
            if (ox < 0) ox = 0
            else if (ox > oldGw - 1) ox = oldGw - 1
            const i0 = ox >= oldGw - 1 ? oldGw - 2 : Math.floor(ox)
            const tx = ox - i0
            const a = src[i0 + r0]
            const b = src[i0 + 1 + r0]
            const c = src[i0 + r1]
            const dd = src[i0 + 1 + r1]
            const top = a + (b - a) * tx
            const bot = c + (dd - c) * tx
            dst[i + j * gw] = (top + (bot - top) * ty) * mul
          }
        }
      }

      const nu = new Float32Array(gsize)
      const nv = new Float32Array(gsize)
      const nu0 = new Float32Array(gsize)
      const nv0 = new Float32Array(gsize)
      const nB = new Float32Array(gsize)
      const nR = new Float32Array(gsize)
      const nB0 = new Float32Array(gsize)
      const nR0 = new Float32Array(gsize)
      // 速度单位换算：cells/s → px/s → 新 cells/s
      resample(u, nu, oldCell / cell)
      resample(v, nv, oldCell / cell)
      resample(dB, nB, 1)
      resample(dR, nR, 1)
      u = nu
      v = nv
      u0 = nu0
      v0 = nv0
      dB = nB
      dR = nR
      dB0 = nB0
      dR0 = nR0
      prs = new Float32Array(gsize)
      div = new Float32Array(gsize)

      dyeCv.width = gw
      dyeCv.height = gh
      img = dctx.createImageData(gw, gh)
      // alpha 通道一次性置满（此后每帧只重写 RGB）
      const dat = img.data
      for (let k = 0; k < gsize; k++) dat[(k << 2) + 3] = 255

      buildPaper()

      // 金粉位置迁移 / 首次布撒
      if (oldW > 0 && oldH > 0) {
        for (let k = 0; k < GOLD_N; k++) {
          goldX[k] = (goldX[k] / oldW) * w
          goldY[k] = (goldY[k] / oldH) * h
        }
      } else {
        for (let k = 0; k < GOLD_N; k++) {
          goldX[k] = Math.random() * w
          goldY[k] = Math.random() * h
          goldS[k] = Math.random() < 0.5 ? 1 : Math.random() < 0.8 ? 1.5 : 2
          goldPh[k] = Math.random() * TAU
          goldTw[k] = 1.5 + Math.random() * 2.5
        }
      }

      if (!running) renderFrame(0) // 冻结态 resize 立即重绘一帧
    }

    // ---------- 指针 ----------
    const loc = { x: 0, y: 0 }
    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      loc.x = e.clientX - rect.left
      loc.y = e.clientY - rect.top
      return loc
    }
    const capF = (val: number) => (val > CAPV ? CAPV : val < -CAPV ? -CAPV : val)

    const onPointerMove = (e: PointerEvent) => {
      const p = toLocal(e)
      if (ptr.has && gw > 0) {
        const ddtRaw = (e.timeStamp - ptr.tMs) / 1000
        const ddt = ddtRaw > 0.001 && ddtRaw < 0.25 ? ddtRaw : 0.016
        const dx = p.x - ptr.x
        const dy = p.y - ptr.y
        const dist = Math.hypot(dx, dy)
        if (dist > 0.55) {
          lastUserT = simT
          stirEnergy += Math.min(dist, 90) * 0.0032
          // 动量 ∝ 指针速度（px/s → 格/s）
          const fx = capF((dx / ddt / cell) * 0.9)
          const fy = capF((dy / ddt / cell) * 0.9)
          splat(p.x / cell, p.y / cell, fx, fy, 3.4, 0, 0)
          // 细墨丝（低浓度染料线，每 7px 落一点）
          if (Math.hypot(p.x - ptr.lastInkX, p.y - ptr.lastInkY) >= 7) {
            ptr.lastInkX = p.x
            ptr.lastInkY = p.y
            splat(p.x / cell, p.y / cell, 0, 0, 2.3, 0.05, 0)
          }
        }
      }
      ptr.x = p.x
      ptr.y = p.y
      ptr.tMs = e.timeStamp
      ptr.has = true
      if (ptr.down) {
        const mv = Math.hypot(p.x - ptr.downX, p.y - ptr.downY)
        if (mv > ptr.moved) ptr.moved = mv
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      initAudio()
      const p = toLocal(e)
      ptr.x = p.x
      ptr.y = p.y
      ptr.tMs = e.timeStamp
      ptr.has = true
      ptr.down = true
      ptr.downX = p.x
      ptr.downY = p.y
      ptr.downT = performance.now()
      ptr.moved = 0
      ptr.lastInkX = p.x
      ptr.lastInkY = p.y
      lastUserT = simT
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    }

    const onPointerUp = () => {
      if (!ptr.down) return
      ptr.down = false
      const dur = performance.now() - ptr.downT
      if (spring.on) {
        spring.on = false
      } else if (dur < 300 && ptr.moved < 10 && w > 0) {
        burst(ptr.downX, ptr.downY)
      }
    }

    const onPointerCancel = () => {
      ptr.down = false
      spring.on = false
    }

    const onPointerLeave = () => {
      ptr.has = false
    }

    const onContextMenu = (e: Event) => {
      e.preventDefault() // 长按泉眼时屏蔽移动端右键菜单
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('contextmenu', onContextMenu)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05)
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
      canvas.removeEventListener('contextmenu', onContextMenu)
      unsubMute()
      if (ac) {
        try {
          void ac.close()
        } catch {
          /* noop */
        }
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
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: PAPER }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />

      {/* 左上铭牌（等宽字） */}
      <div
        className="font-attitude pointer-events-none absolute z-10"
        style={{
          left: '13%',
          top: '7.5%',
          fontSize: 'clamp(8px, 1.5cqw, 11px)',
          letterSpacing: '0.34em',
          color: 'rgba(20,17,14,0.5)',
        }}
      >
        FLUID INK · N°03
      </div>

      {/* 右上竖排署名 + 朱印 */}
      <div
        className="pointer-events-none absolute z-10 flex flex-col items-center"
        style={{ right: '12.5%', top: '7.5%', gap: '1.4cqh' }}
      >
        <div
          className="font-cn select-none"
          style={{
            writingMode: 'vertical-rl',
            fontSize: 'clamp(20px, 3.6cqw, 34px)',
            fontWeight: 600,
            letterSpacing: '0.3em',
            color: 'rgba(20,17,14,0.82)',
            lineHeight: 1,
          }}
        >
          墨潮
        </div>
        <div
          className="font-attitude select-none"
          style={{
            writingMode: 'vertical-rl',
            fontSize: 'clamp(8px, 1.5cqw, 12px)',
            letterSpacing: '0.5em',
            color: 'rgba(20,17,14,0.55)',
            lineHeight: 1,
          }}
        >
          INK TIDE
        </div>
        <div
          className="flex items-center justify-center"
          style={{
            width: 'min(5cqw, 38px)',
            height: 'min(5cqw, 38px)',
            background: VERMILION_STR,
            transform: 'rotate(-3deg)',
            animation: 'ink-tide-seal 7s ease-in-out infinite',
          }}
          aria-hidden
        >
          <span className="font-cn" style={{ color: PAPER, fontSize: 'min(3.4cqw, 26px)', lineHeight: 1 }}>
            潮
          </span>
        </div>
      </div>

      {/* 底部居中提示（安全区，避开翻页热区与角部页码徽章） */}
      <div
        className="font-cn pointer-events-none absolute inset-x-0 z-10 text-center"
        style={{
          bottom: '3.5%',
          fontSize: 'clamp(7px, 1.3cqw, 10px)',
          letterSpacing: '0.4em',
          color: 'rgba(20,17,14,0.42)',
          whiteSpace: 'nowrap',
        }}
      >
        移动 · 搅动墨海 — 点击 · 墨爆 — 按住 · 泉眼
      </div>

      <style>{`
        @keyframes ink-tide-seal {
          0%, 100% { opacity: 0.72; }
          50% { opacity: 0.96; }
        }
      `}</style>
    </div>
  )
}
