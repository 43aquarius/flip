'use client'

/**
 * ROOM 01 · GENESIS 尘之场
 * 宇宙尘埃的创世现场：2200 粒暖金尘埃在缓慢流动的噪声流场中漂移，
 * 指针是引力/斥力场（移动扰动、按住坍缩吸引），中心偏上是缓慢呼吸的暗金旋涡。
 * 黑底金尘 · 静谧而巨大。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const COUNT = 2200
const TAU = Math.PI * 2
const BG = '#070604'

export default function Art01({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    // ---------- 状态 ----------
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let running = false
    let disposed = false
    let t = 0
    let last = 0
    let muted = useBookStore.getState().muted

    // 帧率自适应：活动粒子数在 COUNT 的 35%..100% 间随帧耗时升降（低端机保护）
    let activeCount = COUNT
    const COUNT_MIN = Math.floor(COUNT * 0.35)
    let emaDt = 16.7 // 指数滑动平均帧耗时 ms
    let tuneFrames = 0

    const px = new Float32Array(COUNT)
    const py = new Float32Array(COUNT)
    const vx = new Float32Array(COUNT)
    const vy = new Float32Array(COUNT)
    const sz = new Float32Array(COUNT)
    const ph = new Float32Array(COUNT)
    const fsp = new Float32Array(COUNT)
    const tint = new Uint8Array(COUNT)

    const pointer = { x: -9e4, y: -9e4, speed: 0, down: false, inside: false, lastX: 0, lastY: 0, lastT: 0 }

    // 旋涡辉光贴图（缓存）
    const glowCv = document.createElement('canvas')
    glowCv.width = 256
    glowCv.height = 256
    {
      const g = glowCv.getContext('2d')
      if (g) {
        const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
        grd.addColorStop(0, 'rgba(226, 190, 120, 0.30)')
        grd.addColorStop(0.35, 'rgba(176, 136, 66, 0.15)')
        grd.addColorStop(0.7, 'rgba(120, 92, 40, 0.05)')
        grd.addColorStop(1, 'rgba(120, 92, 40, 0)')
        g.fillStyle = grd
        g.fillRect(0, 0, 256, 256)
      }
    }

    // 暗角贴图（随尺寸重建）
    const vignetteCv = document.createElement('canvas')
    const buildVignette = () => {
      vignetteCv.width = Math.max(2, Math.round(w))
      vignetteCv.height = Math.max(2, Math.round(h))
      const g = vignetteCv.getContext('2d')
      if (!g) return
      const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.hypot(w, h) * 0.62)
      grd.addColorStop(0, 'rgba(0,0,0,0)')
      grd.addColorStop(1, 'rgba(0,0,0,0.5)')
      g.fillStyle = grd
      g.fillRect(0, 0, w, h)
    }

    const seedAll = () => {
      for (let i = 0; i < COUNT; i++) {
        px[i] = Math.random() * w
        py[i] = Math.random() * h
        vx[i] = (Math.random() - 0.5) * 14
        vy[i] = (Math.random() - 0.5) * 14
        sz[i] = 0.5 + Math.random() * Math.random() * 2.1
        ph[i] = Math.random() * TAU
        fsp[i] = 0.4 + Math.random() * 2.2
        tint[i] = Math.random() < 0.16 ? 1 : 0
      }
    }

    // ---------- 音频：低频引力嗡鸣 + 指针掠过的噪声风 ----------
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let droneGain: GainNode | null = null
    let lowpass: BiquadFilterNode | null = null
    let noiseGain: GainNode | null = null

    const initAudio = () => {
      if (ac || disposed) return
      try {
        const ctxA = new AudioContext()
        ac = ctxA
        master = ctxA.createGain()
        master.gain.value = muted ? 0 : 0.5
        master.connect(ctxA.destination)
        lowpass = ctxA.createBiquadFilter()
        lowpass.type = 'lowpass'
        lowpass.frequency.value = 230
        droneGain = ctxA.createGain()
        droneGain.gain.value = 0
        droneGain.connect(lowpass)
        lowpass.connect(master)
        const o1 = ctxA.createOscillator()
        o1.type = 'sine'
        o1.frequency.value = 54
        const o2 = ctxA.createOscillator()
        o2.type = 'sine'
        o2.frequency.value = 54.45
        const o3 = ctxA.createOscillator()
        o3.type = 'triangle'
        o3.frequency.value = 108.6
        const g3 = ctxA.createGain()
        g3.gain.value = 0.22
        o1.connect(droneGain)
        o2.connect(droneGain)
        o3.connect(g3)
        g3.connect(droneGain)
        o1.start()
        o2.start()
        o3.start()
        // 噪声风
        const len = Math.floor(ctxA.sampleRate * 1.2)
        const buf = ctxA.createBuffer(1, len, ctxA.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
        const src = ctxA.createBufferSource()
        src.buffer = buf
        src.loop = true
        const bp = ctxA.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 540
        bp.Q.value = 0.55
        noiseGain = ctxA.createGain()
        noiseGain.gain.value = 0
        src.connect(bp)
        bp.connect(noiseGain)
        noiseGain.connect(master)
        src.start()
        droneGain.gain.setTargetAtTime(0.045, ctxA.currentTime, 1.4)
      } catch {
        ac = null
      }
    }

    // ---------- 物理 ----------
    const step = (dt: number) => {
      t += dt
      const vcx = w * 0.5 + Math.sin(t * 0.07) * w * 0.025
      const vcy = h * 0.4 + Math.cos(t * 0.09) * h * 0.018
      const breath = 0.5 + 0.5 * Math.sin(t * 0.33)
      const vr = Math.min(w, h) * (0.085 + 0.024 * Math.sin(t * 0.33))
      const vrInf = vr * 5
      const damp = Math.exp(-1.9 * dt)

      for (let i = 0; i < activeCount; i++) {
        const x = px[i]
        const y = py[i]
        // 伪噪声流场
        const a =
          Math.sin(x * 0.0016 + t * 0.1) * 1.35 +
          Math.cos(y * 0.0013 - t * 0.07) * 1.15 +
          Math.sin((x + y) * 0.0007 + t * 0.05) * 0.75
        let ax = Math.cos(a) * 16
        let ay = Math.sin(a) * 16

        // 呼吸的尘埃旋涡（切向 + 轻微向内）
        let dx = x - vcx
        let dy = y - vcy
        let d = Math.sqrt(dx * dx + dy * dy) + 1e-4
        if (d < vrInf) {
          const fall = 1 - d / vrInf
          const sw = fall * fall * 135 * (0.7 + 0.3 * breath)
          ax += (-dy / d) * sw - (dx / d) * sw * 0.33
          ay += (dx / d) * sw - (dy / d) * sw * 0.33
        }

        // 指针力场
        if (pointer.inside) {
          dx = x - pointer.x
          dy = y - pointer.y
          d = Math.sqrt(dx * dx + dy * dy) + 1e-4
          const R = 110 + Math.min(pointer.speed, 1800) * 0.055
          if (d < R) {
            const fall = 1 - d / R
            if (pointer.down) {
              // 引力坍缩 + 吸积旋转
              const pull = fall * fall * 2900
              ax -= (dx / d) * pull - (dy / d) * fall * 2300
              ay -= (dy / d) * pull + (dx / d) * fall * 2300
            } else {
              // 掠动斥力（越快越强）
              const push = fall * fall * (1500 + Math.min(pointer.speed, 2400) * 2.4)
              ax += (dx / d) * push
              ay += (dy / d) * push
            }
          }
        }

        vx[i] = (vx[i] + ax * dt) * damp
        vy[i] = (vy[i] + ay * dt) * damp
        const sp2 = vx[i] * vx[i] + vy[i] * vy[i]
        if (sp2 > 490000) {
          const s = 700 / Math.sqrt(sp2)
          vx[i] *= s
          vy[i] *= s
        }
        px[i] += vx[i] * dt
        py[i] += vy[i] * dt
        if (px[i] < -8) px[i] += w + 16
        else if (px[i] > w + 8) px[i] -= w + 16
        if (py[i] < -8) py[i] += h + 16
        else if (py[i] > h + 8) py[i] -= h + 16
      }

      // 噪声风跟随指针速度
      if (noiseGain) {
        const target = muted || !running ? 0 : Math.min(1, pointer.speed / 2400) * 0.05
        noiseGain.gain.value += (target - noiseGain.gain.value) * 0.1
      }
    }

    // ---------- 绘制 ----------
    const render = () => {
      const vcx = w * 0.5 + Math.sin(t * 0.07) * w * 0.025
      const vcy = h * 0.4 + Math.cos(t * 0.09) * h * 0.018
      const breath = 0.5 + 0.5 * Math.sin(t * 0.33)
      // 拖影
      ctx.fillStyle = 'rgba(7, 6, 4, 0.16)'
      ctx.fillRect(0, 0, w, h)
      // 旋涡辉光
      const gs = Math.min(w, h) * (0.52 + 0.05 * Math.sin(t * 0.33))
      ctx.globalAlpha = 0.5 + 0.2 * breath
      ctx.drawImage(glowCv, vcx - gs / 2, vcy - gs / 2, gs, gs)
      ctx.globalAlpha = 1
      // 尘埃（活动粒度随帧率自适应）
      for (let i = 0; i < activeCount; i++) {
        const fl = 0.5 + 0.5 * Math.sin(t * fsp[i] + ph[i])
        const s = sz[i]
        ctx.globalAlpha = 0.28 + 0.72 * fl
        ctx.fillStyle = tint[i] === 1 ? '#d9c88f' : '#e8dfc8'
        ctx.fillRect(px[i] - s * 0.5, py[i] - s * 0.5, s, s)
        // 少量亮尘的十字闪芒
        if (i % 17 === 0 && fl > 0.955 && s > 1.35) {
          ctx.globalAlpha = 0.8
          ctx.fillStyle = '#fff6dd'
          ctx.fillRect(px[i] - 3.5, py[i] - 0.5, 7, 1)
          ctx.fillRect(px[i] - 0.5, py[i] - 3.5, 1, 7)
        }
      }
      ctx.globalAlpha = 1
      ctx.drawImage(vignetteCv, 0, 0, w, h)
    }

    const frame = (now: number) => {
      if (!running || disposed) return
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      if (dt <= 0) dt = 1 / 120
      // 帧率自适应：滑动平均帧耗时，每 45 帧评估一次升降级
      const ms = dt * 1000
      emaDt += (ms - emaDt) * 0.06
      if (++tuneFrames >= 45) {
        tuneFrames = 0
        if (emaDt > 26 && activeCount > COUNT_MIN) {
          activeCount = Math.max(COUNT_MIN, Math.floor(activeCount * 0.8))
        } else if (emaDt < 15 && activeCount < COUNT) {
          activeCount = Math.min(COUNT, Math.ceil(activeCount * 1.15))
        }
      }
      pointer.speed *= Math.exp(-5 * dt)
      step(dt)
      render()
      raf = requestAnimationFrame(frame)
    }

    // ---------- 尺寸 ----------
    const resize = () => {
      const rect = root.getBoundingClientRect()
      const nw = Math.max(1, Math.round(rect.width))
      const nh = Math.max(1, Math.round(rect.height))
      const ndpr = Math.min(window.devicePixelRatio || 1, 2)
      if (nw === w && nh === h && ndpr === dpr) return
      const oldW = w
      const oldH = h
      w = nw
      h = nh
      dpr = ndpr
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, w, h)
      if (oldW === 0 || oldH === 0) seedAll()
      else {
        const rx = w / oldW
        const ry = h / oldH
        for (let i = 0; i < COUNT; i++) {
          px[i] *= rx
          py[i] *= ry
        }
      }
      buildVignette()
      if (!running) render() // 立即重绘一帧（冻结画面也保持完整）
    }

    // ---------- 指针 ----------
    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onPointerMove = (e: PointerEvent) => {
      const p = toLocal(e)
      const now = e.timeStamp || performance.now()
      const dtE = Math.max(1, now - pointer.lastT) / 1000
      const inst = Math.hypot(p.x - pointer.lastX, p.y - pointer.lastY) / dtE
      pointer.speed = pointer.speed * 0.55 + Math.min(inst, 4000) * 0.45
      pointer.lastX = p.x
      pointer.lastY = p.y
      pointer.lastT = now
      pointer.x = p.x
      pointer.y = p.y
      pointer.inside = true
    }
    const onPointerDown = (e: PointerEvent) => {
      initAudio()
      const p = toLocal(e)
      pointer.x = p.x
      pointer.y = p.y
      pointer.down = true
      pointer.inside = true
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
      if (droneGain && lowpass && ac) {
        droneGain.gain.setTargetAtTime(0.1, ac.currentTime, 0.18)
        lowpass.frequency.setTargetAtTime(560, ac.currentTime, 0.25)
      }
    }
    const releasePointer = () => {
      pointer.down = false
      if (droneGain && lowpass && ac) {
        droneGain.gain.setTargetAtTime(0.045, ac.currentTime, 0.5)
        lowpass.frequency.setTargetAtTime(230, ac.currentTime, 0.6)
      }
    }
    const onPointerUp = () => releasePointer()
    const onPointerLeave = () => {
      pointer.inside = false
      pointer.x = -9e4
      pointer.y = -9e4
      releasePointer()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()
    render()

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 0.5, ac.currentTime, 0.05)
    })

    // ---------- 启停 ----------
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
      if (noiseGain) noiseGain.gain.value = 0
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
      canvas.removeEventListener('pointercancel', onPointerUp)
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
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: BG }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />
      {/* 角落署名（底部居中，避开翻页热区与页码徽章） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[4%] z-10 flex flex-col items-center">
        <div
          className="font-attitude"
          style={{ fontSize: 'clamp(8px, 1.7cqw, 12px)', letterSpacing: '0.5em', color: 'rgba(216, 205, 168, 0.55)' }}
        >
          GENESIS
          <span className="font-cn" style={{ letterSpacing: '0.3em', margin: '0 0 0 0.9em' }}>
            · 尘之场
          </span>
        </div>
        <div
          className="font-cn"
          style={{
            fontSize: 'clamp(7px, 1.3cqw, 10px)',
            letterSpacing: '0.42em',
            color: 'rgba(216, 205, 168, 0.3)',
            marginTop: '0.7cqh',
          }}
        >
          移动指针 · 扰动尘埃 — 按住 · 引力坍缩
        </div>
      </div>
    </div>
  )
}
