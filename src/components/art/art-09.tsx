'use client'

/**
 * ROOM 09 · SOUND POND 声之池
 * 声音的涟漪池塘：点击（或拖动划过）水面 = 落下一枚"声音石子"——
 * 霓虹绿同心圆环扩散，同时以 Web Audio 播一个五声音阶的音
 * （宫商角徵羽 C D E G A 跨两个八度，落点越靠上音越高）。
 * 音色 = 正弦 + 轻微三角泛音 + 指数衰减包络 + 柔和 feedback delay（池水回声）。
 * 空闲 6 秒后自动落一滴"雨"（仅在用户交互过之后）。
 * 全局静音时只播视觉不出声（useBookStore.muted）。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const POND = '#071009'
const NEON = '#57ff9a'
/** 五声音阶 ×2 八度：C D E G A / C D E G A */
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.26, 783.99, 880.0]

interface Ripple {
  x: number
  y: number
  t: number
  delay: number
  maxR: number
  dur: number
  gain: number // 视觉亮度系数
  flash: boolean // true = 落点闪光（小实心圆），false = 扩散圆环
}

interface Mote {
  x: number
  y: number
  r: number
  a: number
  ph: number
  sp: number
  vx: number
}

interface PondEngine {
  resize(): void
  render(t: number): void
  resume(): void
  pause(): void
  destroy(): void
  setMuted(m: boolean): void
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/* ============================================================ */

function createPondEngine(
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  hintEl: HTMLElement | null,
  mutedRef: { current: boolean },
): PondEngine {
  const context = canvas.getContext('2d')
  if (!context) {
    return { resize() {}, render() {}, resume() {}, pause() {}, destroy() {}, setMuted() {} }
  }
  const ctx: CanvasRenderingContext2D = context

  let W = 0
  let H = 0
  let running = false
  let raf = 0
  let last = 0
  let nowT = 0

  const ripples: Ripple[] = []
  const motes: Mote[] = []
  let glowSprite: HTMLCanvasElement | null = null
  let baseGrad: CanvasGradient | null = null

  // 交互 / 生命感状态
  let hasInteracted = false
  let hintFade = 1
  let hintDone = hintEl === null
  let nextRainAt = Infinity
  let lastDropX = -1e9
  let lastDropY = -1e9

  /* -------- 音频（懒创建，遵循自动播放策略） -------- */
  interface AudioRig {
    ctx: AudioContext
    master: GainNode
    send: GainNode
  }
  let audio: AudioRig | null = null
  let audioBroken = false
  let muted = mutedRef.current

  function ensureAudio(): void {
    if (audio || audioBroken) return
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) {
        audioBroken = true
        return
      }
      const ac = new Ctor()
      const master = ac.createGain()
      master.gain.value = muted ? 0 : 0.6
      // 柔和低通：水下的温润
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 2600
      lp.Q.value = 0.6
      master.connect(lp)
      lp.connect(ac.destination)
      // 池水回声：feedback delay
      const delay = ac.createDelay(1.0)
      delay.delayTime.value = 0.29
      const fb = ac.createGain()
      fb.gain.value = 0.34
      const wet = ac.createGain()
      wet.gain.value = 0.5
      delay.connect(fb)
      fb.connect(delay)
      delay.connect(wet)
      wet.connect(master)
      const send = ac.createGain()
      send.gain.value = 0.32
      send.connect(delay)
      audio = { ctx: ac, master, send }
    } catch {
      audioBroken = true
    }
  }

  function playNote(freq: number, dur: number, vol: number): void {
    if (!audio) return
    const { ctx: ac, master, send } = audio
    const t0 = ac.currentTime + 0.001
    const g = ac.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    const o1 = ac.createOscillator()
    o1.type = 'sine'
    o1.frequency.value = freq
    const o2 = ac.createOscillator()
    o2.type = 'triangle'
    o2.frequency.value = freq * 2 // 轻微三角泛音
    const g2 = ac.createGain()
    g2.gain.value = 0.09
    o1.connect(g)
    o2.connect(g2)
    g2.connect(g)
    g.connect(master)
    g.connect(send)
    o1.start(t0)
    o2.start(t0)
    o1.stop(t0 + dur + 0.1)
    o2.stop(t0 + dur + 0.1)
  }

  /* -------- 落石 -------- */
  function drop(x: number, y: number, rain: boolean): void {
    const t = nowT
    if (rain) {
      // 雨滴：单环 + 一圈迟来的微环
      ripples.push({ x, y, t, delay: 0, maxR: 62, dur: 1.35, gain: 0.55, flash: false })
      ripples.push({ x, y, t, delay: 0.22, maxR: 34, dur: 1.1, gain: 0.3, flash: false })
    } else {
      // 石子：三重同心环，错开延迟
      ripples.push({ x, y, t, delay: 0, maxR: 150 + Math.random() * 36, dur: 2.0, gain: 1, flash: false })
      ripples.push({ x, y, t, delay: 0.13, maxR: 116, dur: 1.75, gain: 0.8, flash: false })
      ripples.push({ x, y, t, delay: 0.26, maxR: 84, dur: 1.5, gain: 0.62, flash: false })
    }
    ripples.push({ x, y, t, delay: 0, maxR: 9, dur: 0.28, gain: 1, flash: true })
    if (ripples.length > 260) ripples.splice(0, ripples.length - 260)

    if (!muted) {
      ensureAudio()
      if (audio) {
        if (audio.ctx.state === 'suspended') void audio.ctx.resume()
        // 落点越靠上（Y 越低）音越高
        const idx = clamp(Math.floor((1 - y / Math.max(1, H)) * SCALE.length), 0, SCALE.length - 1)
        const vol = (rain ? 0.14 : 0.42) * (0.8 + Math.random() * 0.2)
        const dur = 1.3 + (1 - idx / (SCALE.length - 1)) * 1.0 // 低音余韵更长
        playNote(SCALE[idx], dur, vol)
      }
    }

    if (!rain) {
      hasInteracted = true
      nextRainAt = t + 6.5 + Math.random() * 3
      lastDropX = x
      lastDropY = y
    } else {
      nextRainAt = t + 4.5 + Math.random() * 3.5
    }
  }

  /* -------- 尺寸 -------- */
  function resize(): void {
    const w = Math.max(1, root.clientWidth)
    const h = Math.max(1, root.clientHeight)
    if (w === W && h === H) return
    W = w
    H = h
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 水底微光
    baseGrad = ctx.createRadialGradient(
      W / 2, H * 0.42, 0,
      W / 2, H * 0.42, Math.max(W, H) * 0.75,
    )
    baseGrad.addColorStop(0, '#0d2014')
    baseGrad.addColorStop(0.55, '#08140c')
    baseGrad.addColorStop(1, POND)

    // 悬浮微尘
    motes.length = 0
    for (let i = 0; i < 36; i++) {
      motes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.5 + Math.random() * 0.9,
        a: 0.03 + Math.random() * 0.09,
        ph: Math.random() * Math.PI * 2,
        sp: 0.3 + Math.random() * 1.2,
        vx: (Math.random() - 0.5) * 6,
      })
    }

    // 光斑精灵（离屏一次生成，避免每帧构造渐变）
    if (!glowSprite) {
      glowSprite = document.createElement('canvas')
      glowSprite.width = 128
      glowSprite.height = 128
      const gctx = glowSprite.getContext('2d')
      if (gctx) {
        const g = gctx.createRadialGradient(64, 64, 0, 64, 64, 64)
        g.addColorStop(0, 'rgba(87,255,154,1)')
        g.addColorStop(0.4, 'rgba(87,255,154,0.35)')
        g.addColorStop(1, 'rgba(87,255,154,0)')
        gctx.fillStyle = g
        gctx.fillRect(0, 0, 128, 128)
      }
    }
  }

  /* -------- 推进 -------- */
  function update(dt: number): void {
    for (const m of motes) {
      m.x += m.vx * dt
      if (m.x < -10) m.x = W + 10
      else if (m.x > W + 10) m.x = -10
    }
    // 空闲落雨
    if (hasInteracted && nowT >= nextRainAt) {
      drop(W * (0.15 + Math.random() * 0.7), H * (0.18 + Math.random() * 0.6), true)
    }
    // 提示语淡出
    if (hintEl && !hintDone) {
      if (hasInteracted) hintFade -= dt * 1.4
      if (hintFade <= 0) {
        hintFade = 0
        hintDone = true
        hintEl.style.display = 'none'
      }
    }
  }

  /* -------- 绘制 -------- */
  function render(t: number): void {
    if (W === 0) return
    ctx.fillStyle = POND
    ctx.fillRect(0, 0, W, H)
    if (baseGrad) {
      ctx.fillStyle = baseGrad
      ctx.fillRect(0, 0, W, H)
    }

    ctx.globalCompositeOperation = 'lighter'

    // 漂移光斑 ×3（水面微光）
    if (glowSprite) {
      const r1 = Math.min(W, H) * 0.42
      ctx.globalAlpha = 0.07
      ctx.drawImage(
        glowSprite,
        W * 0.5 + Math.sin(t * 0.05 + 1.0) * W * 0.26 - r1,
        H * 0.42 + Math.cos(t * 0.04) * H * 0.2 - r1,
        r1 * 2,
        r1 * 2,
      )
      const r2 = Math.min(W, H) * 0.34
      ctx.globalAlpha = 0.05
      ctx.drawImage(
        glowSprite,
        W * 0.5 + Math.sin(t * 0.037 + 3.2) * W * 0.3 - r2,
        H * 0.55 + Math.sin(t * 0.031 + 1.4) * H * 0.24 - r2,
        r2 * 2,
        r2 * 2,
      )
      const r3 = Math.min(W, H) * 0.26
      ctx.globalAlpha = 0.045
      ctx.drawImage(
        glowSprite,
        W * 0.5 + Math.cos(t * 0.045 + 0.6) * W * 0.22 - r3,
        H * 0.38 + Math.sin(t * 0.052 + 2.4) * H * 0.18 - r3,
        r3 * 2,
        r3 * 2,
      )
    }

    // 悬浮微尘
    ctx.fillStyle = NEON
    for (const m of motes) {
      ctx.globalAlpha = m.a * (0.5 + 0.5 * Math.sin(t * m.sp + m.ph))
      ctx.beginPath()
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
      ctx.fill()
    }

    // 涟漪（紧凑化：写指针覆盖过期项）
    let write = 0
    for (let k = 0; k < ripples.length; k++) {
      const r = ripples[k]
      const age = t - r.t - r.delay
      if (age > r.dur) continue
      if (age < 0) {
        ripples[write++] = r
        continue
      }
      const p = age / r.dur
      if (r.flash) {
        const a = (1 - p) * 0.8 * r.gain
        ctx.globalAlpha = a
        ctx.fillStyle = '#d9ffe8'
        ctx.beginPath()
        ctx.arc(r.x, r.y, 2 + p * 8, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const e = 1 - (1 - p) * (1 - p) // easeOutQuad
        const rad = 4 + (r.maxR - 4) * e
        const a = Math.pow(1 - p, 1.7) * 0.85 * r.gain
        const lw = 0.6 + 2.2 * (1 - p)
        // 宽柔光环 + 细亮芯线
        ctx.globalAlpha = a * 0.25
        ctx.strokeStyle = NEON
        ctx.lineWidth = lw * 2.8
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = a
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
        ctx.stroke()
      }
      ripples[write++] = r
    }
    ripples.length = write

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'

    // 呼吸提示语
    if (hintEl && !hintDone) {
      const breathe = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.2))
      hintEl.style.opacity = (breathe * hintFade).toFixed(3)
    }
  }

  /* -------- 输入 -------- */
  function toLocal(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    const { x, y } = toLocal(e)
    drop(x, y, false)
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* 忽略 */
    }
  }

  function onMove(e: PointerEvent): void {
    if ((e.buttons & 1) === 0 || !e.isPrimary) return
    const { x, y } = toLocal(e)
    // 拖动划过水面：间隔 ≥46px 落一颗石子（连成琶音）
    if (Math.hypot(x - lastDropX, y - lastDropY) >= 46) {
      drop(x, y, false)
    }
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)

  /* -------- 主循环 -------- */
  function loop(nowMs: number): void {
    if (!running) return
    raf = requestAnimationFrame(loop)
    const dt = Math.min((nowMs - last) / 1000, 0.05)
    last = nowMs
    nowT = nowMs / 1000
    update(dt)
    render(nowT)
  }

  function resume(): void {
    if (running) return
    running = true
    last = performance.now()
    raf = requestAnimationFrame(loop)
    if (audio && audio.ctx.state === 'suspended') void audio.ctx.resume()
  }

  function pause(): void {
    running = false
    cancelAnimationFrame(raf)
    if (audio && audio.ctx.state === 'running') void audio.ctx.suspend()
  }

  function setMuted(m: boolean): void {
    muted = m
    if (audio) {
      audio.master.gain.setTargetAtTime(m ? 0 : 0.6, audio.ctx.currentTime, 0.05)
    }
  }

  function destroy(): void {
    pause()
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    if (audio) {
      void audio.ctx.close().catch(() => undefined)
      audio = null
    }
  }

  return { resize, render, resume, pause, destroy, setMuted }
}

