'use client'

import { useEffect, useRef } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/* ═══════════════════════════════════════════════════════
   ROOM 11 · TERMINAL 终端之环 — 终端形态实验室 FORM LAB
   1979 年的数学 Demo 转世成一台「终端形态实验室」：
   同一套 ASCII z-buffer 渲染器上轮换三种实体形态——
   环面 TORUS / 球体 SPHERE / 波场 WAVE（点击换台，
   换台瞬间全屏雪花，新形态从噪声中按亮度逐格生长）。
   指针即光源：高光随指针实时扫过表面；拖动施加自旋惯性。
   CRT 质感：扫描线 / 磷光余辉 / 刷新带 / 行同步撕裂 /
   左右侧栏数据流 / HUD 括号取景框 / 开机自检。
   音频：50/100Hz 电流哼声 + 换台白噪爆点 + 撕裂音高抖动。
   ═══════════════════════════════════════════════════════ */

const CHARSET = '.,-~:;=!*#$@'
/** 静态噪声字符表（换台 / 噪声生长 / 撕裂闪烁） */
const NOISE_CHARS = '.,-~:;=!*#$@01%&?/<>#+='
/** 12 级磷光：从暗绿到白热 */
const PHOSPHOR = [
  '#0e6b2b', '#128936', '#17a244', '#1fc452', '#2ee662', '#37ff6c',
  '#58ff88', '#82ffa9', '#a9ffc9', '#ccffe3', '#e6fff2', '#f5fffa',
]
/** 侧栏数据流三档暗色 = 磷光 1-3 级按 40% 混入底色 */
const SIDE_COLS = ['#0a3a19', '#0c441e', '#0f5124']
const BG = '#050505'

const FORMS = ['TORUS', 'SPHERE', 'WAVE']
/** 各形态的基础自转速率 [a 轴, b 轴]（波场少翻滚多平旋） */
const BASE_SPIN: Array<[number, number]> = [
  [0.32, 0.21],
  [0.26, 0.18],
  [0.13, 0.3],
]

const BOOT_TEXT = 'FLIP/11 FORM LAB - 1979\n> LOAD "RING",8,1\nSEARCHING FOR RING\nREADY.'

/* ---------- 侧栏数据流 ---------- */
const SIDEBAR_W = 10
const SCHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·-'
const HEXC = '0123456789ABCDEF'
const TAGS = [
  'AX13', 'AX-1', 'CH-2', 'VTX0', 'IRQ7', 'DMA3', 'CPU0', 'GPU2',
  'BUF5', 'IO08', 'RAM2', 'ROM6', 'NET3', 'TMP9', 'SIG4', 'PWR1',
  'BUS1', 'CRC2', 'DAT7', 'ACK0', 'ERR0', 'SYN0',
]
const WORDS = [
  'SYN', 'ACK', 'EOF', 'ERR', 'RUN', 'IDL', 'RAM', 'ROM', 'BUS', 'NET',
  'SIG', 'TMP', 'PWR', 'VTX', 'DAT', 'CRC', 'CPU', 'DMA', 'IRQ', 'BUF',
]

interface SideLine {
  /** 每字符在 SCHARS 中的索引 */
  cs: number[]
  /** 亮度档 1..3 */
  li: number
}

const hexN = (n: number): string => {
  let s = ''
  for (let i = 0; i < n; i++) s += HEXC[(Math.random() * 16) | 0]
  return s
}

const pick = (arr: string[]): string => arr[(Math.random() * arr.length) | 0]

/** 生成一行 10 字符宽的伪数据：AX13 3F9C / ERR 0x00 / 3F9C 094 … */
const makeLine = (): SideLine => {
  const r = Math.random()
  let s: string
  if (r < 0.3) s = `${pick(TAGS)} ${hexN(4)}`
  else if (r < 0.52) s = `${pick(WORDS)} 0x${hexN(2)}`
  else if (r < 0.72) s = `${hexN(4)} ${String((Math.random() * 1000) | 0).padStart(3, '0')}`
  else if (r < 0.88) s = `${hexN(4)} ${hexN(4)}`
  else s = pick(WORDS)
  s = s.slice(0, SIDEBAR_W).padEnd(SIDEBAR_W, ' ')
  const cs: number[] = []
  for (let i = 0; i < s.length; i++) {
    const ci = SCHARS.indexOf(s[i])
    cs.push(ci >= 0 ? ci : 0)
  }
  const q = Math.random()
  return { cs, li: q < 0.55 ? 1 : q < 0.85 ? 2 : 3 }
}

