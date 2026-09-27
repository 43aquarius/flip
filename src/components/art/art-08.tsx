'use client'

/**
 * ROOM 08 · THE WELL 井 — 深井回廊
 * 伪 3D 欧普隧道（scale = K/z）：28 环几何级深度分布，由远及近扑来。
 * 环形按槽位轮换形态：方 → 三角 → 六边 → 圆（循环），描边随深度螺旋扭转；
 * 色彩三步节奏（桃红 / 白 / 暗桃红），每第 7 环为琥珀"地标环"（加粗）；
 * 远处 z>4 追加深度雾。井壁 10 根辐条（暗桃红 12%）反向缓旋。
 * 井心之瞳：虚线虹膜 + 随坠速扩张的瞳孔（3→9px），每 6–11s 眨眼一次
 * （瞳孔压扁至 0.08、眼睑线浮现，坠速屏息趋零再恢复）。
 * 交互：移动 = 驾驭井道（X→转速方向，Y→坠速，消失点缓动跟随）；
 * 按住 = 疾坠（坠速 ×3.2 渐进、投影拉伸 +25%、14 条白色疾坠光线、画面微震）；
 * 轻点（<260ms 且位移 <10px）= 冲击波：白环自中心扩张，
 * 波前扫过之处每环弹跳（弹簧过冲 ~1.06）并提亮 150ms。
 * 声音（Web Audio）：55Hz+55.5Hz 拍频低鸣（音高随坠速攀升）、
 * 疾坠滤波噪声涌、轻点下行方波 blip、眨眼时低鸣屏息。
 * 调色：纯黑 × 桃红 #ff2e88 × 白 × 琥珀 #ff9f1c。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const PINK = '#ff2e88'
const AMBER = '#ff9f1c'
const TAU = Math.PI * 2

/** 槽位形态轮换：方 → 三角 → 六边 → 圆（<3 视为圆） */
const SHAPE_SIDES = [4, 3, 6, 0]

interface Ring {
  z: number
  pop: number // 弹跳位移（弹簧积分）
  popV: number
  flash: number // 提亮剩余秒数
}

interface Streak {
  ang: number
  r: number
  len: number
  v: number
  life: number
  maxLife: number
}

interface Wave {
  t: number
  z: number // 波前深度（向远处推进）
  hit: Set<Ring>
}

