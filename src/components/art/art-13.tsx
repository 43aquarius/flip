'use client'

import { useEffect, useRef } from 'react'
import type { ArtPageProps } from './types'

/* ═══════════════════════════════════════════════════════
   ROOM 13 · MANDELBROT 无限海岸
   可以无限下潜的分形海岸。纯黑底 + 黑→橙→金→白→黑
   循环调色板（平滑迭代上色）。
   点击 = 以点击点为中心放大 2 倍；拖动 = 平移；
   右上按钮：重置 / 景点 / 放大 / 缩小。
   1/2~1/3 分辨率逐行渐进渲染（渲染中可随时打断），
   缩放时旧帧 CSS scale 过渡 + 完成后交叉溶解。
   ═══════════════════════════════════════════════════════ */

const BG = '#000000'
/** zoom=1 时可视复平面高度 */
const BASE_H = 2.9
const ZOOM_MAX = 1e12

interface View {
  cx: number
  cy: number
  zoom: number
}

interface Task {
  token: number
  view: View
  iter: number
  y: number
  img: ImageData
  done: boolean
}

const DEFAULT_VIEW: View = { cx: -0.6, cy: 0, zoom: 1 }

const SPOTS: Array<{ name: string; v: View }> = [
  { name: '海马谷 SEAHORSE VALLEY', v: { cx: -0.743643887037, cy: 0.1318252536, zoom: 3000 } },
  { name: '大象谷 ELEPHANT VALLEY', v: { cx: 0.2925755, cy: 0.0149977, zoom: 280 } },
  { name: '螺旋区 SPIRAL FIELD', v: { cx: -0.7269, cy: 0.1889, zoom: 9000 } },
  { name: '飞机岛 PERIOD-3 ISLE', v: { cx: -1.7548776662, cy: 0, zoom: 1500 } },
]

/** 黑 → umber → 橙 → 金 → 白热 → 回黑的循环调色板 LUT */
function buildLUT(): Uint8ClampedArray {
  const stops: Array<[number, number, number, number]> = [
    [0.0, 4, 2, 1],
    [0.08, 42, 13, 4],
    [0.18, 138, 42, 8],
    [0.3, 255, 107, 26],
    [0.44, 255, 210, 63],
    [0.55, 255, 248, 232],
    [0.66, 255, 168, 60],
    [0.8, 148, 47, 10],
    [0.9, 42, 13, 4],
    [1.0, 4, 2, 1],
  ]
  const lut = new Uint8ClampedArray(2048 * 3)
  for (let i = 0; i < 2048; i++) {
    const t = i / 2047
    let s0 = stops[0]
    let s1 = stops[stops.length - 1]
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k][0] && t <= stops[k + 1][0]) {
        s0 = stops[k]
        s1 = stops[k + 1]
        break
      }
    }
    const u = (t - s0[0]) / Math.max(1e-9, s1[0] - s0[0])
    lut[i * 3] = s0[1] + (s1[1] - s0[1]) * u
    lut[i * 3 + 1] = s0[2] + (s1[2] - s0[2]) * u
    lut[i * 3 + 2] = s0[3] + (s1[3] - s0[3]) * u
  }
  return lut
}
const LUT = buildLUT()

function fmtZoom(z: number): string {
  if (z < 100) return `×${Math.round(z)}`
  return `×${z.toExponential(1).replace('e+', 'e')}`
}

interface World {
  w: number
  h: number
  cw: number
  ch: number
  rw: number
  rh: number
  factor: number
  view: View
  task: Task | null
  token: number
  hasCommitted: boolean
  fxActive: boolean
  drag: { x0: number; y0: number; dx: number; dy: number; moved: boolean } | null
  spotIdx: number
  raf: number
  last: number
  t: number
  breathe: number
  timers: Array<ReturnType<typeof setTimeout>>
  syncTimer: ReturnType<typeof setTimeout> | null
}