interface Spin {
  a: number
  b: number
  va: number
  vb: number
  dragging: boolean
  px: number
  py: number
  pt: number
  /** 点击 vs 拖拽判定的按下锚点 */
  downX: number
  downY: number
  downT: number
}

interface AudioBox {
  ac: AudioContext | null
  master: GainNode | null
  hum1: OscillatorNode | null
  hum2: OscillatorNode | null
  noiseBuf: AudioBuffer | null
}

interface World {
  w: number
  h: number
  dpr: number
  cols: number
  rows: number
  cellW: number
  cellH: number
  font: string
  zbuf: Float32Array
  /** 亮度桶 0-11 = 形态磷光，12-14 = 侧栏三档；bit4(16) = 噪声字符 */
  chr: Int8Array
  /** 侧栏自定义字符索引（-1 = 无） */
  sch: Int8Array
  spin: Spin
  form: number
  switchAt: number
  staticUntil: number
  growEnd: number
  tearUntil: number
  nextTear: number
  tearShift: number
  light: { x: number; y: number; tx: number; ty: number }
  pointerIn: boolean
  clock: number
  sideClock: number
  linesL: SideLine[]
  linesR: SideLine[]
  audio: AudioBox
  raf: number
  last: number
  hudClock: number
  roll: number
  bootN: number
  bootDone: boolean
  bootFading: boolean
  fps: number
  booted: boolean
}