interface EngineCtrl {
  start(): void
  stop(): void
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/* ============================================================ */

export default function Art08({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctrlRef = useRef<EngineCtrl | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ctx: CanvasRenderingContext2D = context

    /* -------- 几何（几何级深度分布：相邻环投影尺寸恒定比值） -------- */
    const N = 28
    const Z_MIN = 0.33
    const Z_MAX = 6.0
    const RATIO = Math.pow(Z_MAX / Z_MIN, 1 / (N - 1))
    const GROW = Z_MAX / Z_MIN
    const FOG_Z = 4.0
    const BLINK_DUR = 0.26
    const TAP_MS = 260
    const TAP_MOVE = 10

    let W = 0
    let H = 0
    let K = 0
    let running = false
    let disposed = false
    let raf = 0
    let last = 0
    let simT = 0

    // 环：数组序 = 由近及远；回收时最近环 ×GROW 挪到最远端
    const rings: Ring[] = []
    for (let i = 0; i < N; i++) rings.push({ z: Z_MIN * Math.pow(RATIO, i), pop: 0, popV: 0, flash: 0 })

    // 消失点（缓动跟随指针）
    const vp = { x: 0, y: 0, tx: 0, ty: 0 }
    let px = 0
    let py = 0
    let hasPointer = false
    let pressed = false
    let downT = 0
    let downX = 0
    let downY = 0

    let fall = 0.4 // z 单位 / 秒
    let spinVel = 0.55
    let spinVelT = 0.55
    let spinTotal = 0
    let warp = 0 // 疾坠包络 0..1
    let breath = 1 // 眨眼屏息系数（1 = 正常呼吸）
    let blinkT = -1
    let blinkY = 1
    let nextBlink = 6 + Math.random() * 5
    let kick = 0 // 冲击波震屏冲量
    const waves: Wave[] = []
    const streaks: Streak[] = []
    let streakGap = 0

    /* -------- 音频（懒创建，首次 pointerdown 触发） -------- */
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let droneA: OscillatorNode | null = null
    let droneB: OscillatorNode | null = null
    let droneGain: GainNode | null = null
    let noiseGain: GainNode | null = null
    let audioBroken = false
    let audioTick = 0
    let muted = useBookStore.getState().muted

    function initAudio(): void {
      if (ac || audioBroken) return
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) {
          audioBroken = true
          return
        }
        const a = new Ctor()
        const m = a.createGain()
        m.gain.value = muted ? 0 : 1
        m.connect(a.destination)
        // 低鸣：55Hz + 55.5Hz 拍频（音高随坠速攀升）
        const dg = a.createGain()
        dg.gain.value = 0.0001
        dg.connect(m)
        const o1 = a.createOscillator()
        o1.type = 'sine'
        o1.frequency.value = 55
        const o2 = a.createOscillator()
        o2.type = 'sine'
        o2.frequency.value = 55.5
        o1.connect(dg)
        o2.connect(dg)
        o1.start()
        o2.start()
        // 疾坠：滤波白噪声涌（增益跟随疾坠包络）
        const nlen = Math.floor(a.sampleRate * 1.2)
        const nbuf = a.createBuffer(1, nlen, a.sampleRate)
        const nd = nbuf.getChannelData(0)
        for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1
        const nsrc = a.createBufferSource()
        nsrc.buffer = nbuf
        nsrc.loop = true
        const nfilt = a.createBiquadFilter()
        nfilt.type = 'lowpass'
        nfilt.frequency.value = 760
        nfilt.Q.value = 0.7
        const ng = a.createGain()
        ng.gain.value = 0
        nsrc.connect(nfilt)
        nfilt.connect(ng)
        ng.connect(m)
        nsrc.start()
        ac = a
        master = m
        droneA = o1
        droneB = o2
        droneGain = dg
        noiseGain = ng
      } catch {
        audioBroken = true
      }
    }

