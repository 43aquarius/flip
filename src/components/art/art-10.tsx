'use client'

/**
 * ROOM 10 · FLOCK 群鸟
 * 群鸟的集体智能：150 只黑色小三角 boids（分离/对齐/聚合三力），
 * 一只红色领头鸟沿利萨茹曲线巡游，鸟群受其轻微吸引形成跟随。
 * 指针 = 吸引子（鸟群环绕聚拢）；按住指针 = 惊吓（爆散逃逸）。
 * 屏幕边缘环绕 wrap；白底上以低透明度覆盖实现极浅灰运动残影。
 * 调色：暖白 #f7f5f0 / 墨黑 / 红 #ff3b30。
 */

import { useEffect, useRef } from 'react'
import type { ArtPageProps } from './types'

const BG = '#f7f5f0'
const INK = '#161616'
const RED = '#ff3b30'
const N = 150

interface Boid {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  flap: number
  flapSp: number
}

interface FlockEngine {
  resize(): void
  render(): void
  resume(): void
  pause(): void
  destroy(): void
}

/* ============================================================ */

function createFlockEngine(
  canvas: HTMLCanvasElement,
  root: HTMLElement,
  statusEl: HTMLElement | null,
): FlockEngine {
  const context = canvas.getContext('2d')
  if (!context) {
    return { resize() {}, render() {}, resume() {}, pause() {}, destroy() {} }
  }
  const ctx: CanvasRenderingContext2D = context

  let W = 0
  let H = 0
  let running = false
  let raf = 0
  let last = 0
  let seeded = false

  const boids: Boid[] = []

  // 领头鸟：缓慢利萨茹曲线
  let lp = 0
  let lx = 0
  let ly = 0
  let lvx = 1
  let lvy = 0

  // 指针
  let hover = false
  let pressed = false
  let px = 0
  let py = 0

  // 恐慌值（0 秩序 ↔ 1 惊散）
  let panic = 0
  let lastMode = -1

  function seed(): void {
    boids.length = 0
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 60 + Math.random() * 60
      boids.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.5,
        y: H / 2 + (Math.random() - 0.5) * H * 0.5,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        size: 6 + Math.random() * 3,
        flap: Math.random() * Math.PI * 2,
        flapSp: 3 + Math.random() * 4,
      })
    }
  }

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
    // 拖尾基底：整幅不透明铺底
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)
    if (!seeded) {
      seeded = true
      seed()
      updateLeader(0) // 领头鸟立即就位
    }
  }

  /* -------- 群体行为 -------- */
  const R_SEP = 20
  const R_ALI = 38
  const R_COH = 56
  const R_SEP2 = R_SEP * R_SEP
  const R_ALI2 = R_ALI * R_ALI
  const R_COH2 = R_COH * R_COH

  function updateLeader(dt: number): void {
    lp += dt
    const ax = W * 0.3
    const ay = H * 0.28
    lx = W / 2 + ax * Math.sin(0.3 * lp + 1.7)
    ly = H / 2 + ay * Math.sin(0.21 * lp + 0.4)
    lvx = ax * 0.3 * Math.cos(0.3 * lp + 1.7)
    lvy = ay * 0.21 * Math.cos(0.21 * lp + 0.4)
  }

  function update(dt: number): void {
    panic += ((pressed ? 1 : 0) - panic) * Math.min(1, dt * (pressed ? 5 : 1.4))
    updateLeader(dt)

    const maxSpeed = 160 + 210 * panic
    const minSpeed = 52 + 30 * panic
    const maxAcc = 950 + 900 * panic
    const minDim = Math.min(W, H)

    for (let i = 0; i < N; i++) {
      const b = boids[i]
      let sx = 0
      let sy = 0
      let avx = 0
      let avy = 0
      let an = 0
      let cxs = 0
      let cys = 0
      let cn = 0

      for (let j = 0; j < N; j++) {
        if (j === i) continue
        const o = boids[j]
        const dx = o.x - b.x
        const dy = o.y - b.y
        const d2 = dx * dx + dy * dy
        if (d2 > R_COH2 || d2 < 1e-6) continue
        if (d2 < R_SEP2) {
          const d = Math.sqrt(d2)
          const f = (1 - d / R_SEP) / d
          sx -= dx * f
          sy -= dy * f
        }
        if (d2 < R_ALI2) {
          avx += o.vx
          avy += o.vy
          an++
        }
        cxs += dx
        cys += dy
        cn++
      }

      // 三力：分离 / 对齐 / 聚合（权重调至优雅集群）
      let fx = sx * 300 + (an > 0 ? (avx / an - b.vx) * 2.0 : 0) + (cn > 0 ? (cxs / cn) * 0.55 : 0)
      let fy = sy * 300 + (an > 0 ? (avy / an - b.vy) * 2.0 : 0) + (cn > 0 ? (cys / cn) * 0.55 : 0)

      // 领头鸟的轻微吸引（形成跟随）
      const ldx = lx - b.x
      const ldy = ly - b.y
      const ld = Math.hypot(ldx, ldy) || 1
      const lw = ld > minDim * 0.6 ? 40 : 22
      fx += (ldx / ld) * lw
      fy += (ldy / ld) * lw

      if (hover && !pressed) {
        // 指针吸引子：径向聚拢 + 近场切向力（环绕成涡）
        const pdx = px - b.x
        const pdy = py - b.y
        const pd = Math.hypot(pdx, pdy)
        if (pd < 260 && pd > 1) {
          const fall = 1 - pd / 260
          fx += (pdx / pd) * fall * 120
          fy += (pdy / pd) * fall * 120
          if (pd < 150) {
            const tf = (1 - pd / 150) * 90
            fx += (-pdy / pd) * tf
            fy += (pdx / pd) * tf
          }
        }
      }
      if (pressed) {
        // 惊吓：从指针爆散逃逸
        const pdx = b.x - px
        const pdy = b.y - py
        const pd = Math.hypot(pdx, pdy)
        if (pd < 320 && pd > 0.001) {
          const fall = 1 - pd / 320
          const f = fall * fall * 2600
          fx += (pdx / pd) * f
          fy += (pdy / pd) * f
        }
      }

      // 合力限幅 → 半隐式积分
      const fm = Math.hypot(fx, fy)
      if (fm > maxAcc) {
        fx *= maxAcc / fm
        fy *= maxAcc / fm
      }
      b.vx += fx * dt
      b.vy += fy * dt
      const sp = Math.hypot(b.vx, b.vy)
      if (sp > maxSpeed) {
        b.vx *= maxSpeed / sp
        b.vy *= maxSpeed / sp
      } else if (sp < minSpeed && sp > 0.001) {
        b.vx *= minSpeed / sp
        b.vy *= minSpeed / sp
      }
      b.x += b.vx * dt
      b.y += b.vy * dt

      // 屏幕边缘环绕
      const m = 14
      if (b.x < -m) b.x += W + 2 * m
      else if (b.x > W + m) b.x -= W + 2 * m
      if (b.y < -m) b.y += H + 2 * m
      else if (b.y > H + m) b.y -= H + 2 * m

      b.flap += (sp * 0.045 + b.flapSp) * dt
    }
  }

  /* -------- 绘制 -------- */
  function drawBird(x: number, y: number, vx: number, vy: number, size: number, flapW: number, color: string): void {
    const sp = Math.hypot(vx, vy) || 1
    const ux = vx / sp
    const uy = vy / sp
    const qx = -uy
    const qy = ux
    const w = size * 0.58 * flapW
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x + ux * size * 1.2, y + uy * size * 1.2) // 喙
    ctx.lineTo(x - ux * size * 0.9 + qx * w, y - uy * size * 0.9 + qy * w) // 左翼
    ctx.lineTo(x - ux * size * 0.5, y - uy * size * 0.5) // 尾凹
    ctx.lineTo(x - ux * size * 0.9 - qx * w, y - uy * size * 0.9 - qy * w) // 右翼
    ctx.closePath()
    ctx.fill()
  }

  function render(): void {
    if (W === 0) return
    // 极低透明度铺底：轻微拖尾（残影）
    ctx.fillStyle = 'rgba(247,245,240,0.18)'
    ctx.fillRect(0, 0, W, H)

    for (const b of boids) {
      drawBird(b.x, b.y, b.vx, b.vy, b.size, 0.78 + 0.28 * Math.sin(b.flap), INK)
    }
    // 红色领头鸟压轴
    drawBird(lx, ly, lvx, lvy, 11, 0.78 + 0.28 * Math.sin(lp * 6), RED)

    // 状态铭牌（仅状态切换时改写 DOM）
    if (statusEl) {
      const mode = panic > 0.5 ? 1 : 0
      if (mode !== lastMode) {
        lastMode = mode
        statusEl.textContent = mode === 1 ? '150 · PANIC 惊散' : '150 · ORDER 秩序'
        statusEl.style.color = mode === 1 ? RED : 'rgba(22,22,22,0.45)'
      }
    }
  }

  /* -------- 输入 -------- */
  function onMove(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect()
    px = e.clientX - rect.left
    py = e.clientY - rect.top
    hover = true
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    onMove(e)
    pressed = true
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* 忽略 */
    }
  }

  function onUp(): void {
    pressed = false
  }

  function onLeave(): void {
    hover = false
  }

  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('pointerleave', onLeave)

  /* -------- 主循环 -------- */
  function loop(nowMs: number): void {
    if (!running) return
    raf = requestAnimationFrame(loop)
    const dt = Math.min((nowMs - last) / 1000, 0.033)
    last = nowMs
    update(dt)
    render()
  }

  function resume(): void {
    if (running) return
    running = true
    last = performance.now()
    raf = requestAnimationFrame(loop)
  }

  function pause(): void {
    running = false
    cancelAnimationFrame(raf)
  }

  function destroy(): void {
    pause()
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onUp)
    canvas.removeEventListener('pointerleave', onLeave)
  }

  return { resize, render, resume, pause, destroy }
}

/* ============================================================ */

export default function Art10({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<FlockEngine | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const engine = createFlockEngine(canvas, root, statusRef.current)
    engineRef.current = engine
    engine.resize()
    engine.render()
    const ro = new ResizeObserver(() => {
      engine.resize()
      engine.render()
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
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: BG }}>
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
        <div className="font-display" style={{ fontSize: 11, letterSpacing: '0.42em', color: INK }}>
          FLOCK
        </div>
        <div
          className="font-cn"
          style={{ fontSize: 10, letterSpacing: '0.5em', color: 'rgba(22,22,22,0.55)', marginTop: 5 }}
        >
          群鸟
        </div>
        <div
          className="font-attitude"
          style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(22,22,22,0.38)', marginTop: 6 }}
        >
          移动聚集 · 按住惊散
        </div>
      </div>
      {/* 状态铭牌 */}
      <div
        ref={statusRef}
        className="pointer-events-none absolute z-10 select-none font-attitude"
        style={{
          right: '12%',
          top: '5.2%',
          fontSize: 9.5,
          letterSpacing: '0.18em',
          color: 'rgba(22,22,22,0.45)',
        }}
      />
    </div>
  )
}