export default function Art11({ active }: ArtPageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hudRef = useRef<HTMLSpanElement | null>(null)
  const curRef = useRef<HTMLSpanElement | null>(null)
  const lightRef = useRef<HTMLDivElement | null>(null)
  const formTagRef = useRef<HTMLDivElement | null>(null)
  const bootRef = useRef<HTMLDivElement | null>(null)
  const rollRef = useRef<HTMLDivElement | null>(null)

  const W = useRef<World>({
    w: 0, h: 0, dpr: 1, cols: 0, rows: 0, cellW: 10, cellH: 18,
    font: '14px monospace',
    zbuf: new Float32Array(0), chr: new Int8Array(0), sch: new Int8Array(0),
    spin: { a: 1.1, b: 0.35, va: 0, vb: 0, dragging: false, px: 0, py: 0, pt: 0, downX: 0, downY: 0, downT: 0 },
    form: 0, switchAt: 0, staticUntil: 0, growEnd: 0,
    tearUntil: 0, nextTear: 9000, tearShift: 0,
    light: { x: 0, y: 0.3, tx: 0, ty: 0.3 },
    pointerIn: false, clock: 0, sideClock: 0,
    linesL: [], linesR: [],
    audio: { ac: null, master: null, hum1: null, hum2: null, noiseBuf: null },
    raf: 0, last: 0, hudClock: 0, roll: 0,
    bootN: 0, bootDone: false, bootFading: false,
    fps: 60, booted: false,
  })

  /* ---------- 音频：首次交互惰性创建，静音走总线 ---------- */
  const ensureAudio = () => {
    const a = W.current.audio
    if (a.ac) return
    try {
      const ac = new AudioContext()
      const master = ac.createGain()
      master.gain.value = useBookStore.getState().muted ? 0 : 1
      master.connect(ac.destination)
      /* 50/100Hz 电流哼声 */
      const o1 = ac.createOscillator()
      o1.type = 'sine'
      o1.frequency.value = 50
      const g1 = ac.createGain()
      g1.gain.value = 0.015
      o1.connect(g1)
      g1.connect(master)
      const o2 = ac.createOscillator()
      o2.type = 'sine'
      o2.frequency.value = 100
      const g2 = ac.createGain()
      g2.gain.value = 0.009
      o2.connect(g2)
      g2.connect(master)
      o1.start()
      o2.start()
      /* 换台白噪缓冲 */
      const len = Math.floor(ac.sampleRate * 0.05)
      const buf = ac.createBuffer(1, len, ac.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      a.ac = ac
      a.master = master
      a.hum1 = o1
      a.hum2 = o2
      a.noiseBuf = buf
    } catch {
      /* 无音频环境：静默降级 */
    }
  }

  /** 换台：30ms 白噪爆点 */
  const burst = () => {
    const a = W.current.audio
    if (!a.ac || !a.master || !a.noiseBuf) return
    try {
      const t = a.ac.currentTime
      const src = a.ac.createBufferSource()
      src.buffer = a.noiseBuf
      const g = a.ac.createGain()
      g.gain.setValueAtTime(0.16, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
      src.connect(g)
      g.connect(a.master)
      src.start(t)
      src.stop(t + 0.05)
    } catch {
      /* ignore */
    }
  }

  /** 行同步撕裂：哼声音高快速抖动 200ms */
  const warble = () => {
    const a = W.current.audio
    if (!a.ac || !a.hum1 || !a.hum2) return
    try {
      const t = a.ac.currentTime
      const sched = (osc: OscillatorNode, f: number) => {
        osc.frequency.cancelScheduledValues(t)
        osc.frequency.setValueAtTime(f, t)
        osc.frequency.linearRampToValueAtTime(f * 1.12, t + 0.06)
        osc.frequency.linearRampToValueAtTime(f * 0.93, t + 0.13)
        osc.frequency.linearRampToValueAtTime(f, t + 0.2)
      }
      sched(a.hum1, 50)
      sched(a.hum2, 100)
    } catch {
      /* ignore */
    }
  }

  /** 点击换台：2 帧全屏雪花 → 新形态从噪声中生长 ~0.5s */
  const cycleForm = () => {
    const w = W.current
    w.form = (w.form + 1) % 3
    const now = performance.now()
    w.switchAt = now
    w.staticUntil = now + 40
    w.growEnd = now + 540
    w.spin.va += (Math.random() - 0.5) * 0.9
    w.spin.vb += (Math.random() - 0.5) * 0.5
    if (formTagRef.current) formTagRef.current.textContent = FORMS[w.form]
    burst()
  }

  /* ---------- 指针：拖动施加角速度 / 移动即光源 ---------- */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = W.current
    const s = w.spin
    s.dragging = true
    s.px = e.clientX
    s.py = e.clientY
    s.pt = performance.now()
    s.downX = e.clientX
    s.downY = e.clientY
    s.downT = s.pt
    if (rootRef.current) rootRef.current.style.cursor = 'grabbing'
    ensureAudio()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 某些环境下不可用，忽略 */
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = W.current
    const s = w.spin
    /* 光源方位始终跟随指针（与拖拽无关） */
    const root = rootRef.current
    if (root) {
      const rect = root.getBoundingClientRect()
      if (rect.width > 1 && rect.height > 1) {
        w.pointerIn = true
        w.light.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2
        w.light.ty = (0.5 - (e.clientY - rect.top) / rect.height) * 2
      }
    }
    if (!s.dragging) return
    const now = performance.now()
    const dt = Math.max(0.008, (now - s.pt) / 1000)
    const dx = e.clientX - s.px
    const dy = e.clientY - s.py
    s.a += dx * 0.006
    s.b += dy * 0.006
    s.va = s.va * 0.55 + ((dx * 0.006) / dt) * 0.45
    s.vb = s.vb * 0.55 + ((dy * 0.006) / dt) * 0.45
    s.va = Math.max(-7, Math.min(7, s.va))
    s.vb = Math.max(-7, Math.min(7, s.vb))
    s.px = e.clientX
    s.py = e.clientY
    s.pt = now
  }

  const endDrag = () => {
    const w = W.current
    w.spin.dragging = false
    if (rootRef.current) rootRef.current.style.cursor = 'grab'
  }

  /** 抬起：250ms 内且位移 <8px 判定为点击 → 换台 */
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const w = W.current
    const s = w.spin
    s.dragging = false
    if (rootRef.current) rootRef.current.style.cursor = 'grab'
    const dtms = performance.now() - s.downT
    const dist = Math.hypot(e.clientX - s.downX, e.clientY - s.downY)
    if (dtms < 250 && dist < 8) cycleForm()
  }

  const onPointerLeave = () => {
    const w = W.current
    w.spin.dragging = false
    w.pointerIn = false
    if (rootRef.current) rootRef.current.style.cursor = 'grab'
  }

  useEffect(() => {
    const w = W.current
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let muted = useBookStore.getState().muted

    /* ---------- 一帧渲染（暂停时也被 resize 调用） ---------- */
    const render = (nowMs: number) => {
      if (w.cols < 8 || w.rows < 4 || w.w < 10) return
      ctx.setTransform(w.dpr, 0, 0, w.dpr, 0, 0)
      // 磷光余辉：向透明衰减（保持画布透明 → drop-shadow 辉光作用于字形）
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, 0, w.w, w.h)
      ctx.globalCompositeOperation = 'source-over'

      const { cols, rows, cellW, cellH, zbuf, chr, sch } = w
      zbuf.fill(0)
      chr.fill(-1)
      sch.fill(-1)

      const tearing = nowMs < w.tearUntil
      const inStatic = nowMs < w.staticUntil

      if (!inStatic) {
        /* 指针光源方向：保持 |L| = √2（与经典 donut 光照同动态范围） */
        let lx = w.light.x
        let ly = w.light.y
        const il = 1.41421356 / Math.sqrt(lx * lx + ly * ly + 1)
        lx *= il
        ly *= il
        const lz = -il

        const cA = Math.cos(w.spin.a)
        const sA = Math.sin(w.spin.a)
        const cB = Math.cos(w.spin.b)
        const sB = Math.sin(w.spin.b)
        const halfC = cols / 2
        const halfR = rows / 2
        const K2 = 5
        const K1x = (cols * K2) / 8.6
        const K1y = K1x * (cellW / cellH)
        /* 背面剔除阈值：波场是单片曲面（俯视时整面背光），
           不剔除、背光面落到最暗档，保证任何倾角都可见 */
        const cull = w.form === 2 ? -1.5 : -0.28

        /* 物体坐标 → 视线坐标：Rx(a) → Rz(b) → z += K2；法线同步旋转 */
        const put = (ox: number, oy: number, oz: number, nx: number, ny: number, nz: number) => {
          const y1 = oy * cA - oz * sA
          const z1 = oy * sA + oz * cA
          const x2 = ox * cB - y1 * sB
          const y2 = ox * sB + y1 * cB
          const z = z1 + K2
          const ooz = 1 / z
          const col = (halfC + K1x * ooz * x2) | 0
          const row = (halfR - K1y * ooz * y2) | 0
          if (col < 0 || col >= cols || row < 0 || row >= rows) return
          const idx = row * cols + col
          if (ooz <= zbuf[idx]) return
          const ny1 = ny * cA - nz * sA
          const nz1 = ny * sA + nz * cA
          const nx2 = nx * cB - ny1 * sB
          const ny2 = nx * sB + ny1 * cB
          const L = nx2 * lx + ny2 * ly + nz1 * lz
          if (L > 0) {
            let li = (L * 8) | 0
            if (li > 11) li = 11
            if (Math.random() < 0.005 && li < 10) li += 2 // 磷光闪点
            zbuf[idx] = ooz
            chr[idx] = li
          } else if (L > cull) {
            zbuf[idx] = ooz
            chr[idx] = 0
          }
        }

        if (w.form === 0) {
          /* 环面：1979 donut.c 参数方程（点+法线分离写法） */
          const R1 = 1
          const R2 = 2
          for (let th = 0; th < 6.2832; th += 0.07) {
            const ct = Math.cos(th)
            const st = Math.sin(th)
            const circX = R2 + R1 * ct
            const circY = R1 * st
            for (let ph = 0; ph < 6.2832; ph += 0.03) {
              const cp = Math.cos(ph)
              const sp = Math.sin(ph)
              put(circX * cp, circY, circX * sp, ct * cp, st, ct * sp)
            }
          }
        } else if (w.form === 1) {
          /* 球体：6 条纬向肋带（半径微调制），解析真法线 */
          const RS = 2.15
          const AMP = 0.09
          const KB = 6
          const dth = 0.042
          for (let th = dth * 0.5; th < Math.PI; th += dth) {
            const sth = Math.sin(th)
            const cth = Math.cos(th)
            const r = RS + AMP * Math.sin(KB * th)
            const dr = AMP * KB * Math.cos(KB * th)
            const nA = r * sth - dr * cth
            const nB = dr * sth + r * cth
            const inv = 1 / Math.sqrt(nA * nA + nB * nB)
            const ux = nA * inv
            const uy = nB * inv
            const dph = 0.032 / Math.max(sth, 0.18) // 极区降采样
            for (let ph = 0; ph < 6.2832; ph += dph) {
              const cp = Math.cos(ph)
              const sp = Math.sin(ph)
              put(r * sth * cp, r * cth, r * sth * sp, ux * cp, uy, ux * sp)
            }
          }
        } else {
          /* 波场：圆盘上 z = A·sin(k·r − ωt) 双谐波涟漪，高度场法线 */
          const RW = 2.55
          const AMP = 0.34
          const KK = 3.3
          const OM = 2.4
          const KH = 1.7 * KK
          const OH = 1.31 * OM
          const t = w.clock
          for (let rr = 0.05; rr < RW; rr += 0.05) {
            const p1 = KK * rr - OM * t
            const p2 = KH * rr + OH * t
            const hh = AMP * Math.sin(p1) + 0.11 * Math.sin(p2)
            const dh = AMP * KK * Math.cos(p1) + 0.11 * KH * Math.cos(p2)
            const inv = 1 / Math.sqrt(dh * dh + 1)
            const nx = -dh * inv
            const ny = inv
            const nphi = Math.max(8, Math.ceil((6.2832 * rr) / 0.05))
            const dph = 6.2832 / nphi
            for (let i = 0; i < nphi; i++) {
              const cp = Math.cos(i * dph)
              const sp = Math.sin(i * dph)
              put(rr * cp, hh, rr * sp, nx * cp, ny, nx * sp)
            }
          }
        }

        /* 侧栏数据流（写入格元缓冲；窄页跳过以免挤压形态） */
        if (cols >= 52) {
          const c0L = Math.max(1, Math.ceil(cols * 0.062) + 1)
          const c0R = cols - c0L - SIDEBAR_W
          const r0 = Math.max(2, Math.round(rows * 0.1))
          const r1 = rows - Math.max(2, Math.round(rows * 0.12))
          const drawSide = (lines: SideLine[], c0: number) => {
            for (let r = r0; r < r1 && r < lines.length; r++) {
              const line = lines[r]
              const base = r * cols
              for (let j = 0; j < SIDEBAR_W; j++) {
                const c = c0 + j
                if (c < 0 || c >= cols) continue
                const idx = base + c
                chr[idx] = 11 + line.li // 桶 12-14
                sch[idx] = line.cs[j]
              }
            }
          }
          drawSide(w.linesL, c0L)
          drawSide(w.linesR, c0R)
        }
      }

      /* ---- 后处理格元缓冲：换台静态 / 噪声生长 / 撕裂闪烁 ---- */
      if (inStatic) {
        for (let i = 0; i < chr.length; i++) chr[i] = ((Math.random() * 12) | 0) | 16
      } else {
        const p = (nowMs - w.staticUntil) / (w.growEnd - w.staticUntil)
        if (p < 1) {
          const th = 12 * (1 - p) // 亮格先从噪声中显影
          for (let i = 0; i < chr.length; i++) {
            const v = chr[i]
            if (v < 0) {
              if (Math.random() < (1 - p) * 0.8) chr[i] = ((Math.random() * 12) | 0) | 16
            } else {
              const b = v < 12 ? v : v - 11 // 侧栏桶 12-14 → 亮度 1-3
              if (b < th) chr[i] = v | 16
            }
          }
        }
        if (tearing) {
          for (let i = 0; i < chr.length; i++) {
            const v = chr[i]
            if (v >= 0 && Math.random() < 0.05) {
              const li = v & 15
              const li2 = li < 12 && Math.random() < 0.65 ? Math.min(11, li + 2) : li
              chr[i] = li2 | 16
            }
          }
        }
      }

      /* ---- 逐行逐字符绘制（按亮度分桶；撕裂时行循环位移） ---- */
      ctx.font = w.font
      ctx.textBaseline = 'top'
      const shift = tearing ? w.tearShift : 0
      const ncl = NOISE_CHARS.length
      for (let li = 0; li < 15; li++) {
        ctx.fillStyle = li < 12 ? PHOSPHOR[li] : SIDE_COLS[li - 12]
        const ch = CHARSET[li]
        for (let r = 0; r < rows; r++) {
          let sr = r + shift
          if (sr < 0) sr += rows
          else if (sr >= rows) sr -= rows
          const base = sr * cols
          const yy = r * cellH
          for (let c = 0; c < cols; c++) {
            const v = chr[base + c]
            if (v < 0 || (v & 15) !== li) continue
            let glyph: string
            if (v & 16) {
              glyph = NOISE_CHARS[(Math.random() * ncl) | 0]
            } else {
              const sc = sch[base + c]
              glyph = sc >= 0 ? SCHARS[sc] : li < 12 ? ch : NOISE_CHARS[(Math.random() * ncl) | 0]
            }
            ctx.fillText(glyph, c * cellW, yy)
          }
        }
      }
    }

    /* 首次点亮：静态雪花 → 形态生长（换台同款开场） */
    if (active && !w.booted) {
      w.booted = true
      const t0 = performance.now()
      w.switchAt = t0
      w.staticUntil = t0 + 40
      w.growEnd = t0 + 540
      if (formTagRef.current) formTagRef.current.textContent = 'TORUS'
    }

    /* ---------- 尺寸自适应 ---------- */
    const resize = () => {
      const cw = root.clientWidth
      const chh = root.clientHeight
      if (cw < 40 || chh < 40) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(cw * dpr)
      canvas.height = Math.round(chh * dpr)
      w.w = cw
      w.h = chh
      w.dpr = dpr
      const fam = getComputedStyle(canvas).fontFamily || 'monospace'
      const rows = Math.max(16, Math.min(44, Math.round(chh / 28)))
      const cellH = chh / rows
      const fontPx = Math.max(8, cellH * 0.92)
      ctx.font = `${fontPx}px ${fam}`
      const cw1 = ctx.measureText('0').width || fontPx * 0.6
      const cellW = Math.max(4, cw1)
      const cols = Math.max(10, Math.floor(cw / cellW))
      w.rows = rows
      w.cols = cols
      w.cellH = cellH
      w.cellW = cellW
      w.font = `${fontPx}px ${fam}`
      w.zbuf = new Float32Array(cols * rows)
      w.chr = new Int8Array(cols * rows)
      w.sch = new Int8Array(cols * rows)
      w.linesL = []
      w.linesR = []
      for (let i = 0; i < rows; i++) {
        w.linesL.push(makeLine())
        w.linesR.push(makeLine())
      }
      render(performance.now())
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    resize()
    // Space Mono 异步加载完成后重新测量字宽
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => resize()).catch(() => undefined)
    }

    /* ---------- 静音订阅 ---------- */
    const unsubMute = useBookStore.subscribe((st) => {
      muted = st.muted
      const a = w.audio
      if (a.master && a.ac) a.master.gain.setTargetAtTime(muted ? 0 : 1, a.ac.currentTime, 0.04)
    })

    /* ---------- 主循环 ---------- */
    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - w.last) / 1000))
      w.last = now
      w.clock += dt
      w.fps = w.fps * 0.96 + (1 / dt) * 0.04

      const s = w.spin
      const base = BASE_SPIN[w.form]
      if (!s.dragging) {
        const f = Math.exp(-dt * 1.6) // 摩擦衰减
        s.va *= f
        s.vb *= f
      }
      s.a += (s.va + base[0]) * dt // 基础慢速自转
      s.b += (s.vb + base[1]) * dt

      /* 光源：指针在场则跟随，离场则缓慢自巡 */
      if (!w.pointerIn) {
        w.light.tx = 0.45 * Math.sin(w.clock * 0.33)
        w.light.ty = 0.4 * Math.sin(w.clock * 0.21 + 1.7)
      }
      const lk = 1 - Math.exp(-dt * 9)
      w.light.x += (w.light.tx - w.light.x) * lk
      w.light.y += (w.light.ty - w.light.y) * lk

      /* 开机字幕（打字机 30 字符/秒，约 2s 打完） */
      const bootEl = bootRef.current
      if (bootEl && !w.bootDone) {
        w.bootN += dt * 30
        const n = Math.floor(w.bootN)
        bootEl.style.opacity = '1'
        bootEl.textContent = BOOT_TEXT.slice(0, n) + '█'
        if (n >= BOOT_TEXT.length) {
          w.bootDone = true
          bootEl.textContent = BOOT_TEXT
        }
      } else if (bootEl && w.bootDone && !w.bootFading && w.bootN > BOOT_TEXT.length + 26) {
        w.bootFading = true
        bootEl.style.opacity = '0'
      }

      /* CRT 刷新带缓慢下移 */
      w.roll = (w.roll + dt * 0.12) % 1
      if (rollRef.current) {
        rollRef.current.style.transform = `translateY(${(-140 + w.roll * (w.h + 280)).toFixed(1)}px)`
      }
      /* 轻微闪烁（撕裂时更烈） */
      const tearing = now < w.tearUntil
      canvas.style.opacity = tearing
        ? (0.72 + Math.random() * 0.28).toFixed(3)
        : (0.94 + 0.06 * (0.5 + 0.5 * Math.sin(now * 0.011))).toFixed(3)

      /* 侧栏数据流：每 ~140ms 上移一行 */
      w.sideClock += dt
      while (w.sideClock >= 0.14) {
        w.sideClock -= 0.14
        if (w.linesL.length > 1) {
          w.linesL.shift()
          w.linesL.push(makeLine())
          w.linesR.shift()
          w.linesR.push(makeLine())
        }
      }

      /* 行同步撕裂调度：每 8-14s 一次，历时 ~200ms */
      if (w.tearUntil === 0) {
        if (now >= w.nextTear) {
          w.tearUntil = now + 200
          const maxShift = Math.max(3, w.rows >> 2)
          w.tearShift = (1 + ((Math.random() * maxShift) | 0)) * (Math.random() < 0.5 ? 1 : -1)
          warble()
        }
      } else if (now >= w.tearUntil) {
        w.tearUntil = 0
        w.tearShift = 0
        w.nextTear = now + 8000 + Math.random() * 6000
      }

      render(now)

      /* 换台形态标识：1.2s 内淡出 */
      if (formTagRef.current) {
        const ft = (now - w.switchAt) / 1200
        formTagRef.current.style.opacity = ft < 1 ? (Math.max(0, 1 - ft) * 0.9).toFixed(3) : '0'
      }

      /* HUD 读数（节流）+ 光标闪烁 */
      w.hudClock += dt
      if (w.hudClock > 0.15) {
        w.hudClock = 0
        const deg = (((s.a * 57.2958) % 360) + 360) % 360
        const omg = Math.hypot(s.va + base[0], s.vb + base[1])
        const hz = w.fps >= 55 ? 60 : Math.max(1, Math.round(w.fps))
        if (hudRef.current) {
          hudRef.current.textContent = `θ ${deg.toFixed(0)}° · ω ${omg.toFixed(2)} · FORM: ${FORMS[w.form]} · ${hz}Hz`
        }
        if (lightRef.current) {
          const fx = w.light.x >= 0 ? '+' : '-'
          const fy = w.light.y >= 0 ? '+' : '-'
          lightRef.current.textContent = `SRC ${fx}${Math.abs(w.light.x).toFixed(2)} ${fy}${Math.abs(w.light.y).toFixed(2)}`
        }
      }
      if (curRef.current) curRef.current.style.opacity = now % 1100 < 560 ? '1' : '0.06'

      w.raf = requestAnimationFrame(step)
    }

    if (active) {
      const now = performance.now()
      w.last = now
      if (w.nextTear < now) w.nextTear = now + 8000 + Math.random() * 6000
      const a = w.audio
      if (a.ac && a.ac.state === 'suspended') void a.ac.resume()
      w.raf = requestAnimationFrame(step)
    }

    return () => {
      cancelAnimationFrame(w.raf)
      ro.disconnect()
      unsubMute()
      const a = w.audio
      if (a.ac && a.ac.state === 'running') void a.ac.suspend()
    }
  }, [active])

  /* 卸载：彻底关闭音频（暂停时仅挂起，交给上面的 effect 清理） */
  useEffect(() => {
    return () => {
      const a = W.current.audio
      if (a.ac) {
        void a.ac.close().catch(() => undefined)
        a.ac = null
        a.master = null
        a.hum1 = null
        a.hum2 = null
        a.noiseBuf = null
      }
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: BG, touchAction: 'none', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onPointerLeave={onPointerLeave}
    >
      <canvas
        ref={canvasRef}
        className="font-attitude absolute inset-0 h-full w-full"
        style={{ filter: 'drop-shadow(0 0 6px rgba(51,255,102,0.4))' }}
      />
      {/* CRT 扫描线 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.26) 0px, rgba(0,0,0,0.26) 1px, transparent 1px, transparent 3px)',
        }}
      />
      {/* 刷新带 */}
      <div
        ref={rollRef}
        className="pointer-events-none absolute inset-x-0"
        style={{
          top: 0,
          height: 140,
          background:
            'linear-gradient(180deg, transparent, rgba(51,255,102,0.045) 45%, rgba(51,255,102,0.09) 55%, transparent)',
          willChange: 'transform',
        }}
      />
      {/* 暗角 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.62) 100%)',
        }}
      />
      {/* HUD 取景框：极淡边线 + 四角括号 */}
      <div
        className="font-attitude pointer-events-none absolute"
        style={{ inset: '6%', border: '1px solid rgba(51,255,102,0.1)' }}
      >
        <span style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%, -55%)', fontSize: '1.5cqw', lineHeight: 1, color: 'rgba(51,255,102,0.85)', textShadow: '0 0 7px rgba(51,255,102,0.5)' }}>┌</span>
        <span style={{ position: 'absolute', right: 0, top: 0, transform: 'translate(50%, -55%)', fontSize: '1.5cqw', lineHeight: 1, color: 'rgba(51,255,102,0.85)', textShadow: '0 0 7px rgba(51,255,102,0.5)' }}>┐</span>
        <span style={{ position: 'absolute', left: 0, bottom: 0, transform: 'translate(-50%, 55%)', fontSize: '1.5cqw', lineHeight: 1, color: 'rgba(51,255,102,0.85)', textShadow: '0 0 7px rgba(51,255,102,0.5)' }}>└</span>
        <span style={{ position: 'absolute', right: 0, bottom: 0, transform: 'translate(50%, 55%)', fontSize: '1.5cqw', lineHeight: 1, color: 'rgba(51,255,102,0.85)', textShadow: '0 0 7px rgba(51,255,102,0.5)' }}>┘</span>
      </div>
      {/* 左上：实验室标牌 */}
      <div
        className="font-attitude pointer-events-none absolute"
        style={{ left: '8.2%', top: '7.1%', fontSize: '1.05cqw', letterSpacing: '0.3em', color: 'rgba(51,255,102,0.5)' }}
      >
        FORM LAB · <span className="font-cn" style={{ letterSpacing: '0.18em' }}>形态实验室</span>
      </div>
      {/* 右上：光源方位读数 */}
      <div
        ref={lightRef}
        className="font-attitude pointer-events-none absolute"
        style={{ right: '8.2%', top: '7.1%', fontSize: '1.05cqw', letterSpacing: '0.2em', color: 'rgba(51,255,102,0.5)' }}
      >
        SRC +0.00 +0.00
      </div>
      {/* 换台形态标识（1.2s 淡出） */}
      <div
        ref={formTagRef}
        className="font-attitude pointer-events-none absolute"
        style={{
          left: '50%',
          top: '35%',
          transform: 'translateX(-50%)',
          fontSize: '2.3cqw',
          letterSpacing: '0.62em',
          color: 'rgba(51,255,102,0.92)',
          textShadow: '0 0 12px rgba(51,255,102,0.6)',
          whiteSpace: 'nowrap',
          opacity: 0,
        }}
      >
        TORUS
      </div>
      {/* 开机字幕 */}
      <div
        ref={bootRef}
        className="font-attitude pointer-events-none absolute"
        style={{
          left: '20%',
          top: '10%',
          fontSize: '1.5cqw',
          lineHeight: 1.75,
          color: '#33ff66',
          whiteSpace: 'pre',
          opacity: 0,
          transition: 'opacity 0.9s ease',
          textShadow: '0 0 8px rgba(51,255,102,0.55)',
        }}
      />
      {/* 底部读数行（框内） + 闪烁块光标 */}
      <div
        className="font-attitude pointer-events-none absolute"
        style={{
          left: '50%',
          bottom: '6.9%',
          transform: 'translateX(-50%)',
          fontSize: '1.08cqw',
          letterSpacing: '0.24em',
          color: 'rgba(51,255,102,0.75)',
          whiteSpace: 'nowrap',
        }}
      >
        <span ref={hudRef}>θ 0° · ω 0.38 · FORM: TORUS · 60Hz</span>
        <span ref={curRef} style={{ textShadow: '0 0 7px rgba(51,255,102,0.6)' }}>█</span>
      </div>
      {/* 署名 + 提示（页面底部居中，避开页码徽章角） */}
      <div
        className="pointer-events-none absolute"
        style={{ left: '50%', bottom: '2.1%', transform: 'translateX(-50%)', textAlign: 'center' }}
      >
        <div
          className="font-attitude"
          style={{ fontSize: '1.35cqw', letterSpacing: '0.32em', color: '#33ff66' }}
        >
          TERMINAL · <span className="font-cn">终端之环</span>
        </div>
        <div
          className="font-cn"
          style={{
            fontSize: '1.02cqw',
            letterSpacing: '0.2em',
            color: 'rgba(51,255,102,0.6)',
            marginTop: '0.5cqh',
          }}
        >
          拖动 · 旋转 — 移动 · 光源 — 点击 · 切换形态
        </div>
      </div>
    </div>
  )
}