    function blip(): void {
      if (!ac || !master || muted) return
      const t0 = ac.currentTime + 0.001
      const o = ac.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(660, t0)
      o.frequency.exponentialRampToValueAtTime(160, t0 + 0.19)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.1, t0)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
      o.connect(g)
      g.connect(master)
      o.start(t0)
      o.stop(t0 + 0.24)
    }

    /* -------- 冲击波：波前扫过每环 → 弹跳 + 提亮 -------- */
    function shockwave(): void {
      if (waves.length < 4) waves.push({ t: 0, z: Z_MIN * 0.4, hit: new Set<Ring>() })
      kick += 1.4
      blip()
    }

    /* -------- 模拟 -------- */
    function update(dt: number): void {
      simT += dt

      // 眨眼调度（6–11s 一次；瞳孔压扁 → 回弹）
      if (blinkT < 0 && simT >= nextBlink) blinkT = 0
      if (blinkT >= 0) {
        blinkT += dt
        const p = clamp(blinkT / BLINK_DUR, 0, 1)
        blinkY = 0.08 + 0.92 * Math.abs(Math.cos(Math.PI * p))
        if (blinkT >= BLINK_DUR) {
          blinkT = -1
          blinkY = 1
          nextBlink = simT + 6 + Math.random() * 5
        }
      }
      const blinkDip = (1 - blinkY) / 0.92 // 0 睁眼 → 1 闭合

      // 屏息：眨眼时井"屏住呼吸"，坠速趋零再恢复
      const breathTarget = blinkDip > 0.25 ? 0.04 : 1
      const breathRate = blinkDip > 0.25 ? 14 : 3.2
      breath += (breathTarget - breath) * Math.min(1, dt * breathRate)

      // 疾坠包络
      warp += ((pressed ? 1 : 0) - warp) * Math.min(1, dt * 3.2)
      if (!pressed && warp < 0.002) warp = 0

      // 消失点 / 转速 / 坠速缓动
      const e1 = Math.min(1, dt * 3.4)
      vp.x += (vp.tx - vp.x) * e1
      vp.y += (vp.ty - vp.y) * e1
      const pyN = clamp(py / Math.max(1, H), 0, 1)
      const fallGoal = (0.15 + 0.72 * pyN) * (1 + warp * 2.2) * breath
      fall += (fallGoal - fall) * Math.min(1, dt * 2.6)
      spinVel += (spinVelT - spinVel) * Math.min(1, dt * 2.2)
      spinTotal += spinVel * dt

      // 环推进 + 回收
      for (const r of rings) r.z -= fall * dt
      let guard = 0
      while (rings.length > 0 && rings[0].z <= Z_MIN && guard < 8) {
        const r = rings.shift()
        if (!r) break
        const wneg = window as unknown as { __wellNeg0?: unknown }
        if (wneg && !wneg.__wellNeg0 && r.z <= 0) {
          wneg.__wellNeg0 = JSON.stringify({
            t: +simT.toFixed(2),
            z: +r.z.toFixed(4),
            fall: +fall.toFixed(3),
            rings: rings.map((q) => +q.z.toFixed(3)),
          })
        }
        r.z *= GROW
        rings.push(r)
        guard++
      }
      const word = window as unknown as { __wellOrder?: unknown }
      if (word && !word.__wellOrder) {
        for (let i = 1; i < rings.length; i++) {
          if (rings[i].z < rings[i - 1].z - 1e-9) {
            word.__wellOrder = JSON.stringify({
              t: +simT.toFixed(2),
              i,
              fall: +fall.toFixed(3),
              rings: rings.map((q) => +q.z.toFixed(3)),
            })
            break
          }
        }
      }

      // 每环弹簧（k=90, damp=10）与提亮衰减
      for (const r of rings) {
        if (r.pop !== 0 || r.popV !== 0) {
          r.popV += (-90 * r.pop - 10 * r.popV) * dt
          r.pop += r.popV * dt
          if (Math.abs(r.pop) < 1e-4 && Math.abs(r.popV) < 1e-4) {
            r.pop = 0
            r.popV = 0
          }
        }
        if (r.flash > 0) r.flash -= dt
      }

      // 冲击波推进（近 → 远依次扫过各环）
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i]
        w.t += dt
        w.z += 6.0 * dt
        for (const r of rings) {
          if (!w.hit.has(r) && r.z <= w.z) {
            w.hit.add(r)
            r.popV += 1.15 // 峰值过冲 ≈ 1.06
            r.flash = 0.15
          }
        }
        if (w.t > 1.15) waves.splice(i, 1)
      }

      // 疾坠光线（近中心生成、向外飞驰、生长并淡出）
      streakGap -= dt
      if (warp > 0.12 && streaks.length < 14 && streakGap <= 0) {
        const life = 0.45 + Math.random() * 0.35
        streaks.push({
          ang: Math.random() * TAU,
          r: 12 + Math.random() * 30,
          len: 10 + Math.random() * 16,
          v: 260 + Math.random() * 300,
          life,
          maxLife: life,
        })
        streakGap = 0.028
      }
      const diag = Math.hypot(W, H)
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i]
        s.r += s.v * (0.5 + warp * 0.9) * dt
        s.len += 130 * dt
        s.life -= dt
        if (s.life <= 0 || s.r > diag * 0.6) streaks.splice(i, 1)
      }

      kick *= Math.exp(-5.5 * dt)

      // 音频参数（节流）
      audioTick -= dt
      if (audioTick <= 0 && ac && master) {
        audioTick = 0.08
        const now = ac.currentTime
        const f = 55 + 26 * clamp(fall / 2.8, 0, 1)
        if (droneA && droneB) {
          droneA.frequency.setTargetAtTime(f, now, 0.09)
          droneB.frequency.setTargetAtTime(f + 0.5, now, 0.09)
        }
        if (droneGain) droneGain.gain.setTargetAtTime(0.03 * (1 - 0.94 * blinkDip), now, 0.05)
        if (noiseGain) noiseGain.gain.setTargetAtTime(warp * 0.16, now, 0.09)
      }
    }

    /* -------- 绘制 -------- */
    function strokeShape(sides: number, cx: number, cy: number, s: number, a: number): void {
      if (sides < 3) {
        ctx.beginPath()
        ctx.arc(cx, cy, s, 0, TAU)
        ctx.stroke()
        return
      }
      ctx.beginPath()
      for (let k = 0; k < sides; k++) {
        const ang = a + (k * TAU) / sides
        const x = cx + s * Math.cos(ang)
        const y = cy + s * Math.sin(ang)
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
    }

    function draw(): void {
      if (W === 0) return
      const diag = Math.hypot(W, H)
      const kEff = K * (1 + 0.25 * warp) // 疾坠时投影拉伸

      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)

      // 震屏（疾坠持续 ±2px + 冲击波冲量，均衰减）
      const shake = warp * 2 + kick
      ctx.save()
      if (shake > 0.05) {
        ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake)
      }

      // 井壁辐条：10 根，反向缓旋（井壁接缝）
      const spokeRot = -spinTotal * 0.18 - simT * 0.025
      ctx.strokeStyle = 'rgba(255,46,136,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let j = 0; j < 10; j++) {
        const a = spokeRot + (j * TAU) / 10
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        ctx.moveTo(vp.x + dx * 24, vp.y + dy * 24)
        ctx.lineTo(vp.x + dx * diag, vp.y + dy * diag)
      }
      ctx.stroke()

      // 环：由远及近（数组反序）；形态/色彩按槽位节奏
      for (let i = N - 1; i >= 0; i--) {
        const r = rings[i]
        const z = r.z
        const s = (kEff / z) * (1 + r.pop)
        const twist = spinTotal * z + Math.sin(simT * 0.6 + z * 2.1) * 0.05
        const depth = 1 - z / Z_MAX

        // 色彩三步节奏：桃红（全）→ 白（0.85）→ 暗桃红（0.55）
        let cr = 255
        let cg = 46
        let cb = 136
        let baseA = 1
        const rhythm = i % 3
        if (rhythm === 1) {
          cg = 255
          cb = 255
          baseA = 0.85
        } else if (rhythm === 2) {
          baseA = 0.55
        }
        // 每第 7 环 = 琥珀地标环（加粗）
        const amber = i % 7 === 0
        if (amber) {
          cg = 159
          cb = 28
          baseA = 0.95
        }

        let alpha = baseA * (0.28 + 0.72 * Math.pow(depth, 1.5))
        if (z > FOG_Z) alpha *= Math.max(0, 1 - (z - FOG_Z) / 2.5) // 深度雾
        // 冲击波提亮：闪一档（150ms），并向白偏移
        const f = clamp(r.flash / 0.15, 0, 1)
        if (f > 0) {
          alpha = Math.min(1, alpha + 0.35 * f)
          const wmix = f * 0.55
          cr += (255 - cr) * wmix
          cg += (255 - cg) * wmix
          cb += (255 - cb) * wmix
        }
        ctx.strokeStyle = `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},${alpha.toFixed(3)})`
        ctx.lineWidth = clamp(s * 0.02, 0.8, 8) * (amber ? 1.55 : 1)
        strokeShape(SHAPE_SIDES[i % 4], vp.x, vp.y, s, twist)

        // 近环：白色色差重影（故障式抖动）
        if (z < 0.55) {
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'
          ctx.lineWidth = clamp(s * 0.006, 0.6, 3)
          const ox = (Math.random() - 0.5) * 4
          const oy = (Math.random() - 0.5) * 4
          strokeShape(SHAPE_SIDES[i % 4], vp.x + ox, vp.y + oy, s, twist)
        }
      }

      // 井心之瞳
      const irisR = 15
      const glow = ctx.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, 26)
      glow.addColorStop(0, `rgba(255,46,136,${(0.42 + 0.25 * warp).toFixed(3)})`)
      glow.addColorStop(1, 'rgba(255,46,136,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(vp.x, vp.y, 26, 0, TAU)
      ctx.fill()
      // 虹膜：放射状虚线环（缓旋）
      ctx.save()
      ctx.translate(vp.x, vp.y)
      ctx.rotate(simT * 0.35 + spinTotal * 0.4)
      ctx.strokeStyle = 'rgba(255,46,136,0.85)'
      ctx.lineWidth = 2
      ctx.setLineDash([2.6, 3.6])
      ctx.beginPath()
      ctx.arc(0, 0, irisR, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
      // 瞳孔：随坠速扩张（3→9px），眨眼时纵向压扁
      const pupilR = 3 + 6 * clamp(fall / 2.8, 0, 1)
      ctx.save()
      ctx.translate(vp.x, vp.y)
      ctx.scale(1, Math.max(0.08, blinkY))
      ctx.fillStyle = PINK
      ctx.beginPath()
      ctx.arc(0, 0, pupilR, 0, TAU)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.beginPath()
      ctx.arc(0, 0, Math.max(0.7, pupilR * 0.34), 0, TAU)
      ctx.fill()
      ctx.restore()
      // 眼睑线（眨眼时浮现）
      const lidA = (1 - blinkY) / 0.92
      if (lidA > 0.03) {
        ctx.strokeStyle = `rgba(255,255,255,${(0.65 * lidA).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(vp.x - irisR * 1.35, vp.y)
        ctx.lineTo(vp.x + irisR * 1.35, vp.y)
        ctx.stroke()
      }

      // 疾坠光线：白色放射细线，由中心向外飞驰
      if (streaks.length > 0) {
        ctx.lineCap = 'round'
        for (const s of streaks) {
          const a = clamp(s.life / s.maxLife, 0, 1) * 0.8 * Math.min(1, warp * 1.8)
          if (a <= 0.01) continue
          const ca = Math.cos(s.ang)
          const sa = Math.sin(s.ang)
          ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
          ctx.lineWidth = 1.3
          ctx.beginPath()
          ctx.moveTo(vp.x + ca * s.r, vp.y + sa * s.r)
          ctx.lineTo(vp.x + ca * (s.r + s.len), vp.y + sa * (s.r + s.len))
          ctx.stroke()
        }
        ctx.lineCap = 'butt'
      }

      // 冲击波：白环自中心扩张、淡出（+ 桃红回声环）
      for (const w of waves) {
        const p = clamp(w.t / 0.9, 0, 1)
        if (p >= 1) continue
        const ease = 1 - Math.pow(1 - p, 3)
        const R = 14 + (diag * 0.55 - 14) * ease
        const a = 0.85 * (1 - p)
        ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
        ctx.lineWidth = 2.6 - 1.7 * p
        ctx.beginPath()
        ctx.arc(vp.x, vp.y, R, 0, TAU)
        ctx.stroke()
        if (p > 0.12) {
          ctx.strokeStyle = `rgba(255,46,136,${(a * 0.35).toFixed(3)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(vp.x, vp.y, R * 0.8, 0, TAU)
          ctx.stroke()
        }
      }

      ctx.restore()
    }

    /* -------- 尺寸 -------- */
    const resize = (): void => {
      const w = Math.max(1, root.clientWidth)
      const h = Math.max(1, root.clientHeight)
      if (w === W && h === H) return
      W = w
      H = h
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      K = 0.19 * Math.hypot(W, H)
      if (!hasPointer) {
        px = W / 2
        py = H * 0.45
        vp.x = W / 2
        vp.y = H / 2
        vp.tx = px
        vp.ty = py
      }
    }
    /* -------- 输入 -------- */
    const onMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      px = e.clientX - rect.left
      py = e.clientY - rect.top
      hasPointer = true
      vp.tx = px
      vp.ty = py
      spinVelT = (px / Math.max(1, W) - 0.5) * 2.6 // 左 → 逆时针，右 → 顺时针
    }

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      initAudio()
      onMove(e)
      pressed = true
      downT = performance.now()
      downX = e.clientX
      downY = e.clientY
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* 忽略 */
      }
    }

    function onUp(e: PointerEvent): void {
      const dur = performance.now() - downT
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
      pressed = false
      // 轻点（与按住疾坠以时长区分）→ 冲击波
      if (dur < TAP_MS && moved < TAP_MOVE) shockwave()
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.05)
    })

    /* -------- 主循环 -------- */
    function frame(now: number): void {
      if (!running || disposed) return
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      if (dt <= 0) dt = 1 / 120
      try {
        update(dt)
      } catch (err) {
        const w = window as unknown as { __wellDbgErr?: string[] }
        ;(w.__wellDbgErr ||= []).push('update: ' + String(err))
      }
      try {
        draw()
      } catch (err) {
        const w = window as unknown as { __wellDbgErr?: string[] }
        ;(w.__wellDbgErr ||= []).push(
          'draw: ' +
            String(err) +
            ' rings=' +
            JSON.stringify(rings.slice(0, 6).map((r) => [+r.z.toFixed(4), +r.pop.toFixed(4), +r.popV.toFixed(4)])) +
            ' waves=' +
            waves.length +
            ' streaks=' +
            streaks.length +
            ' vp=' +
            vp.x.toFixed(1) +
            ',' +
            vp.y.toFixed(1) +
            ' | ' +
            (err instanceof Error ? err.stack : ''),
        )
      }
      const w = window as unknown as { __wellDbg?: Record<string, unknown> }
      if (w) {
        w.__wellDbg = {
          t: simT,
          W,
          H,
          K,
          vp: { x: vp.x, y: vp.y, tx: vp.tx, ty: vp.ty },
          fall,
          warp,
          blinkT,
          blinkY,
          breath,
          spinTotal,
          pressed,
          ring0: rings[0] ? rings[0].z : -1,
          ringN: rings[rings.length - 1] ? rings[rings.length - 1].z : -1,
          streaks: streaks.length,
          waves: waves.length,
          running,
        }
      }
      raf = requestAnimationFrame(frame)
    }

    const ro = new ResizeObserver(() => {
      resize()
      if (!running) draw() // 冻结时也立即重绘一帧
    })
    ro.observe(root)
    resize()
    draw()

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
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      unsubMute()
      if (ac) {
        void ac.close().catch(() => undefined)
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
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#000000' }}
    >
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
        <div className="font-display" style={{ fontSize: 11, letterSpacing: '0.42em', color: PINK }}>
          THE WELL
        </div>
        <div
          className="font-cn"
          style={{ fontSize: 10, letterSpacing: '0.5em', color: 'rgba(255,46,136,0.55)', marginTop: 5 }}
        >
          井
        </div>
        <div
          className="font-attitude"
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            lineHeight: 1.9,
            color: 'rgba(255,46,136,0.38)',
            marginTop: 6,
            maxWidth: 200,
          }}
        >
          移动 · 驾驭井道 — 按住 · 疾坠 — 轻点 · 激起冲击波
        </div>
      </div>
      {/* 琥珀色点缀呼应（右下角房间编号） */}
      <div
        className="font-attitude pointer-events-none absolute z-10 select-none"
        style={{ right: '12%', top: '4.5%', fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,159,28,0.5)' }}
      >
        DEPTH 08
      </div>
    </div>
  )
}
