'use client'

/**
 * ROOM 05 · MOIRÉ 干涉 — 双层干涉场
 *
 * 宏观干涉（永动骨架）：两张满页光栅（间距 7px / 7.8px）叠加，
 * 上层绕页面中心缓慢旋转（0.028–0.054 rad/s，方向周期性反转）
 * 并带微小轨道偏移——零输入也有巨幅摩尔波纹持续扫过整页。
 * 微观干涉：可拖拽光栅盘（弹簧惯性微滞后跟手，水平甩动赋角速度，
 * 摩擦衰减）+ 重滞后弹簧（k≈8）尾随的幽灵盘（45% 墨），
 * 主盘之下构成第三片随手势流动的干涉场。
 * 点击（轻触非拖拽）统一切换纹样家族：同心圆 → 放射线 → 平行线，
 * 180ms 黑色斜带快门扫过（朱红前缘）。
 * 技术制图美学：四边每 24px 刻度、四角朱红裁切角标、
 * FIG.05 图注、左缘 6% 巨型竖排 MOIRÉ 幽灵字。
 * 声音：双振荡器拍频干涉——拍频 = 盘转速 + 主/幽灵盘距离（越近越慢）；
 * 轻点 = 三角波短音。纸白 #f4f2ec / 墨黑 #141414 / 朱红 #e03131。
 * 光栅全部离屏预渲染，主循环仅 drawImage + 旋转绘制。
 */

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

const TAU = Math.PI * 2
const INK = '#141414'
const CREAM = '#f4f2ec'
const RED = '#e03131'
const SP_A = 7 // 光栅 A 间距（基准）
const SP_B = 7.8 // 光栅 B 间距（略异 → 宏观巨幅摩尔纹）
const SP_D = 7.63 // 盘上光栅间距 ≈ 1.09 × 基准
const PATTERN_CN = ['同心圆', '放射线', '平行线']
const PATTERN_EN = ['CONCENTRIC', 'RADIAL', 'PARALLEL']

