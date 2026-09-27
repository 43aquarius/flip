'use client'

import { useEffect, useRef, useState } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/**
 * ROOM 19 · VOICEPRINT 声纹
 * 一台特雷门琴的示波器。指针 X=音高（连续滑音，量化到 A3 起的大调五声音阶，
 * 跨约 2.5 个八度）、Y=音量与滤波亮度。主 sine + 高八度副 sine 轻混 + 5Hz 颤音
 * （深度随按住时长渐增，出“人声感”），过 lowpass。
 * 视觉：全页示波器（琥珀辉光波形）+ 向下缓慢滚动的“声纹”条带（心电图纸）。
 * 静音时无声，示波器显示一条平线（仍可视觉演奏）。
 */

const BG = '#0a0a0a'
const AMBER = '#ffd23f'
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28]
const NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']
const WAVE_PTS = 256

function noteName(semi: number): string {
  const idx = ((semi % 12) + 12) % 12
  const octave = 3 + Math.floor((semi + 9) / 12)
  return `${NOTE_NAMES[idx]}${octave}`
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

interface AudioRig {
  ctx: AudioContext
  osc: OscillatorNode
  sub: OscillatorNode
  subGain: GainNode
  lfo: OscillatorNode
  lfoGain: GainNode
  filter: BiquadFilterNode
  master: GainNode
  analyser: AnalyserNode
}

interface VoiceState {
  raf: number
  w: number
  h: number
  dpr: number
  histCv: HTMLCanvasElement | null
  hist: CanvasRenderingContext2D | null
  scope: CanvasRenderingContext2D | null
  buf: Float32Array<ArrayBuffer>
  scrollAcc: number
  lastT: number
  rig: AudioRig | null
  px: number
  py: number
  inside: boolean
  hold: number
  lastDepth: number
  noteIdx: number
  freq: number
  noteText: string
  loop: () => void
  drawFrame: (dt: number) => void
  ensureRig: () => void
  applyPointer: () => void
  release: () => void
}

export default function Art19({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const histRef = useRef<HTMLCanvasElement | null>(null)
  const scopeRef = useRef<HTMLCanvasElement | null>(null)
  const hintRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLDivElement | null>(null)
  const noteRef = useRef<HTMLDivElement | null>(null)
  const hzRef = useRef<HTMLDivElement | null>(null)
  const [touched, setTouched] = useState(false)

  const muted = useBookStore((s) => s.muted)
  const mutedRef = useRef(muted)

  const stRef = useRef<VoiceState>({
    raf: 0,
    w: 0,
    h: 0,
    dpr: 1,
    histCv: null,
    hist: null,
    scope: null,
    buf: new Float32Array(2048),
    scrollAcc: 0,
    lastT: 0,
    rig: null,
    px: 0,
    py: 0,
    inside: false,
    hold: 0,
    lastDepth: 0,
    noteIdx: 0,
    freq: 220,
    noteText: '',
    loop: () => {},
    drawFrame: () => {},
    ensureRig: () => {},
    applyPointer: () => {},
    release: () => {},
  })

  useEffect(() => {
    const root = rootRef.current
    const histCv = histRef.current
    const scopeCv = scopeRef.current
    if (!root || !histCv || !scopeCv) return
    const st = stRef.current
    st.histCv = histCv

    const sizeCanvases = (): void => {
      const rect = root.getBoundingClientRect()
      st.dpr = Math.min(window.devicePixelRatio || 1, 2)
      st.w = Math.max(1, rect.width)
      st.h = Math.max(1, rect.height)
      for (const cv of [histCv, scopeCv]) {
        cv.width = Math.round(st.w * st.dpr)
        cv.height = Math.round(st.h * st.dpr)
      }
      st.hist?.setTransform(st.dpr, 0, 0, st.dpr, 0, 0)
      st.scope?.setTransform(st.dpr, 0, 0, st.dpr, 0, 0)
    }

    st.ensureRig = (): void => {
      if (st.rig) {
        if (st.rig.ctx.state === 'suspended') void st.rig.ctx.resume()
        return
      }
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        const ctx = new AC()
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = 220
        const sub = ctx.createOscillator()
        sub.type = 'sine'
        sub.frequency.value = 440
        const subGain = ctx.createGain()
        subGain.gain.value = 0.16
        const filter = ctx.createBiquadFilter()
        filter.type = 'lowpass'
        filter.frequency.value = 900
        filter.Q.value = 1.1
        const master = ctx.createGain()
        master.gain.value = 0.0001
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.55
        const lfo = ctx.createOscillator()
        lfo.type = 'sine'
        lfo.frequency.value = 5
        const lfoGain = ctx.createGain()
        lfoGain.gain.value = 0
        lfo.connect(lfoGain)
        lfoGain.connect(osc.detune)
        lfoGain.connect(sub.detune)
        osc.connect(filter)
        sub.connect(subGain)
        subGain.connect(filter)
        filter.connect(master)
        master.connect(analyser)
        analyser.connect(ctx.destination)
        osc.start()
        sub.start()
        lfo.start()
        st.rig = { ctx, osc, sub, subGain, lfo, lfoGain, filter, master, analyser }
      } catch {
        /* 无音频则纯视觉演奏 */
      }
    }

    st.applyPointer = (): void => {
      const xN = clamp01((st.px - st.w * 0.12) / (st.w * 0.76))
      const yN = clamp01((st.h * 0.86 - st.py) / (st.h * 0.72))
      st.noteIdx = Math.round(xN * (SCALE.length - 1))
      const semi = SCALE[st.noteIdx]
      st.freq = 220 * Math.pow(2, semi / 12)
      const rig = st.rig
      if (!rig || mutedRef.current) return
      const t = rig.ctx.currentTime
      rig.osc.frequency.setTargetAtTime(st.freq, t, 0.03)
      rig.sub.frequency.setTargetAtTime(st.freq * 2, t, 0.03)
      rig.filter.frequency.setTargetAtTime(260 * Math.pow(22, yN), t, 0.05)
      rig.master.gain.setTargetAtTime(0.1 + 0.34 * yN, t, 0.09)
    }

    st.release = (): void => {
      st.inside = false
      st.hold = 0
      st.lastDepth = -1
      const rig = st.rig
      if (!rig) return
      const t = rig.ctx.currentTime
      rig.master.gain.setTargetAtTime(0.0001, t, 0.18) // 0.6s 内淡出
      rig.lfoGain.gain.setTargetAtTime(0, t, 0.3)
    }

    st.drawFrame = (dt: number): void => {
      const sc = st.scope
      const hc = st.hist
      if (!sc || !hc || !st.histCv) return
      const cy = st.h * 0.42
      const amp = st.h * 0.17

      // 读波形
      let peak = 0
      if (st.rig) {
        st.rig.analyser.getFloatTimeDomainData(st.buf)
        for (let i = 0; i < WAVE_PTS; i++) {
          const v = Math.abs(st.buf[i * 8])
          if (v > peak) peak = v
        }
      }

      // 颤音深度随按住时长渐增（人声感）
      if (dt > 0 && st.inside && st.rig) {
        st.hold += dt
        const depth = Math.min(16, st.hold * 5)
        if (Math.abs(depth - st.lastDepth) > 0.8) {
          st.lastDepth = depth
          st.rig.lfoGain.gain.setTargetAtTime(depth, st.rig.ctx.currentTime, 0.25)
        }
      }

      // ---- 声纹条带：整幅向下缓慢滚动 + 微褪 ----
      if (dt > 0) {
        st.scrollAcc += dt * 30
        const shift = Math.floor(st.scrollAcc)
        if (shift >= 1) {
          st.scrollAcc -= shift
          hc.drawImage(st.histCv, 0, shift, st.w, st.h)
          hc.clearRect(0, 0, st.w, shift)
        }
        hc.globalCompositeOperation = 'destination-out'
        hc.fillStyle = 'rgba(0,0,0,0.02)'
        hc.fillRect(0, 0, st.w, st.h)
        hc.globalCompositeOperation = 'source-over'
        if (peak > 0.006) {
          hc.strokeStyle = 'rgba(255,210,63,0.3)'
          hc.lineWidth = 1.1
          hc.beginPath()
          for (let i = 0; i < WAVE_PTS; i++) {
            const x = (i / (WAVE_PTS - 1)) * st.w
            const y = cy + st.buf[i * 8] * amp
            if (i === 0) hc.moveTo(x, y)
            else hc.lineTo(x, y)
          }
          hc.stroke()
        }
      }

      // ---- 示波器主层 ----
      sc.clearRect(0, 0, st.w, st.h)
      const now = performance.now()
      const silent = peak < 0.004
      // 中轴基线（静默时微微呼吸）
      sc.strokeStyle = `rgba(255,210,63,${silent ? (0.1 + 0.05 * Math.sin(now * 0.0013)).toFixed(3) : '0.12'})`
      sc.lineWidth = 1
      sc.beginPath()
      sc.moveTo(0, cy)
      sc.lineTo(st.w, cy)
      sc.stroke()
      // 波形（辉光 + 亮芯两遍）
      sc.beginPath()
      for (let i = 0; i < WAVE_PTS; i++) {
        const x = (i / (WAVE_PTS - 1)) * st.w
        const y = cy + st.buf[i * 8] * amp
        if (i === 0) sc.moveTo(x, y)
        else sc.lineTo(x, y)
      }
      sc.save()
      sc.shadowColor = 'rgba(255,210,63,0.75)'
      sc.shadowBlur = 16
      sc.strokeStyle = AMBER
      sc.lineWidth = 2.4
      sc.stroke()
      sc.restore()
      sc.strokeStyle = '#ffe796'
      sc.lineWidth = 1.1
      sc.stroke()

      // 十字准线
      if (st.inside) {
        sc.strokeStyle = 'rgba(255,210,63,0.3)'
        sc.lineWidth = 1
        sc.beginPath()
        sc.moveTo(st.px, 0)
        sc.lineTo(st.px, st.h)
        sc.moveTo(0, st.py)
        sc.lineTo(st.w, st.py)
        sc.stroke()
        sc.beginPath()
        sc.arc(st.px, st.py, 11, 0, Math.PI * 2)
        sc.stroke()
      }

      // 音名大字
      const label = labelRef.current
      if (label) {
        label.style.opacity = st.inside ? '1' : '0'
        if (st.inside) {
          const lx = st.px + 22 + 170 > st.w ? Math.max(8, st.px - 192) : st.px + 22
          const ly = Math.min(st.h - 96, st.py + 20)
          label.style.transform = `translate3d(${Math.round(lx)}px, ${Math.round(ly)}px, 0)`
          const txt = noteName(SCALE[st.noteIdx])
          if (txt !== st.noteText) {
            st.noteText = txt
            if (noteRef.current) noteRef.current.textContent = txt
            if (hzRef.current) hzRef.current.textContent = `${Math.round(st.freq)} HZ`
          }
        }
      }

      // 首次提示呼吸
      const hint = hintRef.current
      if (hint) {
        hint.style.opacity = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now * 0.0024))).toFixed(3)
      }
    }

    st.loop = (): void => {
      st.raf = requestAnimationFrame(st.loop)
      const now = performance.now()
      const dt = Math.min(0.05, (now - st.lastT) / 1000)
      st.lastT = now
      st.drawFrame(dt)
    }

    sizeCanvases()
    st.lastT = performance.now()
    st.drawFrame(0)

    // ---- 指针 = 演奏 ----
    const toLocal = (e: PointerEvent): void => {
      const r = root.getBoundingClientRect()
      st.px = e.clientX - r.left
      st.py = e.clientY - r.top
    }
    const onEnter = (e: PointerEvent): void => {
      toLocal(e)
      st.inside = true
    }
    const onMove = (e: PointerEvent): void => {
      toLocal(e)
      const was = st.inside
      st.inside = true
      if (st.rig && st.rig.ctx.state === 'suspended') void st.rig.ctx.resume()
      st.applyPointer()
      if (!was) setTouched(true)
    }
    const onDown = (e: PointerEvent): void => {
      toLocal(e)
      st.ensureRig()
      st.inside = true
      st.hold = 0
      setTouched(true)
      st.applyPointer()
    }
    const onLeave = (): void => {
      st.release()
    }
    root.addEventListener('pointerenter', onEnter)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointerleave', onLeave)

    const ro = new ResizeObserver(() => {
      sizeCanvases()
      st.drawFrame(0)
    })
    ro.observe(root)

    return () => {
      cancelAnimationFrame(st.raf)
      ro.disconnect()
      root.removeEventListener('pointerenter', onEnter)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointerleave', onLeave)
      const rig = st.rig
      if (rig) {
        try {
          rig.osc.stop()
          rig.sub.stop()
          rig.lfo.stop()
        } catch {
          /* 已停止 */
        }
        void rig.ctx.close()
        st.rig = null
      }
    }
  }, [])

  // 全局静音联动
  useEffect(() => {
    mutedRef.current = muted
    const st = stRef.current
    const rig = st.rig
    if (!rig) return
    if (muted) {
      rig.master.gain.setTargetAtTime(0.0001, rig.ctx.currentTime, 0.05)
    } else if (st.inside) {
      st.applyPointer()
    }
  }, [muted])

  useEffect(() => {
    const st = stRef.current
    if (active) {
      st.lastT = performance.now()
      if (st.rig && st.rig.ctx.state === 'suspended') void st.rig.ctx.resume()
      st.raf = requestAnimationFrame(st.loop)
    } else {
      const rig = st.rig
      if (rig) {
        rig.master.gain.setTargetAtTime(0.0001, rig.ctx.currentTime, 0.05)
        void rig.ctx.suspend()
      }
    }
    return () => cancelAnimationFrame(st.raf)
  }, [active])

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: BG, userSelect: 'none', touchAction: 'none', cursor: 'crosshair' }}
    >
      {/* 心电图纸网格 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,210,63,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,210,63,0.045) 1px, transparent 1px), linear-gradient(rgba(255,210,63,0.085) 1px, transparent 1px), linear-gradient(90deg, rgba(255,210,63,0.085) 1px, transparent 1px)',
          backgroundSize: '46px 46px, 46px 46px, 230px 230px, 230px 230px',
        }}
      />
      <canvas ref={histRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={scopeRef} className="absolute inset-0 h-full w-full" />

      {/* 音名 / 频率大字 */}
      <div
        ref={labelRef}
        className="pointer-events-none absolute left-0 top-0"
        style={{ opacity: 0, transition: 'opacity 0.25s ease', willChange: 'transform' }}
      >
        <div
          ref={noteRef}
          className="font-attitude"
          style={{
            fontSize: '7cqh',
            lineHeight: 1,
            color: AMBER,
            textShadow: '0 0 26px rgba(255,210,63,0.5)',
            fontWeight: 700,
          }}
        >
          A3
        </div>
        <div
          ref={hzRef}
          className="font-attitude"
          style={{ fontSize: '1.6cqh', letterSpacing: '0.22em', color: 'rgba(255,210,63,0.65)', marginTop: '0.5cqh' }}
        >
          220 HZ
        </div>
      </div>

      {/* 首次提示 */}
      {!touched && (
        <div
          ref={hintRef}
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center"
          style={{ top: '63%', color: AMBER }}
        >
          <div className="font-cn" style={{ fontSize: '3cqh', letterSpacing: '0.55em', textIndent: '0.55em' }}>
            触摸演奏
          </div>
          <div
            className="font-attitude"
            style={{ fontSize: '1.7cqh', letterSpacing: '0.45em', textIndent: '0.45em', opacity: 0.75, marginTop: '1cqh' }}
          >
            TOUCH TO PLAY
          </div>
        </div>
      )}

      <div
        className="pointer-events-none absolute flex items-baseline gap-[1.1em] whitespace-nowrap"
        style={{ left: '50%', bottom: '3.2%', transform: 'translateX(-50%)' }}
      >
        <span className="font-attitude" style={{ fontSize: '1.5cqh', letterSpacing: '0.3em', color: 'rgba(255,210,63,0.6)' }}>
          VOICEPRINT · 声纹
        </span>
        <span className="font-cn" style={{ fontSize: '1.5cqh', color: 'rgba(255,210,63,0.35)' }}>
          移动指针 · 演奏
        </span>
      </div>
    </div>
  )
}