export default function Art13({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fxRef = useRef<HTMLCanvasElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)
  const toastRef = useRef<HTMLDivElement | null>(null)
  const flashRef = useRef<HTMLDivElement | null>(null)
  const warpRef = useRef<HTMLDivElement | null>(null)

  const W = useRef<World>({
    w: 0, h: 0, cw: 0, ch: 0, rw: 0, rh: 0, factor: 3,
    view: { ...DEFAULT_VIEW },
    task: null,
    token: 0,
    hasCommitted: false,
    fxActive: false,
    drag: null,
    spotIdx: 0,
    raf: 0,
    last: 0,
    t: 0,
    breathe: 0,
    timers: [],
    syncTimer: null,
  })

  /** 供 JSX 按钮 / 指针调用的 API（在 effect 内装配） */
  const api = useRef<{
    zoomAt?: (px: number, py: number, f: number) => void
    warpTo?: (v: View) => void
    reset?: () => void
    nextSpot?: () => void
    panStart?: (px: number, py: number) => void
    panMove?: (px: number, py: number) => void
    panEnd?: (px: number, py: number) => void
  }>({})

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    api.current.panStart?.(e.clientX - rect.left, e.clientY - rect.top)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    api.current.panMove?.(e.clientX - rect.left, e.clientY - rect.top)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    api.current.panEnd?.(e.clientX - rect.left, e.clientY - rect.top)
  }

  useEffect(() => {
    const w = W.current
    const root = rootRef.current
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    const fxc = fxRef.current
    if (!root || !wrap || !canvas || !fxc) return
    const actx = canvas.getContext('2d')
    const bctx = fxc.getContext('2d')
    if (!actx || !bctx) return
    // 离屏：渲染缓冲 O + 已完成帧快照 C
    const oc = document.createElement('canvas')
    const octx = oc.getContext('2d')
    const cc = document.createElement('canvas')
    const cctx = cc.getContext('2d')
    if (!octx || !cctx) return

    /* ---------- 渲染一行（复平面 → 逃逸时间 → LUT） ---------- */
    const renderRow = (task: Task) => {
      const { img, view, iter } = task
      const rw = w.rw
      const rh = w.rh
      const j = task.y
      if (j >= rh) return
      const ppp = BASE_H / (view.zoom * w.h)
      const data = img.data
      const rowOff = j * rw * 4
      const scale = w.factor
      const y0 = view.cy + (w.h / 2 - (j * scale + scale / 2)) * ppp
      let x0 = view.cx + (scale / 2 - w.w / 2) * ppp
      const dC = scale * ppp
      for (let i = 0; i < rw; i++, x0 += dC) {
        const o = rowOff + i * 4
        // 主心形 / 周期 2 圆盘内点判定（免迭代）
        const xm = x0 - 0.25
        const q = xm * xm + y0 * y0
        if (q * (q + xm) <= 0.25 * y0 * y0 || (x0 + 1) * (x0 + 1) + y0 * y0 <= 0.0625) {
          data[o] = 0
          data[o + 1] = 0
          data[o + 2] = 0
          data[o + 3] = 255
          continue
        }
        let zr = 0
        let zi = 0
        let zr2 = 0
        let zi2 = 0
        let n = 0
        while (n < iter && zr2 + zi2 <= 1024) {
          zi = 2 * zr * zi + y0
          zr = zr2 - zi2 + x0
          zr2 = zr * zr
          zi2 = zi * zi
          n++
        }
        if (n >= iter) {
          data[o] = 0
          data[o + 1] = 0
          data[o + 2] = 0
          data[o + 3] = 255
          continue
        }
        // 平滑迭代计数
        const l2 = Math.log(zr2 + zi2) / Math.LN2
        const mu = n + 2 - Math.log2(l2)
        let tt = (mu * 0.045) % 1
        if (tt < 0) tt += 1
        const li = (tt * 2047) | 0
        data[o] = LUT[li * 3]
        data[o + 1] = LUT[li * 3 + 1]
        data[o + 2] = LUT[li * 3 + 2]
        data[o + 3] = 255
      }
      task.y++
    }

    const blit = () => {
      actx.setTransform(1, 0, 0, 1, 0, 0)
      actx.imageSmoothingEnabled = false
      actx.clearRect(0, 0, w.cw, w.ch)
      actx.drawImage(oc, 0, 0, w.rw, w.rh, 0, 0, w.cw, w.ch)
    }

    const setProgress = (p: number, done: boolean) => {
      const el = progressRef.current
      if (!el) return
      el.style.transform = `scaleX(${Math.max(0.005, Math.min(1, p)).toFixed(4)})`
      el.style.opacity = done ? '0' : '1'
    }

    const flash = () => {
      const el = flashRef.current
      if (!el) return
      el.style.transition = 'none'
      el.style.opacity = '0.16'
      void el.offsetWidth
      el.style.transition = 'opacity 340ms ease-out'
      el.style.opacity = '0'
    }

    const finishTask = (withFlash: boolean) => {
      // 提交快照
      cctx.setTransform(1, 0, 0, 1, 0, 0)
      cctx.clearRect(0, 0, w.cw, w.ch)
      cctx.drawImage(canvas, 0, 0)
      w.hasCommitted = true
      setProgress(1, true)
      if (w.fxActive) {
        w.fxActive = false
        fxc.style.transition = 'opacity 280ms ease'
        fxc.style.opacity = '0'
        const t = setTimeout(() => {
          fxc.style.transition = 'none'
          fxc.style.transform = 'none'
          void fxc.offsetWidth
          fxc.style.transition = ''
        }, 320)
        w.timers.push(t)
        if (withFlash) flash()
      }
    }

    /* ---------- 启动渲染任务 ---------- */
    const startTask = (view: View) => {
      if (w.syncTimer) {
        clearTimeout(w.syncTimer)
        w.syncTimer = null
      }
      w.view = view
      w.token++
      const iter = Math.round(Math.min(800, 120 + 60 * Math.log2(view.zoom + 1)))
      const img = octx.createImageData(w.rw, w.rh)
      w.task = { token: w.token, view, iter, y: 0, img, done: false }
      octx.clearRect(0, 0, w.rw, w.rh)
      blit()
      setProgress(0, false)
      if (statusRef.current) {
        statusRef.current.textContent = `${fmtZoom(view.zoom)} · ITER ${iter}`
      }
      if (!active) pumpSync()
    }

    /** 未激活时用 setTimeout 分块同步渲染（邻居页也能看到成品帧） */
    const pumpSync = () => {
      const pump = () => {
        const task = w.task
        if (!task || task.done) return
        const t0 = performance.now()
        const start = task.y
        while (task.y < w.rh && performance.now() - t0 < 28) renderRow(task)
        if (task.y > start) {
          octx.putImageData(task.img, 0, 0, 0, start, w.rw, task.y - start)
          blit()
          setProgress(task.y / w.rh, false)
        }
        if (task.y >= w.rh) {
          task.done = true
          finishTask(false)
        } else {
          w.syncTimer = setTimeout(pump, 0)
        }
      }
      w.syncTimer = setTimeout(pump, 0)
    }

    /* ---------- 缩放（旧帧 CSS 过渡 + 新帧渐进） ---------- */
    const zoomAt = (px: number, py: number, f: number) => {
      const view = w.view
      const nz = view.zoom * f
      if (nz > ZOOM_MAX) {
        const el = statusRef.current
        if (el) {
          el.textContent = '深度极限 DEPTH LIMIT'
          el.style.color = '#ffd23f'
          const t = setTimeout(() => {
            el.style.color = ''
            el.textContent = `${fmtZoom(view.zoom)} · ITER ${w.task ? w.task.iter : 120}`
          }, 1400)
          w.timers.push(t)
        }
        return
      }
      const ppp = BASE_H / (view.zoom * w.h)
      const nv: View = {
        cx: view.cx + (px - w.w / 2) * ppp * (1 - 1 / f),
        cy: view.cy + (w.h / 2 - py) * ppp * (1 - 1 / f),
        zoom: Math.max(0.6, nz),
      }
      if (w.hasCommitted) {
        // 旧帧拷贝到 fx 层并做 scale 过渡
        bctx.setTransform(1, 0, 0, 1, 0, 0)
        bctx.clearRect(0, 0, w.cw, w.ch)
        bctx.drawImage(cc, 0, 0)
        fxc.style.transition = 'none'
        fxc.style.opacity = '1'
        fxc.style.transform = 'none'
        void fxc.offsetWidth
        fxc.style.transformOrigin = `${px}px ${py}px`
        fxc.style.transition = 'transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)'
        fxc.style.transform = `scale(${f})`
        w.fxActive = true
      }
      startTask(nv)
    }

    /* ---------- 景点跃迁（黑场 warp） ---------- */
    const warpTo = (v: View, name?: string) => {
      const warpEl = warpRef.current
      const toast = toastRef.current
      if (warpEl) {
        warpEl.style.transition = 'opacity 160ms ease'
        warpEl.style.opacity = '1'
      }
      const t1 = setTimeout(() => {
        canvas.style.transition = 'none'
        canvas.style.transform = 'none'
        fxc.style.transition = 'none'
        fxc.style.opacity = '0'
        fxc.style.transform = 'none'
        w.fxActive = false
        startTask(v)
        if (toast && name) {
          toast.textContent = name
          toast.style.transition = 'none'
          toast.style.opacity = '1'
          void toast.offsetWidth
          toast.style.transition = 'opacity 1.6s ease 0.9s'
          toast.style.opacity = '0'
        }
        const t2 = setTimeout(() => {
          if (warpEl) {
            warpEl.style.transition = 'opacity 420ms ease'
            warpEl.style.opacity = '0'
          }
        }, 180)
        w.timers.push(t2)
      }, 180)
      w.timers.push(t1)
    }

    /* ---------- 尺寸自适应 ---------- */
    const resize = () => {
      const cw = root.clientWidth
      const chh = root.clientHeight
      if (cw < 40 || chh < 40) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const devW = Math.round(cw * dpr)
      const devH = Math.round(chh * dpr)
      canvas.width = devW
      canvas.height = devH
      fxc.width = devW
      fxc.height = devH
      cc.width = devW
      cc.height = devH
      const factor = cw < 560 ? 2 : 3
      w.w = cw
      w.h = chh
      w.cw = devW
      w.ch = devH
      w.factor = factor
      w.rw = Math.max(8, Math.ceil(cw / factor))
      w.rh = Math.max(8, Math.ceil(chh / factor))
      oc.width = w.rw
      oc.height = w.rh
      w.hasCommitted = false
      w.fxActive = false
      fxc.style.opacity = '0'
      fxc.style.transform = 'none'
      canvas.style.transform = 'none'
      startTask(w.view)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()

    /* ---------- 主循环：渐进渲染 + 呼吸 ---------- */
    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - w.last) / 1000))
      w.last = now
      w.t += dt
      const task = w.task
      if (task && !task.done) {
        const t0 = performance.now()
        const start = task.y
        while (task.y < w.rh && performance.now() - t0 < 7) renderRow(task)
        if (task.y > start) {
          octx.putImageData(task.img, 0, 0, 0, start, w.rw, task.y - start)
          blit()
        }
        if (task.y >= w.rh) {
          task.done = true
          finishTask(true)
        } else {
          setProgress(task.y / w.rh, false)
        }
      }
      // 静止时的呼吸（极缓慢的缩放起伏）
      const want = task && !task.done ? 0 : 1
      w.breathe += (want - w.breathe) * Math.min(1, dt * 1.6)
      if (w.breathe > 0.002) {
        const s = 1 + 0.0045 * Math.sin(w.t * 0.55) * w.breathe
        wrap.style.transform = `scale(${s.toFixed(5)})`
      } else if (wrap.style.transform !== 'none') {
        wrap.style.transform = 'none'
      }
      w.raf = requestAnimationFrame(step)
    }

    /* ---------- 装配 API ---------- */
    api.current.panStart = (px, py) => {
      // 打断当前渲染，回退到最后完成帧
      if (w.syncTimer) {
        clearTimeout(w.syncTimer)
        w.syncTimer = null
      }
      w.task = null
      setProgress(0, true)
      if (w.hasCommitted) {
        actx.setTransform(1, 0, 0, 1, 0, 0)
        actx.imageSmoothingEnabled = false
        actx.clearRect(0, 0, w.cw, w.ch)
        actx.drawImage(cc, 0, 0)
      }
      w.drag = { x0: px, y0: py, dx: 0, dy: 0, moved: false }
    }
    api.current.panMove = (px, py) => {
      const d = w.drag
      if (!d) return
      d.dx = px - d.x0
      d.dy = py - d.y0
      if (!d.moved && Math.hypot(d.dx, d.dy) > 6) d.moved = true
      if (d.moved) {
        canvas.style.transition = 'none'
        canvas.style.transform = `translate(${d.dx.toFixed(1)}px, ${d.dy.toFixed(1)}px)`
      }
    }
    api.current.panEnd = (px, py) => {
      const d = w.drag
      w.drag = null
      if (!d) return
      if (!d.moved) {
        zoomAt(px, py, 2)
        return
      }
      const ppp = BASE_H / (w.view.zoom * w.h)
      const nv: View = {
        cx: w.view.cx - d.dx * ppp,
        cy: w.view.cy + d.dy * ppp,
        zoom: w.view.zoom,
      }
      canvas.style.transition = 'none'
      canvas.style.transform = 'none'
      startTask(nv)
    }
    api.current.zoomAt = zoomAt
    api.current.warpTo = warpTo
    api.current.reset = () => warpTo({ ...DEFAULT_VIEW })
    api.current.nextSpot = () => {
      w.spotIdx = (w.spotIdx + 1) % SPOTS.length
      const s = SPOTS[w.spotIdx]
      warpTo({ ...s.v }, s.name)
    }

    if (active) {
      w.last = performance.now()
      w.raf = requestAnimationFrame(step)
    }

    return () => {
      cancelAnimationFrame(w.raf)
      ro.disconnect()
      for (const t of w.timers) clearTimeout(t)
      w.timers = []
      if (w.syncTimer) clearTimeout(w.syncTimer)
      api.current = {}
    }
  }, [active])

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: BG, touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* 呼吸包装层 */}
      <div ref={wrapRef} className="absolute inset-0" style={{ willChange: 'transform' }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <canvas
          ref={fxRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ opacity: 0 }}
        />
      </div>
      {/* 完成闪白 */}
      <div
        ref={flashRef}
        className="pointer-events-none absolute inset-0"
        style={{ background: '#fff8e8', opacity: 0 }}
      />
      {/* warp 黑场 */}
      <div
        ref={warpRef}
        className="pointer-events-none absolute inset-0"
        style={{ background: '#000', opacity: 0 }}
      />
      {/* 渲染进度 */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: '30%',
          width: '40%',
          top: '3%',
          height: 2,
          background: 'rgba(255,107,26,0.18)',
          opacity: 0,
          transition: 'opacity 0.3s ease',
        }}
      >
        <div
          ref={progressRef}
          style={{
            width: '100%',
            height: '100%',
            background: '#ff6b1a',
            transformOrigin: 'left',
            transform: 'scaleX(0)',
          }}
        />
      </div>
      {/* 景点名 */}
      <div
        ref={toastRef}
        className="font-attitude pointer-events-none absolute"
        style={{
          left: '50%',
          top: '6%',
          transform: 'translateX(-50%)',
          fontSize: '1.4cqw',
          letterSpacing: '0.34em',
          color: '#ffd23f',
          opacity: 0,
          whiteSpace: 'nowrap',
        }}
      />
      {/* 署名 + 读数（左上角，避开底部页码徽章与两侧热区） */}
      <div className="pointer-events-none absolute" style={{ left: '11.5%', top: '5%' }}>
        <div
          className="font-attitude"
          style={{ fontSize: '1.35cqw', letterSpacing: '0.3em', color: '#ff6b1a' }}
        >
          MANDELBROT · <span className="font-cn">无限海岸</span>
        </div>
        <div
          className="font-cn"
          style={{
            fontSize: '1.1cqw',
            letterSpacing: '0.26em',
            color: 'rgba(255,150,80,0.62)',
            marginTop: '0.6cqh',
          }}
        >
          点击缩放 · 拖拽平移
        </div>
        <div
          className="font-attitude"
          ref={statusRef}
          style={{
            fontSize: '1.15cqw',
            letterSpacing: '0.2em',
            color: 'rgba(255,210,63,0.85)',
            marginTop: '0.9cqh',
          }}
        >
          ×1 · ITER 120
        </div>
      </div>
      {/* 控制按钮（右上角内缩） */}
      <div
        className="absolute flex items-center gap-[0.7cqw]"
        style={{ right: '11.5%', top: '5%' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="font-cn"
          onClick={() => api.current.reset?.()}
          style={{
            fontSize: '1.25cqw',
            letterSpacing: '0.22em',
            color: '#ff8a3d',
            border: '1px solid rgba(255,107,26,0.55)',
            background: 'rgba(0,0,0,0.62)',
            padding: '0.8cqh 1.4cqw',
            cursor: 'pointer',
          }}
        >
          重置
        </button>
        <button
          type="button"
          className="font-cn"
          onClick={() => api.current.nextSpot?.()}
          style={{
            fontSize: '1.25cqw',
            letterSpacing: '0.22em',
            color: '#ffd23f',
            border: '1px solid rgba(255,210,63,0.55)',
            background: 'rgba(0,0,0,0.62)',
            padding: '0.8cqh 1.4cqw',
            cursor: 'pointer',
          }}
        >
          景点
        </button>
        <button
          type="button"
          className="font-attitude"
          onClick={() => api.current.zoomAt?.(W.current.w / 2, W.current.h / 2, 2)}
          style={{
            fontSize: '1.5cqw',
            color: '#ff8a3d',
            border: '1px solid rgba(255,107,26,0.55)',
            background: 'rgba(0,0,0,0.62)',
            padding: '0.55cqh 1.3cqw',
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          +
        </button>
        <button
          type="button"
          className="font-attitude"
          onClick={() => api.current.zoomAt?.(W.current.w / 2, W.current.h / 2, 0.5)}
          style={{
            fontSize: '1.5cqw',
            color: '#ff8a3d',
            border: '1px solid rgba(255,107,26,0.55)',
            background: 'rgba(0,0,0,0.62)',
            padding: '0.55cqh 1.3cqw',
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          –
        </button>
      </div>
    </div>
  )
}