/* ============================================================ */

export default function Art09({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<PondEngine | null>(null)

  const muted = useBookStore((s) => s.muted)
  const mutedRef = useRef(muted)

  useEffect(() => {
    mutedRef.current = muted
    engineRef.current?.setMuted(muted)
  }, [muted])

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const engine = createPondEngine(canvas, root, hintRef.current, mutedRef)
    engineRef.current = engine
    engine.resize()
    engine.render(performance.now() / 1000)
    const ro = new ResizeObserver(() => {
      engine.resize()
      engine.render(performance.now() / 1000)
    })
    ro.observe(root)
    return () => {
      ro.disconnect()
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (active) engine.resume()
    else engine.pause()
  }, [active])

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: POND }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />
      {/* 首次交互前的居中提示（呼吸闪烁，交互后淡出） */}
      <div
        ref={hintRef}
        className="pointer-events-none absolute z-10 flex select-none flex-col items-center"
        style={{ left: '50%', top: '44%', transform: 'translate(-50%, -50%)', opacity: 0 }}
      >
        <div
          className="font-cn"
          style={{ fontSize: 15, letterSpacing: '0.62em', textIndent: '0.62em', color: NEON }}
        >
          触碰水面
        </div>
        <div
          className="font-attitude"
          style={{ fontSize: 9.5, letterSpacing: '0.34em', color: 'rgba(87,255,154,0.55)', marginTop: 10 }}
        >
          TOUCH THE POND
        </div>
      </div>
      {/* 角落署名 */}
      <div
        className="pointer-events-none absolute z-10 select-none"
        style={{ left: '12%', top: '4.5%' }}
      >
        <div className="font-display" style={{ fontSize: 11, letterSpacing: '0.42em', color: NEON }}>
          SOUND POND
        </div>
        <div
          className="font-cn"
          style={{ fontSize: 10, letterSpacing: '0.5em', color: 'rgba(87,255,154,0.55)', marginTop: 5 }}
        >
          声之池
        </div>
        <div
          className="font-attitude"
          style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(87,255,154,0.38)', marginTop: 6 }}
        >
          点击水面 · 声音涟漪
        </div>
      </div>
    </div>
  )
}
