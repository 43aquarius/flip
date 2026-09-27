'use client'

/**
 * ROOM 02 · TYPE RIOT 字暴
 * 文字即武器。酸黄底上两个巨型黑字各自带弹簧物理：
 * 指针靠近将其击飞旋转、回弹过冲震荡；点击全体引爆。
 * 酸黄 × 黑 · 粗暴构成主义。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const TAU = Math.PI * 2
const CHARS = ['暴', '動']

interface CharState {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  vr: number
  phase: number
  fast: boolean
}

export default function Art02({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const charRefs = useRef<Array<HTMLSpanElement | null>>([])
  const ctrlRef = useRef<{ start: () => void; stop: () => void } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const spans = charRefs.current

    let w = 0
    let h = 0
    let fontSize = 100
    let raf = 0
    let running = false
    let disposed = false
    let t = 0
    let last = 0
    let shake = 0
    let thudCooldown = 0
    let muted = useBookStore.getState().muted

    const st: CharState[] = CHARS.map((_, i) => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 0,
      vr: 0,
      phase: i * 2.13,
      fast: false,
    }))

    const pointer = { x: -9e4, y: -9e4, speed: 0, inside: false, lastX: 0, lastY: 0, lastT: 0 }

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
        master.gain.value = muted ? 0 : 0.5
        master.connect(ctxA.destination)
        const len = Math.floor(ctxA.sampleRate * 0.6)
        noiseBuf = ctxA.createBuffer(1, len, ctxA.sampleRate)
        const data = noiseBuf.getChannelData(0)
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      } catch {
        ac = null
      }
    }

    const boom = () => {
      if (!ac || !master || !noiseBuf || muted) return
      const n = ac.currentTime
      const src = ac.createBufferSource()
      src.buffer = noiseBuf
      const bp = ac.createBiquadFilter()
      bp.type = 'bandpass'
      bp.Q.value = 0.7
      bp.frequency.setValueAtTime(2800, n)
      bp.frequency.exponentialRampToValueAtTime(150, n + 0.3)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.5, n)
      g.gain.exponentialRampToValueAtTime(0.001, n + 0.32)
      src.connect(bp)
      bp.connect(g)
      g.connect(master)
      src.start(n)
      src.stop(n + 0.34)
      const o = ac.createOscillator()
      o.type = 'square'
      o.frequency.setValueAtTime(120, n)
      o.frequency.exponentialRampToValueAtTime(42, n + 0.16)
      const og = ac.createGain()
      og.gain.setValueAtTime(0.3, n)
      og.gain.exponentialRampToValueAtTime(0.001, n + 0.19)
      o.connect(og)
      og.connect(master)
      o.start(n)
      o.stop(n + 0.21)
    }

    const thud = () => {
      if (!ac || !master || muted) return
      const n = ac.currentTime
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(170, n)
      o.frequency.exponentialRampToValueAtTime(64, n + 0.09)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.16, n)
      g.gain.exponentialRampToValueAtTime(0.001, n + 0.12)
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + 0.14)
    }

    // ---------- 物理 ----------
    const slotY = (i: number) => h / 2 + (i - (CHARS.length - 1) / 2) * fontSize * 1.06

    const step = (dt: number) => {
      t += dt
      thudCooldown -= dt
      shake *= Math.exp(-6.5 * dt)
      const k = 108
      const kd = 9.6
      for (let i = 0; i < CHARS.length; i++) {
        const c = st[i]
        // idle 微呼吸摆动
        const swayX = Math.sin(t * 0.8 + c.phase) * 2.6
        const swayY = Math.cos(t * 0.63 + c.phase * 1.7) * 2.1
        const swayR = Math.sin(t * 0.5 + c.phase) * 0.013
        const ax = -k * (c.x - swayX) - kd * c.vx
        const ay = -k * (c.y - swayY) - kd * c.vy
        const ar = -72 * (c.r - swayR) - 7.4 * c.vr
        c.vx += ax * dt
        c.vy += ay * dt
        c.vr += ar * dt

        // 指针斥力冲击
        if (pointer.inside) {
          const cx = w / 2 + c.x
          const cy = slotY(i) + c.y
          const dx = cx - pointer.x
          const dy = cy - pointer.y
          const d = Math.sqrt(dx * dx + dy * dy) + 1e-3
          const R = fontSize * 0.72
          if (d < R) {
            const f = 1 - d / R
            const A = f * f * (26000 + Math.min(pointer.speed, 3000) * 34)
            c.vx += (dx / d) * A * dt
            c.vy += (dy / d) * A * dt
            c.vr += f * f * ((dx > 0 ? 1 : -1) * 55 + (Math.random() - 0.5) * 90) * dt
          }
        }

        c.x += c.vx * dt
        c.y += c.vy * dt
        c.r += c.vr * dt

        // 边界弹回
        const mx = w * 0.44
        const my = h * 0.46
        if (c.x < -mx) {
          c.x = -mx
          c.vx *= -0.38
        } else if (c.x > mx) {
          c.x = mx
          c.vx *= -0.38
        }
        if (c.y < -my) {
          c.y = -my
          c.vy *= -0.38
        } else if (c.y > my) {
          c.y = my
          c.vy *= -0.38
        }

        // 重击声
        const sp = Math.hypot(c.vx, c.vy)
        if (sp > 1500 && !c.fast && thudCooldown <= 0) {
          thud()
          thudCooldown = 0.09
          c.fast = true
        } else if (sp < 500) c.fast = false
      }
    }

    const applyTransforms = () => {
      for (let i = 0; i < CHARS.length; i++) {
        const el = spans[i]
        const c = st[i]
        if (!el) continue
        el.style.transform = `translate(-50%, -50%) translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) rotate(${c.r.toFixed(4)}rad)`
      }
      root.style.transform =
        shake > 0.01
          ? `translate(${((Math.random() - 0.5) * shake * 9).toFixed(2)}px, ${((Math.random() - 0.5) * shake * 7).toFixed(2)}px)`
          : ''
    }

    const frame = (now: number) => {
      if (!running || disposed) return
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      if (dt <= 0) dt = 1 / 120
      pointer.speed *= Math.exp(-5 * dt)
      step(dt)
      applyTransforms()
      raf = requestAnimationFrame(frame)
    }

    // ---------- 引爆 ----------
    const explode = () => {
      for (const c of st) {
        const a = Math.random() * TAU
        const V = 1100 + Math.random() * 1900
        c.vx += Math.cos(a) * V
        c.vy += Math.sin(a) * V - 380
        c.vr += (Math.random() - 0.5) * 34
      }
      shake = 1
      boom()
    }

    // ---------- 尺寸 ----------
    const resize = () => {
      const rect = root.getBoundingClientRect()
      w = Math.max(1, rect.width)
      h = Math.max(1, rect.height)
      const el = spans[0]
      if (el) {
        const box = el.getBoundingClientRect()
        fontSize = Math.max(40, box.height || Math.min(w * 0.58, h * 0.335))
      } else fontSize = Math.min(w * 0.58, h * 0.335)
      if (!running) applyTransforms()
    }

    const toLocal = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect()
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
      pointer.inside = true
      explode()
    }
    const onPointerLeave = () => {
      pointer.inside = false
      pointer.x = -9e4
      pointer.y = -9e4
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    root.addEventListener('pointermove', onPointerMove)
    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('pointerleave', onPointerLeave)

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
      root.style.transform = ''
      if (ac && ac.state === 'running') void ac.suspend()
    }
    ctrlRef.current = { start, stop }

    return () => {
      disposed = true
      running = false
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointerleave', onPointerLeave)
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

  const charSize = 'min(58cqw, 33.5cqh)'

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#e8ff2a', cursor: 'crosshair' }}
    >
      {/* ghost 层：巨大的半透明描边字 */}
      <div
        className="font-display pointer-events-none absolute left-1/2 top-1/2 select-none"
        style={{
          fontSize: 'min(96cqw, 82cqh)',
          lineHeight: 1,
          color: 'transparent',
          WebkitTextStroke: '2.5px rgba(0, 0, 0, 0.10)',
          transform: 'translate(-50%, -50%) rotate(-8deg)',
          whiteSpace: 'nowrap',
        }}
        aria-hidden
      >
        暴動
      </div>
      <div
        className="font-display pointer-events-none absolute left-1/2 select-none"
        style={{
          top: '9%',
          fontSize: 'min(26cqw, 20cqh)',
          lineHeight: 1,
          letterSpacing: '0.14em',
          color: 'transparent',
          WebkitTextStroke: '1.8px rgba(0, 0, 0, 0.16)',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
        }}
        aria-hidden
      >
        RIOT RIOT
      </div>

      {/* 构成主义几何 */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: '16%',
          top: '13%',
          width: '30cqw',
          height: '30cqw',
          border: '2.5px solid #0a0a0a',
          borderRadius: '50%',
          animation: 'riot-circle-breathe 6.5s ease-in-out infinite',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute"
        style={{
          right: '19%',
          bottom: '24%',
          width: '7cqw',
          height: '7cqw',
          background: '#0a0a0a',
          borderRadius: '50%',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute"
        style={{ left: 0, right: 0, top: '50%', height: '1.5px', background: 'rgba(0,0,0,0.22)', transform: 'rotate(-14deg)' }}
        aria-hidden
      />

      {/* 侧标 */}
      <div
        className="font-attitude pointer-events-none absolute select-none"
        style={{
          left: '13%',
          top: '50%',
          transform: 'translateY(-50%) rotate(180deg)',
          writingMode: 'vertical-rl',
          fontSize: 'clamp(7px, 1.5cqw, 11px)',
          letterSpacing: '0.34em',
          color: 'rgba(10, 10, 10, 0.52)',
          whiteSpace: 'nowrap',
        }}
      >
        文字即武器 — TYPE IS A WEAPON — 02
      </div>

      {/* 主字：每个字符独立弹簧物理 */}
      {CHARS.map((ch, i) => (
        <span
          key={ch}
          ref={(el) => {
            charRefs.current[i] = el
          }}
          className="font-display absolute select-none"
          style={{
            left: '50%',
            top: `calc(50% ${(i - (CHARS.length - 1) / 2) < 0 ? '-' : '+'} ${Math.abs((i - (CHARS.length - 1) / 2) * 1.06)} * ${charSize})`,
            fontSize: charSize,
            lineHeight: 1,
            color: '#0a0a0a',
            WebkitTextStroke: '0.5px #0a0a0a',
            textShadow: '0.045em 0.045em 0 rgba(0,0,0,0.30), 0.09em 0.09em 0 rgba(0,0,0,0.15)',
            transform: 'translate(-50%, -50%)',
            willChange: 'transform',
            cursor: 'crosshair',
          }}
        >
          {ch}
        </span>
      ))}

      <style>{`
        @keyframes riot-circle-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.04); }
        }
      `}</style>

      {/* 角落署名 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[4%] z-10 flex flex-col items-center">
        <div
          className="font-attitude"
          style={{ fontSize: 'clamp(8px, 1.7cqw, 12px)', letterSpacing: '0.5em', color: 'rgba(10, 10, 10, 0.78)' }}
        >
          TYPE RIOT
          <span className="font-cn" style={{ letterSpacing: '0.3em', margin: '0 0 0 0.9em' }}>
            · 字暴
          </span>
        </div>
        <div
          className="font-cn"
          style={{
            fontSize: 'clamp(7px, 1.3cqw, 10px)',
            letterSpacing: '0.42em',
            color: 'rgba(10, 10, 10, 0.5)',
            marginTop: '0.7cqh',
          }}
        >
          移动击散 · 点击引爆
        </div>
      </div>
    </div>
  )
}
