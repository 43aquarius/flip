'use client'

/**
 * ROOM 17 · VERTIGO 眩晕文字 — TYPO VORTEX 字之涡
 *
 * 一场排版龙卷风：三百多个字形沿 11 个同心环盘旋，涡心向屏幕深处退去
 * （内环 z 大 → scale(z)=p/(p+z) 小 → 又小又淡，外环近而大而亮；环与环
 * 反向旋转，角速度 ∝ 1/投影环半径；整体叠加缓慢进动——椭圆框架轻摆 +
 * 公共旋进相位）。指针驾驶它、引爆它、吸噬它：
 *
 * - 移动：涡轴倾斜跟随（±18° eased 慢跟随，像把头探进龙卷风），
 *   指针速度注入旋转能量（各环加速至最高 2.4×，摩擦衰减）
 * - 点击：冲击波——白色冲击环快闪渐隐，半径内字形径向炸开
 *   （欠阻尼弹簧 1.2s 过冲回弹），伴随品红/青分离残影 + 轰爆
 * - 按住：引力井——半径随按住时长增长（最大页宽 55%），内里字形被
 *   拉向指针并沿拉伸方向 scaleY×1.4 拉长，松手弹簧回位带 wobble
 * - 空闲：涡呼吸（各环半径 ±3% 正弦）+ 每 9–16s 一次「眩晕事件」
 *   （1.8s 半径摆振·桶形畸变感 + 转速正弦波动 + 低音 pitch bend ±12%）
 * - 涡心：脉动的「瞳」——风暴之眼缓慢向指针漂移，注视着你
 *
 * 字形图集（性能关键）：字池（眩晕迷旋轸回 dizzy DIVERTIGO + A–Z +
 * 0–9 + ◯✳※·）× 3 档字号预渲染到 4 张离屏 atlas（酸黄 / 骨白 /
 * 品红 / 青各一，品红为每环一枚的「印记字形」与色差残影共用），
 * 运行时全部 drawImage，绝无逐帧 fillText 上百次。字体经
 * getComputedStyle 探针解析 var(--font-display)（→ Archivo Black
 * + 中文黑体回退），document.fonts.ready 后重建一次防晚载。
 *
 * 投影：自写透视——字形屏幕位置 = 中心 + 环半径×scale(z)×(cosθ,
 * sinθ×0.72)（椭圆压扁）+ 涡轴倾斜偏移（深环随指针倾侧）；远环
 * fog alpha 0.06–0.15，近环大而亮且有 1–2px 重影双曝光（复视感）。
 *
 * 音频（master gain + useBookStore.muted 订阅 + 首次手势懒创建 +
 * inactive suspend + 卸载 close）：旋转呼啸（粉噪过带通，声像随
 * 主环旋转左右摆动）、48Hz 深嗡鸣（眩晕事件 ±12% pitch bend）、
 * 点击轰爆（噪声爆 + 次重击）、引力井吸噬低鸣与松手闷响。
 *
 * 性能：DPR≤2；canvas 宽高<40px 跳过；atlas 预渲染（resize 守卫式
 * 重建）；字形 SoA（Uint/Float32Array）；渲染循环零分配；帧耗时
 * EMA>40ms 一次性降级（字形数降至 ~70%，偏舍远环）。调色板：
 * 底 #0c0c08 / 主墨酸黄 #f2ff1f / 近环骨白 #f4f2e6 / 印记品红 #ff2ea6。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const TAU = Math.PI * 2
const BG = '#0c0c08'
const ACID = '#f2ff1f'
const BONE = '#f4f2e6'
const MAGENTA = '#ff2ea6'
const CYAN = '#2ef2ff'
/** 图集墨色：0 酸黄主墨 / 1 骨白近环 / 2 品红印记·色差 / 3 青色差 */
const ATLAS_INKS: readonly string[] = [ACID, BONE, MAGENTA, CYAN]

/* ---------- 结构常量 ---------- */
const RING_N = 11 // 同心环数（规格 9–13）
const DEPTH_MAX = 1.35 // 最深环 z
const PERSP = 1.2 // scale(z) = PERSP / (PERSP + z)
const ELLIPSE_Y = 0.72 // 椭圆纵向压扁
const TILT_MAX = 0.314 // 涡轴最大倾角（±18°）
const RP_IN = 0.075 // 最深（内）环投影半径 × min(W,H)
const RP_OUT = 0.44 // 最近（外）环投影半径
const SWIRL_PREC = 0.05 // 进动相位速率 rad/s
const MID_RING = 5 // 声像同步参考环
const GLYPH_MAX = 460
const SPRING_K = 30 // 回位弹簧刚度
const SPRING_C = 6.2 // 阻尼（欠阻尼 → 1.2s 过冲回弹）
const WELL_DELAY = 0.24 // 按住判定 s
const WELL_GROW = 0.3 // 井半径增长率（页宽/秒）
const WELL_RMAX = 0.55 // 井最大半径（页宽比例）
const WELL_PULL = 52 // 吸噬弹簧强度
const BLAST_RK = 0.36 // 冲击波作用半径（min 边比例）
const BLAST_V = 540 // 冲击波峰值速度 px/s
const SHOCK_DUR = 0.55
const SHOCK_N = 4
const ATLAS_TIERS: readonly number[] = [84, 52, 32]
const ATLAS_COLS = 25
const EYE_CHAR = '瞳'
const EMPTY_DASH: number[] = []
const WELL_DASH: number[] = [5, 9]
const EYE_DASH: number[] = [3, 7]