export default function Art05({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const patternLabelRef = useRef<HTMLDivElement | null>(null)
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
    let raf = 0
    let running = false
    let disposed = false
    let t = 0
    let last = 0
    let audioTick = 0
    let muted = useBookStore.getState().muted

    let pattern = 0
    let shutter = -1 // 0..1 快门扫过进度；-1 = 关闭

    // 光栅 B：绕页面中心慢旋转（宏观干涉的永动源）
    let rotB = 0
    let bDir = 1
    let bTimer = 0
    let bDur = 13
    let bSize = 0 // B 画布 CSS 边长（对角线）

    // 主盘：弹簧惯性 + 甩动旋转
    const disc = { x: 0, y: 0, vx: 0, vy: 0, rot: 0.3, rotV: 0 }
    // 幽灵盘：重滞后弹簧尾随（k≈8）
    const ghost = { x: 0, y: 0, vx: 0, vy: 0, rot: 0.3, rotV: 0 }
    let discD = 100
    let ghostD = 40

    const drag = { active: false, ox: 0, oy: 0, startX: 0, startY: 0, t0: 0, moved: 0 }
    const ptr = { x: -9e4, y: -9e4, px: -9e4, py: -9e4 }

    // 离屏画布：光栅 A / 光栅 B / 主盘 / 幽灵盘 / 静态制图铬版（刻度+角标）
    const aCv = document.createElement('canvas')
    const bCv = document.createElement('canvas')
    const discCv = document.createElement('canvas')
    const ghostCv = document.createElement('canvas')
    const chromeCv = document.createElement('canvas')

    // canvas 内小字使用的字体族（解析 var(--font-attitude) 的实际族名）
    let attitudeFont = 'ui-monospace, Menlo, monospace'
    try {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;font-family:var(--font-attitude)'
      document.body.appendChild(probe)
      const fam = getComputedStyle(probe).fontFamily
      if (fam) attitudeFont = fam
      probe.remove()
    } catch {
      /* 保持回退字体 */
    }

    // ---------- 音频：拍频干涉（双振荡器） ----------
    let ac: AudioContext | null = null
    let master: GainNode | null = null
    let oscA: OscillatorNode | null = null
    let oscB: OscillatorNode | null = null
    let beatGain: GainNode | null = null

    const initAudio = () => {
      if (ac || disposed) return
      try {
        const ctxA = new AudioContext()
        ac = ctxA
        master = ctxA.createGain()
        master.gain.value = muted ? 0 : 1
        master.connect(ctxA.destination)
        beatGain = ctxA.createGain()
        beatGain.gain.value = 0
        beatGain.connect(master)
        oscA = ctxA.createOscillator()
        oscA.type = 'sine'
        oscA.frequency.value = 200
        oscB = ctxA.createOscillator()
        oscB.type = 'sine'
        oscB.frequency.value = 202.4
        const ga = ctxA.createGain()
        ga.gain.value = 0.5
        const gb = ctxA.createGain()
        gb.gain.value = 0.5
        oscA.connect(ga)
        ga.connect(beatGain)
        oscB.connect(gb)
        gb.connect(beatGain)
        oscA.start()
        oscB.start()
        beatGain.gain.setTargetAtTime(0.032, ctxA.currentTime, 0.8)
      } catch {
        ac = null
      }
    }

    const blip = () => {
      if (!ac || !master || muted) return
      const n = ac.currentTime
      const o = ac.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(740, n)
      o.frequency.exponentialRampToValueAtTime(370, n + 0.09)
      const g = ac.createGain()
      g.gain.setValueAtTime(0.09, n)
      g.gain.exponentialRampToValueAtTime(0.001, n + 0.12)
      o.connect(g)
      g.connect(master)
      o.start(n)
      o.stop(n + 0.14)
    }

    // ---------- 光栅绘制（离屏预渲染） ----------
    const drawGrating = (
      g: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      spacing: number,
      extW: number,
      extH: number,
      radialCount: number,
    ) => {
      g.strokeStyle = INK
      g.lineWidth = 1.1
      if (pattern === 0) {
        const maxR = Math.hypot(extW, extH) / 2 + 12
        for (let r = spacing * 0.5; r <= maxR; r += spacing) {
          g.beginPath()
          g.arc(cx, cy, r, 0, TAU)
          g.stroke()
        }
      } else if (pattern === 1) {
        const R = Math.hypot(extW, extH)
        for (let i = 0; i < radialCount; i++) {
          const a = (i / radialCount) * TAU
          g.beginPath()
          g.moveTo(cx, cy)
          g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
          g.stroke()
        }
      } else {
        const x0 = cx - extW / 2 - spacing
        const x1 = cx + extW / 2 + spacing
        for (let x = x0; x <= x1; x += spacing) {
          g.beginPath()
          g.moveTo(x, cy - extH / 2 - 4)
          g.lineTo(x, cy + extH / 2 + 4)
          g.stroke()
        }
      }
    }

    const buildDiscGrating = (cv: HTMLCanvasElement, D: number, radialCount: number, withRing: boolean) => {
      const px = Math.max(2, Math.round(D * dpr))
      cv.width = px
      cv.height = px
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, D, D)
      const r = D / 2
      g.save()
      g.beginPath()
      g.arc(r, r, Math.max(0.5, r - 1.5), 0, TAU)
      g.clip()
      drawGrating(g, r, r, SP_D, D, D, radialCount)
      g.restore()
      if (withRing) {
        // 幽灵盘细墨描边（经 globalAlpha 后 ≈ 22%，界定盘缘）
        g.strokeStyle = 'rgba(20,20,20,0.5)'
        g.lineWidth = 1
        g.beginPath()
        g.arc(r, r, Math.max(0.5, r - 0.8), 0, TAU)
        g.stroke()
      }
    }

    const buildGratings = () => {
      // 元素尚未布局完成（极小尺寸）时跳过，避免负半径 arc 报错
      if (w < 40 || h < 40) return
      const m = Math.min(w, h)
      const nA = Math.max(36, Math.round((TAU * (m / 2)) / SP_A))

      // A：满页尺寸，平铺绘制
      aCv.width = Math.max(2, Math.round(w * dpr))
      aCv.height = Math.max(2, Math.round(h * dpr))
      const a = aCv.getContext('2d')
      if (!a) return
      a.setTransform(dpr, 0, 0, dpr, 0, 0)
      a.clearRect(0, 0, w, h)
      drawGrating(a, w / 2, h / 2, SP_A, w, h, nA)

      // B：对角线尺寸（旋转任意角度仍覆盖满页）；分辨率封顶防低端机爆内存
      const diag = Math.ceil(Math.hypot(w, h)) + 8
      bSize = diag
      const bRes = Math.min(dpr, 2048 / diag)
      bCv.width = Math.max(2, Math.round(diag * bRes))
      bCv.height = bCv.width
      const b = bCv.getContext('2d')
      if (!b) return
      b.setTransform(bRes, 0, 0, bRes, 0, 0)
      b.clearRect(0, 0, diag, diag)
      const nB = Math.max(40, Math.round((TAU * (m / 2)) / SP_B))
      drawGrating(b, diag / 2, diag / 2, SP_B, diag, diag, nB)

      // 主盘（直径 ≈ 55% 页高）/ 幽灵盘（40% 大小，同族纹样）
      discD = Math.max(30, Math.min(h * 0.55, w * 0.86))
      ghostD = Math.max(18, discD * 0.4)
      buildDiscGrating(discCv, discD, nA + 13, false)
      buildDiscGrating(ghostCv, ghostD, nA + 19, true)
    }

    // ---------- 制图铬版：四边刻度 + 四角裁切角标（静态，随 resize 重建） ----------
    const buildChrome = () => {
      if (w < 40 || h < 40) return
      chromeCv.width = Math.max(2, Math.round(w * dpr))
      chromeCv.height = Math.max(2, Math.round(h * dpr))
      const c = chromeCv.getContext('2d')
      if (!c) return
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, w, h)

      // 每 24px 一格刻度，每 4 格一长格（墨 35%）
      c.strokeStyle = 'rgba(20,20,20,0.35)'
      c.lineWidth = 1
      c.beginPath()
      const step = 24
      for (let x = step; x < w - 1; x += step) {
        const L = Math.round(x / step) % 4 === 0 ? 13 : 7
        c.moveTo(x + 0.5, 0)
        c.lineTo(x + 0.5, L)
        c.moveTo(x + 0.5, h)
        c.lineTo(x + 0.5, h - L)
      }
      for (let y = step; y < h - 1; y += step) {
        const L = Math.round(y / step) % 4 === 0 ? 13 : 7
        c.moveTo(0, y + 0.5)
        c.lineTo(L, y + 0.5)
        c.moveTo(w, y + 0.5)
        c.lineTo(w - L, y + 0.5)
      }
      c.stroke()

      // 四角朱红 L 形裁切角标
      c.strokeStyle = 'rgba(224,49,49,0.85)'
      c.lineWidth = 1.4
      const o = 15
      const L2 = 17
      const corners: Array<[number, number, number, number]> = [
        [o, o, 1, 1],
        [w - o, o, -1, 1],
        [o, h - o, 1, -1],
        [w - o, h - o, -1, -1],
      ]
      c.beginPath()
      for (const [x, y, sx, sy] of corners) {
        c.moveTo(x + sx * L2, y)
        c.lineTo(x, y)
        c.lineTo(x, y + sy * L2)
      }
      c.stroke()
    }

    const updatePatternLabel = () => {
      const el = patternLabelRef.current
      if (el) el.textContent = `纹样 ${pattern + 1} / 3 — ${PATTERN_CN[pattern]} ${PATTERN_EN[pattern]}`
    }

    // ---------- 主循环 ----------
    const render = (dt: number) => {
      if (w < 40 || h < 40 || aCv.width === 0) return
      t += dt
      const m = Math.min(w, h)

      // 光栅 B：慢旋转（0.028–0.054 rad/s）+ 方向周期性反转
      bTimer += dt
      if (bTimer >= bDur) {
        bTimer = 0
        bDir = -bDir
        bDur = 11 + Math.random() * 9
      }
      rotB += bDir * (0.028 + 0.026 * (0.5 + 0.5 * Math.sin(t * 0.17))) * dt

      // ---- 主盘物理
      const pad = Math.max(10, discD * 0.32)
      if (drag.active) {
        // 弹簧惯性：微微滞后跟手
        const k = 180
        const cd = 20
        const tx = Math.min(Math.max(ptr.x + drag.ox, pad), Math.max(pad, w - pad))
        const ty = Math.min(Math.max(ptr.y + drag.oy, pad), Math.max(pad, h - pad))
        disc.vx += ((tx - disc.x) * k - disc.vx * cd) * dt
        disc.vy += ((ty - disc.y) * k - disc.vy * cd) * dt
        disc.x += disc.vx * dt
        disc.y += disc.vy * dt
        // 水平甩动 → 角速度（平滑追踪指针水平速度）
        if (dt > 0 && ptr.px > -9e3) {
          const pvx = (ptr.x - ptr.px) / dt
          const target = Math.max(-7, Math.min(7, pvx * 0.0026))
          disc.rotV += (target - disc.rotV) * Math.min(1, 10 * dt)
        }
      } else {
        // 松手：动量滑行 + 摩擦衰减
        disc.x += disc.vx * dt
        disc.y += disc.vy * dt
        disc.vx *= Math.exp(-2.3 * dt)
        disc.vy *= Math.exp(-2.3 * dt)
        disc.rotV *= Math.exp(-0.85 * dt)
      }
      // 软墙反弹
      if (disc.x < pad) {
        disc.x = pad
        if (disc.vx < 0) disc.vx *= -0.45
      }
      if (disc.x > w - pad) {
        disc.x = w - pad
        if (disc.vx > 0) disc.vx *= -0.45
      }
      if (disc.y < pad) {
        disc.y = pad
        if (disc.vy < 0) disc.vy *= -0.45
      }
      if (disc.y > h - pad) {
        disc.y = h - pad
        if (disc.vy > 0) disc.vy *= -0.45
      }
      disc.rot += disc.rotV * dt

      // ---- 幽灵盘：重滞后弹簧尾随主盘（k≈8，欠阻尼）
      const gk = 8
      const gc = 2.1
      ghost.vx += ((disc.x - ghost.x) * gk - ghost.vx * gc) * dt
      ghost.vy += ((disc.y - ghost.y) * gk - ghost.vy * gc) * dt
      ghost.x += ghost.vx * dt
      ghost.y += ghost.vy * dt
      ghost.rotV += ((disc.rot - ghost.rot) * gk - ghost.rotV * gc) * dt
      ghost.rot += ghost.rotV * dt

      // 静置微漂浮（呼吸感；拖拽时归零，纯跟手）
      const fx = drag.active ? 0 : Math.sin(t * 0.3) * m * 0.006
      const fy = drag.active ? 0 : Math.cos(t * 0.24) * m * 0.006
      const dx = disc.x + fx
      const dy = disc.y + fy

      // ---- 绘制
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(aCv, 0, 0, w, h)

      // B 绕页面中心旋转 + 微轨道偏移（同心圆族也因此持续涌动）
      const orb = pattern === 0 ? 7 : 3.5
      ctx.save()
      ctx.translate(w / 2 + Math.cos(t * 0.11) * orb, h / 2 + Math.sin(t * 0.09) * orb)
      ctx.rotate(rotB)
      ctx.drawImage(bCv, -bSize / 2, -bSize / 2, bSize, bSize)
      ctx.restore()

      // 幽灵盘（主盘之下，45% 墨 → 第三片干涉场）
      ctx.save()
      ctx.globalAlpha = 0.45
      ctx.translate(ghost.x, ghost.y)
      ctx.rotate(ghost.rot)
      ctx.drawImage(ghostCv, -ghostD / 2, -ghostD / 2, ghostD, ghostD)
      ctx.restore()

      // 主盘：光栅 + 朱红定位环（随盘旋转）
      const r = discD / 2
      ctx.save()
      ctx.translate(dx, dy)
      ctx.rotate(disc.rot)
      ctx.drawImage(discCv, -r, -r, discD, discD)
      ctx.strokeStyle = RED
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, 0, Math.max(1, r - 1), 0, TAU)
      ctx.stroke()
      ctx.lineWidth = 1.4
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU
        ctx.moveTo(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1))
        ctx.lineTo(Math.cos(a) * (r - 10), Math.sin(a) * (r - 10))
      }
      ctx.stroke()
      const ch = Math.max(7, Math.min(15, r * 0.14))
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.moveTo(-ch, 0)
      ctx.lineTo(ch, 0)
      ctx.moveTo(0, -ch)
      ctx.lineTo(0, ch)
      ctx.stroke()
      ctx.fillStyle = RED
      ctx.beginPath()
      ctx.arc(0, 0, 1.7, 0, TAU)
      ctx.fill()
      ctx.restore()

      // N°05 标签（屏幕对齐，不随盘旋转）
      ctx.fillStyle = RED
      ctx.font = `700 ${Math.max(8, Math.min(11, m * 0.016))}px ${attitudeFont}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N°05', dx, dy - r * 0.64)

      // 制图铬版（刻度 + 角标）
      ctx.drawImage(chromeCv, 0, 0, w, h)

      // 快门扫过（纹样切换，180ms 黑色斜带 + 朱红前缘）
      if (shutter >= 0) {
        shutter += dt / 0.18
        if (shutter >= 1) {
          shutter = -1
        } else {
          const diag = Math.hypot(w, h)
          ctx.save()
          ctx.translate(w / 2, h / 2)
          ctx.rotate(Math.PI / 4)
          const c0 = -diag * 0.85 + shutter * diag * 1.7
          const bw = diag * 0.3
          ctx.fillStyle = 'rgba(20,20,20,0.93)'
          ctx.fillRect(c0 - bw, -diag, bw, diag * 2)
          ctx.fillStyle = RED
          ctx.fillRect(c0 - 2.5, -diag, 2.5, diag * 2)
          ctx.restore()
        }
      }

      ptr.px = ptr.x
      ptr.py = ptr.y

      // ---- 拍频声：拍频 ← 盘转速 + 主/幽灵盘距离（越近越慢）
      audioTick += dt
      if (audioTick > 0.1 && ac && oscA && oscB && beatGain) {
        audioTick = 0
        const fA = 150 + (disc.x / Math.max(1, w)) * 130
        const dist = Math.min(1, Math.hypot(disc.x - ghost.x, disc.y - ghost.y) / Math.max(1, m))
        const beat = 0.9 + Math.min(Math.abs(disc.rotV), 6) * 1.5 + dist * 6.5
        const now = ac.currentTime
        oscA.frequency.setTargetAtTime(fA, now, 0.08)
        oscB.frequency.setTargetAtTime(fA + beat, now, 0.08)
        const loud = drag.active || Math.abs(disc.rotV) > 0.6
        beatGain.gain.setTargetAtTime(muted ? 0 : loud ? 0.055 : 0.032, now, 0.15)
      }
    }

    const frame = (now: number) => {
      if (!running || disposed) return
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.05) dt = 0.05
      if (dt <= 0) dt = 1 / 120
      render(dt)
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
      if (oldW > 0 && oldH > 0) {
        disc.x = (disc.x / oldW) * w
        disc.y = (disc.y / oldH) * h
      } else {
        disc.x = w * 0.5
        disc.y = h * 0.46
      }
      ghost.x = disc.x
      ghost.y = disc.y
      buildGratings()
      buildChrome()
      if (!running) render(0) // 冻结时也立即重绘一帧
    }

    // ---------- 指针 ----------
    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onDisc = (x: number, y: number) => Math.hypot(x - disc.x, y - disc.y) < discD / 2 + 12

    const onPointerDown = (e: PointerEvent) => {
      initAudio()
      const p = toLocal(e)
      ptr.x = p.x
      ptr.y = p.y
      ptr.px = p.x
      ptr.py = p.y
      drag.startX = p.x
      drag.startY = p.y
      drag.t0 = performance.now()
      drag.moved = 0
      if (onDisc(p.x, p.y)) {
        drag.active = true
        drag.ox = disc.x - p.x
        drag.oy = disc.y - p.y
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
        canvas.style.cursor = 'grabbing'
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      const p = toLocal(e)
      ptr.x = p.x
      ptr.y = p.y
      drag.moved = Math.max(drag.moved, Math.hypot(p.x - drag.startX, p.y - drag.startY))
      if (!drag.active) {
        canvas.style.cursor = onDisc(p.x, p.y) ? 'grab' : 'pointer'
      }
    }
    const onPointerUp = () => {
      const dur = performance.now() - drag.t0
      drag.active = false
      // 轻点（<300ms 且 <9px 位移）→ 切换纹样 + 快门扫过
      if (drag.moved < 9 && dur < 300) {
        pattern = (pattern + 1) % 3
        buildGratings()
        updatePatternLabel()
        shutter = 0
        blip()
      }
      canvas.style.cursor = onDisc(ptr.x, ptr.y) ? 'grab' : 'pointer'
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()
    updatePatternLabel()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)

    const unsubMute = useBookStore.subscribe((s) => {
      muted = s.muted
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.05)
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
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
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
    <div ref={rootRef} className="absolute inset-0 overflow-hidden" style={{ background: CREAM }}>
      {/* 左缘巨型竖排幽灵字（canvas 之下，6% 墨） */}
      <div
        className="pointer-events-none absolute select-none"
        style={{
          left: '1.5%',
          top: '50%',
          transform: 'translateY(-50%) rotate(180deg)',
          writingMode: 'vertical-rl',
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(44px, 30cqh, 360px)',
          lineHeight: 1,
          letterSpacing: '0.01em',
          color: 'rgba(20,20,20,0.06)',
        }}
      >
        MOIRÉ
      </div>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ display: 'block', touchAction: 'none', cursor: 'pointer' }}
      />

      {/* 左上角研究标注 + 纹样标签（朱红强调） */}
      <div className="pointer-events-none absolute z-10" style={{ left: '13%', top: '8%' }}>
        <div
          className="font-attitude"
          style={{ fontSize: 'clamp(9px, 1.8cqw, 13px)', letterSpacing: '0.42em', color: 'rgba(20,20,20,0.72)' }}
        >
          MOIRÉ
          <span className="font-cn" style={{ letterSpacing: '0.3em', margin: '0 0 0 0.8em' }}>
            · 干涉
          </span>
        </div>
        <div
          ref={patternLabelRef}
          className="font-cn"
          style={{
            fontSize: 'clamp(7px, 1.35cqw, 11px)',
            letterSpacing: '0.34em',
            color: RED,
            marginTop: '0.9cqh',
          }}
        >
          纹样 1 / 3 — 同心圆 CONCENTRIC
        </div>
      </div>

      {/* 右上角编号 */}
      <div
        className="font-attitude pointer-events-none absolute z-10"
        style={{ right: '13%', top: '8%', fontSize: 'clamp(7px, 1.3cqw, 10px)', letterSpacing: '0.3em', color: 'rgba(20,20,20,0.34)' }}
      >
        OPTICAL STUDY N°05
      </div>

      {/* 右下角图注（朱红） */}
      <div
        className="font-attitude pointer-events-none absolute z-10"
        style={{
          right: '13%',
          bottom: '10.5%',
          fontSize: 'clamp(6px, 1.15cqw, 9px)',
          letterSpacing: '0.26em',
          color: RED,
          opacity: 0.85,
        }}
      >
        FIG. 05 — OPTICAL SUPERPOSITION
      </div>

      {/* 底部提示 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[3.5%] z-10 flex flex-col items-center">
        <div
          className="font-cn"
          style={{
            fontSize: 'clamp(7px, 1.3cqw, 10px)',
            letterSpacing: '0.42em',
            color: 'rgba(20,20,20,0.44)',
          }}
        >
          拖动 / 甩动圆盘 · 点击切换纹样
        </div>
      </div>
    </div>
  )
}