/** 字池（去重后约 50 字符） */
const CHARS: readonly string[] = (() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ch of '眩晕迷旋轸回DIVERTIGOdizzyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789◯✳※·') {
    if (!seen.has(ch)) {
      seen.add(ch)
      out.push(ch)
    }
  }
  return out
})()

/** 确定性噪声（种子 → 0..1） */
const hash1 = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

export default function Art17({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    /* ---------- 基础状态 ---------- */
    let W = 0
    let H = 0
    let S = 0
    let halfW = 0
    let halfH = 0
    let dpr = 1
    let raf = 0
    let running = false
    let disposed = false
    let simT = 0
    let introT = 0
    let last = 0
    let muted = useBookStore.getState().muted

    /* ---------- 字体探针：解析 var(--font-display)（Archivo Black + 中文回退） ---------- */
    let displayFont = `'Archivo Black', 'Arial Black', 'PingFang SC', 'Microsoft YaHei', sans-serif`
    try {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;font-family:var(--font-display)'
      document.body.appendChild(probe)
      const fam = getComputedStyle(probe).fontFamily
      if (fam) displayFont = fam
      probe.remove()
    } catch {
      /* 保持回退字体栈 */
    }

    /* ---------- 字形图集（3 档字号 × 4 墨色，离屏预渲染） ---------- */
    const atlasCv: HTMLCanvasElement[] = []
    const tierFont = new Float64Array(3)
    const tierCW = new Float64Array(3)
    const tierCH = new Float64Array(3)
    const tierRowY = new Float64Array(3)
    let atlasBuiltAt = 0
    const measCv = document.createElement('canvas')
    const measCtx = measCv.getContext('2d')

    const buildAtlas = (): void => {
      const mc = measCtx
      if (!mc) return
      atlasBuiltAt = performance.now()
      let y = 0
      for (let t = 0; t < 3; t++) {
        const f = ATLAS_TIERS[t]
        mc.font = `900 ${f}px ${displayFont}`
        let adv = 1
        for (let i = 0; i < CHARS.length; i++) {
          const w = mc.measureText(CHARS[i]).width
          if (w > adv) adv = w
        }
        tierFont[t] = f
        tierCW[t] = Math.ceil(adv) + 12
        tierCH[t] = Math.ceil(f * 1.34)
        tierRowY[t] = y
        y += tierCH[t] * 2
      }
      const aw = Math.ceil(Math.max(tierCW[0], tierCW[1], tierCW[2]) * ATLAS_COLS)
      const ah = y
      for (let c = 0; c < 4; c++) {
        let cv = atlasCv[c]
        if (!cv) {
          cv = document.createElement('canvas')
          atlasCv[c] = cv
        }
        if (cv.width !== aw) cv.width = aw
        if (cv.height !== ah) cv.height = ah
        const g = cv.getContext('2d')
        if (!g) continue
        g.clearRect(0, 0, aw, ah)
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillStyle = ATLAS_INKS[c]
        for (let t = 0; t < 3; t++) {
          g.font = `900 ${tierFont[t]}px ${displayFont}`
          const cw = tierCW[t]
          const chh = tierCH[t]
          for (let i = 0; i < CHARS.length; i++) {
            const col = i % ATLAS_COLS
            const row = (i / ATLAS_COLS) | 0
            g.fillText(CHARS[i], col * cw + cw * 0.5, tierRowY[t] + row * chh + chh * 0.5)
          }
        }
      }
    }

    /** resize 守卫式重建（字体晚载兜底；1500ms 内不重复烘焙） */
    const ensureAtlas = (): void => {
      if (atlasCv.length === 4 && performance.now() - atlasBuiltAt < 1500) return
      buildAtlas()
    }
    buildAtlas()

    /* ---------- 环几何（ring 0 = 最深内环 → RING_N-1 = 最近外环） ---------- */
    const ringScale = new Float32Array(RING_N)
    const ringRw = new Float32Array(RING_N) // 世界半径（px）
    const ringOmega = new Float32Array(RING_N) // 基础角速度 rad/s（含方向）
    const ringRot = new Float32Array(RING_N)
    const ringBreath = new Float32Array(RING_N)
    const ringFog = new Float32Array(RING_N)
    const ringDepthK = new Float32Array(RING_N) // 0 近 → 1 深
    const ringSizeW = new Float32Array(RING_N) // 世界字号（px）
    const ringStart = new Int32Array(RING_N)
    const ringCount = new Int32Array(RING_N)
    for (let i = 0; i < RING_N; i++) {
      ringRot[i] = Math.random() * TAU
      ringBreath[i] = Math.random() * TAU
    }

    /* ---------- 字形 SoA ---------- */
    const gChar = new Uint16Array(GLYPH_MAX)
    const gRing = new Uint8Array(GLYPH_MAX)
    const gAng = new Float32Array(GLYPH_MAX)
    const gSizeK = new Float32Array(GLYPH_MAX)
    const gJitA = new Float32Array(GLYPH_MAX)
    const gCol = new Uint8Array(GLYPH_MAX)
    const gOx = new Float32Array(GLYPH_MAX)
    const gOy = new Float32Array(GLYPH_MAX)
    const gVx = new Float32Array(GLYPH_MAX)
    const gVy = new Float32Array(GLYPH_MAX)
    const gGlow = new Float32Array(GLYPH_MAX)
    const gPull = new Float32Array(GLYPH_MAX)
    const gSkip = new Uint8Array(GLYPH_MAX)
    let GN = 0

    const populate = (): void => {
      const target = S < 420 ? 330 : 410 // 规格 320–460
      const tMax = RING_N - 1
      let sumFr = 0
      for (let i = 0; i < RING_N; i++) sumFr += RP_IN + (RP_OUT - RP_IN) * (i / tMax)
      GN = 0
      for (let i = 0; i < RING_N; i++) {
        const tr = i / tMax
        const fr = RP_IN + (RP_OUT - RP_IN) * tr
        let n = Math.round((target * fr) / sumFr)
        if (n < 7) n = 7
        const start = GN
        let made = 0
        for (let j = 0; j < n && GN < GLYPH_MAX; j++, made++) {
          const gi = GN++
          gChar[gi] = (Math.random() * CHARS.length) | 0
          gRing[gi] = i
          gAng[gi] = (j / n) * TAU + (Math.random() - 0.5) * (TAU / n) * 0.55
          gSizeK[gi] = 0.82 + Math.random() * 0.4
          gJitA[gi] = 0.85 + Math.random() * 0.3
          const dk = 1 - tr
          if (dk < 0.24) gCol[gi] = 1 // 近环骨白
          else if (dk < 0.38) gCol[gi] = Math.random() < 0.5 ? 1 : 0 // 过渡带混排
          else gCol[gi] = 0 // 酸黄主墨
        }
        ringStart[i] = start
        ringCount[i] = made
        if (made > 0) {
          // 每环一枚「印记字形」——品红
          gCol[start + ((Math.random() * made) | 0)] = 2
        }
      }
    }

    /* ---------- 背景底（离屏烘焙：底色 + 涡心微晕 + 暗角） ---------- */
    const bgCv = document.createElement('canvas')
    const buildBg = (): void => {
      bgCv.width = canvas.width
      bgCv.height = canvas.height
      const g = bgCv.getContext('2d')
      if (!g) return
      const bw = bgCv.width
      const bh = bgCv.height
      g.fillStyle = BG
      g.fillRect(0, 0, bw, bh)
      const cx = bw * 0.5
      const cy = bh * 0.47
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.62 * dpr)
      glow.addColorStop(0, 'rgba(242,255,31,0.05)')
      glow.addColorStop(0.55, 'rgba(242,255,31,0.016)')
      glow.addColorStop(1, 'rgba(242,255,31,0)')
      g.fillStyle = glow
      g.fillRect(0, 0, bw, bh)
      const rMax = Math.sqrt(bw * bw + bh * bh) * 0.5
      const vig = g.createRadialGradient(cx, cy, S * 0.44 * dpr, cx, cy, rMax)
      vig.addColorStop(0, 'rgba(0,0,0,0)')
      vig.addColorStop(1, 'rgba(0,0,0,0.46)')
      g.fillStyle = vig
      g.fillRect(0, 0, bw, bh)
    }

    /* ---------- 交互状态 ---------- */
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
    }
    let tiltX = 0
    let tiltY = 0
    let energy = 0
    let precPhase = 0
    let wellOn = false
    let wellStr = 0
    let wellR = 0
    let wellX = 0
    let wellY = 0
    let blastOn = false
    let blastX = 0
    let blastY = 0
    let evT = -1 // 眩晕事件剩余时间（-1 = 空闲）
    let nextEvent = 9 + Math.random() * 7
    let eyeX = -1
    let eyeY = -1
    let eyeFontStr = ''
    let eyeFontPx = 0

    /* 冲击环池 */
    const shOn = new Uint8Array(SHOCK_N)
    const shX = new Float32Array(SHOCK_N)
    const shY = new Float32Array(SHOCK_N)
    const shT0 = new Float32Array(SHOCK_N)
    const shMax = new Float32Array(SHOCK_N)
    let shHead = 0

    /* ---------- 性能监测（EMA 一次性降级） ---------- */
    let emaMs = 16.7
    let framesSeen = 0
    let degraded = false
    const degrade = (): void => {
      degraded = true
      for (let u = 0; u < GN; u++) {
        const dk = ringDepthK[gRing[u]]
        const h = hash1(u * 3.7 + 11)
        if (dk > 0.45) {
          if (h < 0.55) gSkip[u] = 1
        } else if (dk > 0.25) {
          if (h < 0.3) gSkip[u] = 1
        } else if (h < 0.04) {
          gSkip[u] = 1
        }
      }
    }

    /* ---------- 音频（首次手势懒创建，全部经 master/muted） ---------- */
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let pinkBuf: AudioBuffer | null = null
    let whirlGain: GainNode | null = null
    let panner: StereoPannerNode | null = null
    let humOscA: OscillatorNode | null = null
    let humOscB: OscillatorNode | null = null
    let wellGain: GainNode | null = null
    let humFreq = 48
    let wellAudioG = 0

    const initAudio = (): void => {
      if (ac || disposed || !running) return
      try {
        const ctxA = new AudioContext()
        ac = ctxA
        master = ctxA.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(ctxA.destination)
        // 粉噪循环缓冲（2s，Paul Kellet 近似）
        const len = Math.floor(ctxA.sampleRate * 2)
        const buf = ctxA.createBuffer(1, len, ctxA.sampleRate)
        const ch = buf.getChannelData(0)
        let b0 = 0
        let b1 = 0
        let b2 = 0
        let b3 = 0
        let b4 = 0
        let b5 = 0
        let b6 = 0
        for (let i = 0; i < len; i++) {
          const wn = Math.random() * 2 - 1
          b0 = 0.99886 * b0 + wn * 0.0555179
          b1 = 0.99332 * b1 + wn * 0.0750759
          b2 = 0.969 * b2 + wn * 0.153852
          b3 = 0.8665 * b3 + wn * 0.3104856
          b4 = 0.55 * b4 + wn * 0.5329522
          b5 = -0.7616 * b5 - wn * 0.016898
          const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + wn * 0.5362
          b6 = wn * 0.115926
          ch[i] = out * 0.11
        }
        pinkBuf = buf
        // 旋转呼啸：粉噪 → 带通 → 声像（随主环旋转左右摆动）
        whirlGain = ctxA.createGain()
        whirlGain.gain.value = 0.05
        const ws = ctxA.createBufferSource()
        ws.buffer = buf
        ws.loop = true
        const bp = ctxA.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 340
        bp.Q.value = 0.85
        ws.connect(bp)
        bp.connect(whirlGain)
        if (typeof ctxA.createStereoPanner === 'function') {
          panner = ctxA.createStereoPanner()
          whirlGain.connect(panner)
          panner.connect(master)
        } else {
          whirlGain.connect(master)
        }
        ws.start()
        // 48Hz 深嗡鸣（双失谐拍频；眩晕事件 ±12% pitch bend）
        humOscA = ctxA.createOscillator()
        humOscA.type = 'sine'
        humOscA.frequency.value = 48
        const ha = ctxA.createGain()
        ha.gain.value = 0.05
        humOscA.connect(ha)
        ha.connect(master)
        humOscA.start()
        humOscB = ctxA.createOscillator()
        humOscB.type = 'sine'
        humOscB.frequency.value = 48.7
        const hb = ctxA.createGain()
        hb.gain.value = 0.028
        humOscB.connect(hb)
        hb.connect(master)
        humOscB.start()
        // 引力井吸噬（低通噪声，井激活时抬升）
        wellGain = ctxA.createGain()
        wellGain.gain.value = 0
        const ws2 = ctxA.createBufferSource()
        ws2.buffer = buf
        ws2.loop = true
        const lp2 = ctxA.createBiquadFilter()
        lp2.type = 'lowpass'
        lp2.frequency.value = 260
        ws2.connect(lp2)
        lp2.connect(wellGain)
        wellGain.connect(master)
        ws2.start()
      } catch {
        ac = null
      }
    }

    /** 轰爆：噪声爆 + 次重击（heavy=点击冲击波；轻=引力井松手回弹） */
    const boom = (heavy: boolean): void => {
      if (!ac || !master || muted) return
      const n = ac.currentTime
      if (pinkBuf) {
        const src = ac.createBufferSource()
        src.buffer = pinkBuf
        const lp = ac.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(heavy ? 1600 : 900, n)
        lp.frequency.exponentialRampToValueAtTime(140, n + 0.3)
        const g = ac.createGain()
        g.gain.setValueAtTime(heavy ? 0.5 : 0.2, n)
        g.gain.exponentialRampToValueAtTime(0.001, n + (heavy ? 0.36 : 0.22))
        src.connect(lp)
        lp.connect(g)
        g.connect(master)
        src.start(n, Math.random() * 1.4)
        src.stop(n + 0.4)
      }
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(heavy ? 96 : 70, n)
      o.frequency.exponentialRampToValueAtTime(34, n + 0.2)
      const og = ac.createGain()
      og.gain.setValueAtTime(heavy ? 0.42 : 0.15, n)
      og.gain.exponentialRampToValueAtTime(0.001, n + (heavy ? 0.3 : 0.2))
      o.connect(og)
      og.connect(master)
      o.start(n)
      o.stop(n + 0.32)
    }

    /* ---------- 主帧：模拟 + 渲染（dt=0 为冻结态重绘一帧） ---------- */
    const drawFrame = (dt: number): void => {
      if (W < 40 || H < 40 || GN === 0) return
      simT += dt
      introT += dt

      /* —— 涡轴倾斜（eased 慢跟随；无指针时自主轻摆） —— */
      const tgtX = ptr.has ? (ptr.x / W) * 2 - 1 : Math.sin(simT * 0.11) * 0.35
      const tgtY = ptr.has ? (ptr.y / H) * 2 - 1 : Math.sin(simT * 0.07 + 2) * 0.3
      const te = 1 - Math.exp(-dt * 2.1)
      tiltX += (tgtX - tiltX) * te
      tiltY += (tgtY - tiltY) * te
      const axX = Math.sin(tiltX * TILT_MAX) * S * 0.5
      const axY = Math.sin(tiltY * TILT_MAX) * S * 0.42

      /* —— 能量摩擦衰减 —— */
      energy *= Math.exp(-dt * 0.5)

      /* —— 进动 —— */
      precPhase += SWIRL_PREC * dt
      const frameRot = 0.1 * Math.sin(precPhase)
      const swirlAdd = precPhase * 0.12
      const cosp = Math.cos(frameRot)
      const sinp = Math.sin(frameRot)

      /* —— 眩晕事件 —— */
      let evEnv = 0
      let barrelMod = 1
      let speedMod = 1
      let humBend = 1
      if (evT >= 0) {
        evT -= dt
        const prog = clamp01(1 - Math.max(0, evT) / 1.8)
        evEnv = Math.sin(Math.PI * prog)
        const s1 = Math.sin(prog * Math.PI * 3)
        const s2 = Math.sin(prog * Math.PI * 2)
        barrelMod = 1 + 0.075 * s1 * evEnv
        speedMod = 1 + 0.45 * s2 * evEnv
        humBend = 1 + 0.12 * s2 * evEnv
        if (evT <= 0) {
          evT = -1
          nextEvent = 9 + Math.random() * 7
        }
      } else if (dt > 0) {
        nextEvent -= dt
        if (nextEvent <= 0) evT = 1.8
      }

      /* —— 引力井 —— */
      if (ptr.down && !wellOn && simT - ptr.downT > WELL_DELAY) {
        wellOn = true
        wellX = ptr.x
        wellY = ptr.y
      }
      if (wellOn) {
        if (ptr.down) {
          wellX = ptr.x
          wellY = ptr.y
          const holdT = simT - ptr.downT
          wellR = Math.min(W * WELL_RMAX, S * 0.12 + holdT * W * WELL_GROW)
          if (wellStr < 1) wellStr = Math.min(1, wellStr + dt * 4)
        } else {
          wellOn = false
        }
      } else if (wellStr > 0) {
        wellStr *= Math.exp(-dt * 10)
        if (wellStr < 0.02) wellStr = 0
      }

      /* —— 开卷渐入 —— */
      const introEase = clamp01(introT / 1.4)
      const introFade = introEase * introEase * (3 - 2 * introEase)
      const introGrow = 0.92 + 0.08 * introFade

      /* —— 环推进 —— */
      const speedMult = (1 + energy * 1.4) * speedMod
      for (let i = 0; i < RING_N; i++) ringRot[i] += ringOmega[i] * speedMult * dt
      const glowDecay = Math.exp(-dt * 3.2)
      const pullDecay = Math.exp(-dt * 6)

      /* ================= 渲染 ================= */
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
      ctx.drawImage(bgCv, 0, 0)

      /* —— 涡心之瞳（最深处，压在全部字环之下） —— */
      const tipX = halfW + axX
      const tipY = halfH + axY
      const lookK = wellOn ? 0.42 : 0.12
      const exT = ptr.has ? tipX + (ptr.x - tipX) * lookK : tipX
      const eyT = ptr.has ? tipY + (ptr.y - tipY) * lookK : tipY
      if (eyeX < 0) {
        eyeX = tipX
        eyeY = tipY
      }
      const ee = 1 - Math.exp(-dt * 1.1)
      eyeX += (exT - eyeX) * ee
      eyeY += (eyT - eyeY) * ee
      const pulse = Math.sin(simT * 6.9)
      const eyeSize = Math.round(S * 0.05 * (1 + 0.14 * pulse) * 2) / 2
      if (eyeSize !== eyeFontPx) {
        eyeFontPx = eyeSize
        eyeFontStr = `900 ${eyeSize}px ${displayFont}`
      }
      ctx.font = eyeFontStr
      ctx.fillStyle = BONE
      ctx.globalAlpha = (0.55 + 0.3 * Math.sin(simT * 6.9 + 1.3)) * introFade
      ctx.fillText(EYE_CHAR, eyeX, eyeY)
      ctx.strokeStyle = ACID
      ctx.lineWidth = 1
      ctx.globalAlpha = (0.22 + 0.12 * Math.sin(simT * 6.9 + 2.1)) * introFade
      ctx.setLineDash(EYE_DASH)
      ctx.lineDashOffset = simT * 22
      ctx.beginPath()
      ctx.arc(eyeX, eyeY, eyeSize * 1.15, 0, TAU)
      ctx.stroke()
      ctx.setLineDash(EMPTY_DASH)
      ctx.lineDashOffset = 0

      /* —— 字环（远 → 近，单遍融合模拟与绘制） —— */
      const blastRad = S * BLAST_RK
      const bOn = blastOn
      const bx0 = blastX
      const by0 = blastY
      for (let i = 0; i < RING_N; i++) {
        const sc = ringScale[i]
        const breath = 1 + 0.03 * Math.sin(simT * 0.7 + ringBreath[i])
        const effR = ringRw[i] * breath * barrelMod * introGrow
        const cX = halfW + axX * ringDepthK[i]
        const cY = halfH + axY * ringDepthK[i]
        const rot = ringRot[i] + swirlAdd
        const fog = ringFog[i] * introFade
        const sizeW = ringSizeW[i]
        const near = ringDepthK[i] < 0.32
        const start = ringStart[i]
        const end = start + ringCount[i]
        for (let u = start; u < end; u++) {
          if (gSkip[u] !== 0) continue
          const th = gAng[u] + rot
          const cT = Math.cos(th)
          const sT = Math.sin(th)
          const ex = effR * sc * cT
          const ey = effR * sc * ELLIPSE_Y * sT
          const hx = cX + ex * cosp - ey * sinp
          const hy = cY + ex * sinp + ey * cosp

          /* —— 动力学：回位弹簧 + 引力井 + 冲击波 —— */
          let ox = gOx[u]
          let oy = gOy[u]
          let vx = gVx[u]
          let vy = gVy[u]
          let kk = SPRING_K
          let cc = SPRING_C
          let pull = 0
          if (wellOn) {
            const gx = wellX - (hx + ox)
            const gy = wellY - (hy + oy)
            const dd = Math.sqrt(gx * gx + gy * gy)
            if (dd < wellR && dd > 0.5) {
              const q = (1 - dd / wellR) * wellStr
              pull = q
              const g = WELL_PULL * q * dt
              vx += gx * g
              vy += gy * g
              kk = SPRING_K * (1 - 0.82 * q)
              cc = SPRING_C * (1 - 0.55 * q)
              if (dd < 52) {
                const dk = Math.exp(-dt * 5.5)
                vx *= dk
                vy *= dk
              }
            }
          }
          if (bOn) {
            const bx = hx + ox - bx0
            const by = hy + oy - by0
            const bd = Math.sqrt(bx * bx + by * by)
            if (bd < blastRad && bd > 0.5) {
              const f = (1 - bd / blastRad) * BLAST_V * (0.6 + hash1(u) * 0.8)
              const inv = f / bd
              vx += bx * inv
              vy += by * inv
              gGlow[u] = 1
            }
          }
          vx += (-kk * ox - cc * vx) * dt
          vy += (-kk * oy - cc * vy) * dt
          ox += vx * dt
          oy += vy * dt
          gOx[u] = ox
          gOy[u] = oy
          gVx[u] = vx
          gVy[u] = vy
          const gl = gGlow[u] * glowDecay
          gGlow[u] = gl
          const pq = pull > gPull[u] ? pull : gPull[u] * pullDecay
          gPull[u] = pq

          /* —— 绘制：选档 → 变换 → drawImage —— */
          const size = sizeW * gSizeK[u] * sc
          let t = 2
          if (size > 52) t = 0
          else if (size > 32) t = 1
          const cw = tierCW[t]
          const chh = tierCH[t]
          const m = (size / tierFont[t]) * dpr
          let phi = Math.atan2(ELLIPSE_Y * cT, -sT) + frameRot
          let a: number
          let b: number
          let c2: number
          let d2: number
          if (pq > 0.02) {
            // 引力井拉伸：字形转向并沿拉伸方向 scaleY ×1.4 拉长
            const pa = Math.atan2(wellY - hy, wellX - hx) - Math.PI * 0.5
            let dAng = pa - phi
            dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng))
            phi += dAng * pq
            const ms = m * (1 + 0.4 * pq)
            const cp = Math.cos(phi)
            const sp = Math.sin(phi)
            a = m * cp
            b = m * sp
            c2 = -ms * sp
            d2 = ms * cp
          } else {
            const cp = Math.cos(phi)
            const sp = Math.sin(phi)
            a = m * cp
            b = m * sp
            c2 = -m * sp
            d2 = m * cp
          }
          const e = (hx + ox) * dpr
          const f = (hy + oy) * dpr
          const ci = gChar[u]
          const col = ci % ATLAS_COLS
          const row = (ci / ATLAS_COLS) | 0
          const sx = col * cw
          const sy = tierRowY[t] + row * chh
          const ink = atlasCv[gCol[u]]
          const baseA = fog * gJitA[u]
          if (gl > 0.03) {
            // 品红/青分离残影（冲击波后短暂色差）
            ctx.globalAlpha = baseA * 0.42 * gl
            ctx.setTransform(a, b, c2, d2, e - 2.4 * gl * dpr, f)
            ctx.drawImage(atlasCv[2], sx, sy, cw, chh, -cw * 0.5, -chh * 0.5, cw, chh)
            ctx.setTransform(a, b, c2, d2, e + 2.4 * gl * dpr, f)
            ctx.drawImage(atlasCv[3], sx, sy, cw, chh, -cw * 0.5, -chh * 0.5, cw, chh)
          }
          ctx.globalAlpha = baseA
          ctx.setTransform(a, b, c2, d2, e, f)
          ctx.drawImage(ink, sx, sy, cw, chh, -cw * 0.5, -chh * 0.5, cw, chh)
          if (near && !degraded) {
            // 近环重影双曝光（眩晕复视）
            ctx.globalAlpha = baseA * 0.3
            ctx.setTransform(a, b, c2, d2, e + 1.7 * dpr, f + 1.1 * dpr)
            ctx.drawImage(ink, sx, sy, cw, chh, -cw * 0.5, -chh * 0.5, cw, chh)
          }
        }
      }
      blastOn = false
      ctx.globalAlpha = 1

      /* —— 冲击环（屏幕空间） —— */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (let k = 0; k < SHOCK_N; k++) {
        if (shOn[k] === 0) continue
        const p = (simT - shT0[k]) / SHOCK_DUR
        if (p >= 1) {
          shOn[k] = 0
          continue
        }
        const ep = 1 - Math.pow(1 - p, 3)
        const r = shMax[k] * ep
        const al = Math.pow(1 - p, 1.7)
        ctx.globalAlpha = al * 0.9
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2 + 9 * (1 - p)
        ctx.beginPath()
        ctx.arc(shX[k], shY[k], r, 0, TAU)
        ctx.stroke()
        ctx.globalAlpha = al * 0.35
        ctx.strokeStyle = ACID
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(shX[k], shY[k], r * 0.92, 0, TAU)
        ctx.stroke()
      }

      /* —— 引力井示意环（淡虚线，井界可辨） —— */
      if (wellOn || wellStr > 0.02) {
        const wa = wellOn ? 0.16 + 0.07 * Math.sin(simT * 7) : 0.16 * wellStr
        ctx.strokeStyle = ACID
        ctx.lineWidth = 1.25
        ctx.globalAlpha = wa
        ctx.setLineDash(WELL_DASH)
        ctx.lineDashOffset = -simT * 30
        ctx.beginPath()
        ctx.arc(wellX, wellY, Math.max(2, wellR), 0, TAU)
        ctx.stroke()
        ctx.globalAlpha = wa * 0.6
        ctx.beginPath()
        ctx.arc(wellX, wellY, Math.max(1, wellR * 0.4), 0, TAU)
        ctx.stroke()
        ctx.setLineDash(EMPTY_DASH)
        ctx.lineDashOffset = 0
      }
      ctx.globalAlpha = 1

      /* —— 音频参数随动 —— */
      if (ac && !muted && whirlGain && humOscA && humOscB && wellGain) {
        if (panner) panner.pan.value = Math.sin(ringRot[MID_RING])
        whirlGain.gain.value = 0.05 + energy * 0.1 + evEnv * 0.06
        const humTarget = 48 * humBend
        humFreq += (humTarget - humFreq) * (1 - Math.exp(-dt * 6))
        humOscA.frequency.value = humFreq
        humOscB.frequency.value = humFreq * 1.014
        const wTarget = wellOn ? 0.035 + wellStr * 0.11 : 0
        wellAudioG += (wTarget - wellAudioG) * (1 - Math.exp(-dt * 8))
        wellGain.gain.value = wellAudioG
      }
    }

    /* ---------- 尺寸自适应 ---------- */
    const resize = (): void => {
      const cw = root.clientWidth
      const chh = root.clientHeight
      if (cw < 40 || chh < 40) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = cw
      H = chh
      S = Math.min(W, H)
      halfW = W * 0.5
      halfH = H * 0.5
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.imageSmoothingQuality = 'high'
      const tMax = RING_N - 1
      for (let i = 0; i < RING_N; i++) {
        const tr = i / tMax
        const z = DEPTH_MAX * (1 - tr)
        const sc = PERSP / (PERSP + z)
        const fr = RP_IN + (RP_OUT - RP_IN) * tr
        ringScale[i] = sc
        ringRw[i] = (S * fr) / sc
        ringDepthK[i] = 1 - tr
        ringOmega[i] = (i % 2 === 0 ? 1 : -1) * (0.15 / fr)
        const dk = 1 - tr
        ringFog[i] = 0.92 - 0.82 * Math.pow(dk, 0.9)
        ringSizeW[i] = S * (0.019 + 0.033 * Math.pow(tr, 0.85)) / sc
      }
      buildBg()
      if (GN === 0) populate()
      ensureAtlas()
      if (!running) drawFrame(0)
    }

    /* ---------- 指针 ---------- */
    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      if (ptr.has && W > 0) {
        const ddtRaw = (e.timeStamp - ptr.tMs) / 1000
        const ddt = ddtRaw > 0.004 && ddtRaw < 0.25 ? ddtRaw : 0.016
        const dx = px - ptr.x
        const dy = py - ptr.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 0.5) {
          // 指针速度注入旋转能量
          const speed = dist / ddt
          energy = Math.min(1, energy + Math.min(speed, 2600) * ddt * 0.0011)
        }
      }
      ptr.x = px
      ptr.y = py
      ptr.tMs = e.timeStamp
      ptr.has = true
      if (ptr.down) {
        const mv = Math.sqrt((px - ptr.downX) * (px - ptr.downX) + (py - ptr.downY) * (py - ptr.downY))
        if (mv > ptr.moved) ptr.moved = mv
      }
    }

    const onPointerDown = (e: PointerEvent): void => {
      initAudio()
      const rect = canvas.getBoundingClientRect()
      ptr.x = e.clientX - rect.left
      ptr.y = e.clientY - rect.top
      ptr.tMs = e.timeStamp
      ptr.has = true
      ptr.down = true
      ptr.downX = ptr.x
      ptr.downY = ptr.y
      ptr.downT = simT
      ptr.moved = 0
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    }

    const onPointerUp = (): void => {
      if (!ptr.down) return
      ptr.down = false
      if (wellOn) {
        // 松手：弹簧回位带 wobble + 闷响
        wellOn = false
        boom(false)
        return
      }
      const dur = simT - ptr.downT
      if (dur < 0.3 && ptr.moved < 10 && W > 0) {
        // 冲击波
        blastX = ptr.downX
        blastY = ptr.downY
        blastOn = true
        const k = shHead
        shHead = (shHead + 1) % SHOCK_N
        shOn[k] = 1
        shX[k] = ptr.downX
        shY[k] = ptr.downY
        shT0[k] = simT
        shMax[k] = S * 0.5
        boom(true)
      }
    }

    const onPointerCancel = (): void => {
      ptr.down = false
      wellOn = false
    }

    const onPointerLeave = (): void => {
      ptr.has = false
    }

    const onContextMenu = (e: Event): void => {
      e.preventDefault() // 长按引力井时屏蔽移动端右键菜单
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

    // 字体晚载兜底：fonts.ready 后重建图集（否则首帧烘焙可能落在回退字体上）
    try {
      void document.fonts.ready.then(() => {
        if (disposed) return
        buildAtlas()
        if (!running) drawFrame(0)
      })
    } catch {
      /* 无 fonts API 时保持既有图集 */
    }

    /* ---------- 启停 ---------- */
    const frame = (now: number): void => {
      if (!running) return
      raf = requestAnimationFrame(frame)
      const ms = now - last
      last = now
      const dt = Math.min(0.05, Math.max(0.001, ms / 1000))
      if (framesSeen < 60) framesSeen++
      if (framesSeen > 45) {
        emaMs = emaMs * 0.9 + ms * 0.1
        if (!degraded && emaMs > 40) degrade()
      }
      drawFrame(dt)
    }

    const start = (): void => {
      if (disposed || running) return
      running = true
      last = performance.now()
      if (ac && ac.state === 'suspended') void ac.resume()
      raf = requestAnimationFrame(frame)
    }
    const stop = (): void => {
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
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: BG }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />

      {/* 左上铭牌（等宽小字 · 酸黄） */}
      <div
        className="font-attitude pointer-events-none absolute z-10"
        style={{
          left: '13%',
          top: '7.5%',
          fontSize: 'clamp(8px, 1.5cqw, 11px)',
          letterSpacing: '0.3em',
          color: 'rgba(242,255,31,0.55)',
          whiteSpace: 'nowrap',
        }}
      >
        VERTIGO · 眩晕文字 — TYPO VORTEX
      </div>

      {/* 右上竖排署名（避开右缘 10% 翻页热区与角部页码徽章） */}
      <div
        className="pointer-events-none absolute z-10 flex flex-col items-center"
        style={{ right: '12.5%', top: '7.5%', gap: '1.2cqh' }}
      >
        <div
          className="font-cn select-none"
          style={{
            writingMode: 'vertical-rl',
            fontSize: 'clamp(18px, 3.2cqw, 30px)',
            fontWeight: 600,
            letterSpacing: '0.3em',
            color: 'rgba(242,255,31,0.8)',
            lineHeight: 1,
          }}
        >
          眩晕文字
        </div>
        <div
          className="font-attitude select-none"
          style={{
            writingMode: 'vertical-rl',
            fontSize: 'clamp(8px, 1.4cqw, 11px)',
            letterSpacing: '0.5em',
            color: 'rgba(242,255,31,0.45)',
            lineHeight: 1,
          }}
        >
          VERTIGO
        </div>
      </div>

      {/* 底部居中提示（安全区） */}
      <div
        className="font-cn pointer-events-none absolute inset-x-0 z-10 text-center"
        style={{
          bottom: '3.5%',
          fontSize: 'clamp(7px, 1.3cqw, 10px)',
          letterSpacing: '0.4em',
          color: 'rgba(242,255,31,0.38)',
          whiteSpace: 'nowrap',
        }}
      >
        移动 · 潜入字涡 — 点击 · 冲击波 — 按住 · 引力井
      </div>
    </div>
  )
}
