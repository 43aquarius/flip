'use client'

import { useEffect, useRef, useState } from 'react'
import { useBookStore } from '@/lib/book-store'
import type { ArtPageProps } from './types'

/**
 * ROOM 18 · CHROMA 色觉
 * 找出不同色块的试炼。每关横跨一步可见光谱（红→橙→黄→绿→青→蓝→紫…），
 * 中央高饱和光谱色圆角方块网格从 3×3 渐进加密到 7×7，
 * 差异（色相差 / 明度差 / 饱和度差）随关卡递减。点中升级，点错抖动清连击。
 * 底部光谱旅程条实时指示当前关卡在色谱上的位置。
 */

const BEST_KEY = 'flip.chroma.best'
/** 每关沿色相环推进的角度：10 关 ≈ 走完整个可见光谱 */
const SPECTRUM_STEP = 36

interface Puzzle {
  level: number
  size: number
  hue: number
  bg: string
  ink: string
  base: string
  odd: string
  oddIndex: number
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`
}

function makePuzzle(level: number, avoidIndex: number): Puzzle {
  const hue = ((level - 1) * SPECTRUM_STEP) % 360
  const size = Math.min(3 + Math.floor((level - 1) / 2), 7)
  const count = size * size
  const diff = Math.min(1, (level - 1) / 13)
  const fall = Math.pow(1 - diff, 0.9)
  // 高饱和光谱色；黄域（40°–100°）提亮才显得金黄而非橄榄
  const yellowBoost = hue >= 40 && hue <= 100 ? 9 : 0
  const tileS = 64 + Math.random() * 14
  const tileL = 50 + Math.random() * 6 + yellowBoost
  const base = hsl(hue, tileS, tileL)
  let odd: string
  const mode = Math.random()
  if (mode < 0.38) {
    // 色相差
    const dH = 1.5 + 12 * fall
    const sign = Math.random() < 0.5 ? -1 : 1
    odd = hsl((hue + sign * dH + 360) % 360, tileS, tileL)
  } else if (mode < 0.76) {
    // 明度差
    const dL = 0.9 + 5.4 * fall
    const sign = Math.random() < 0.5 ? -1 : 1
    odd = hsl(hue, tileS, Math.min(78, Math.max(30, tileL + sign * dL)))
  } else {
    // 饱和度差
    const dS = 2.5 + 13 * fall
    const sign = Math.random() < 0.5 ? -1 : 1
    odd = hsl(hue, Math.min(96, Math.max(28, tileS + sign * dS)), tileL)
  }
  let oddIndex = Math.floor(Math.random() * count)
  if (oddIndex === avoidIndex && count > 1) {
    oddIndex = (oddIndex + 1 + Math.floor(Math.random() * (count - 1))) % count
  }
  // 深色暗底同色相衬托，光谱色块满饱和弹出；文字用同族亮色
  const bgL = 10 + Math.random() * 3
  return {
    level,
    size,
    hue,
    bg: hsl(hue, 34, bgL),
    ink: hsl(hue, 42, 87),
    base,
    odd,
    oddIndex,
  }
}

export default function Art18({ active }: ArtPageProps) {
  const [puzzle, setPuzzle] = useState<Puzzle>(() => makePuzzle(1, -1))
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [best, setBest] = useState(0)
  const [hint, setHint] = useState<'show' | 'fade' | 'gone'>('show')

  const rootRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const levelRef = useRef<HTMLDivElement | null>(null)
  const comboRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<AudioContext | null>(null)
  const muted = useBookStore((s) => s.muted)
  const mutedRef = useRef(muted)

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  // 读取最高分（异步，避免 effect 内同步 setState）
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const v = parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10)
        if (Number.isFinite(v) && v > 0) setBest(v)
      } catch {
        /* localStorage 不可用则静默 */
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  // 开局“眼睛适应”提示
  useEffect(() => {
    const t1 = window.setTimeout(() => setHint('fade'), 2300)
    const t2 = window.setTimeout(() => setHint('gone'), 3700)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  // 写回最高分（同步到外部系统）
  useEffect(() => {
    if (best > 0) {
      try {
        window.localStorage.setItem(BEST_KEY, String(best))
      } catch {
        /* 静默 */
      }
    }
  }, [best])

  // 关闭音频上下文
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        void audioRef.current.close()
        audioRef.current = null
      }
    }
  }, [])

  const blip = (ok: boolean): void => {
    if (mutedRef.current) return
    try {
      if (!audioRef.current) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        audioRef.current = new AC()
      }
      const c = audioRef.current
      if (c.state === 'suspended') void c.resume()
      const t = c.currentTime
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = ok ? 'sine' : 'triangle'
      if (ok) {
        o.frequency.setValueAtTime(620, t)
        o.frequency.exponentialRampToValueAtTime(990, t + 0.09)
      } else {
        o.frequency.setValueAtTime(150, t)
        o.frequency.exponentialRampToValueAtTime(86, t + 0.15)
      }
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(ok ? 0.15 : 0.12, t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t + (ok ? 0.17 : 0.22))
      o.connect(g)
      g.connect(c.destination)
      o.start(t)
      o.stop(t + 0.26)
    } catch {
      /* 音频失败静默 */
    }
  }

  const pop = (el: HTMLElement | null, big: boolean): void => {
    if (!el || typeof el.animate !== 'function') return
    el.animate(
      [
        { transform: 'scale(1)' },
        { transform: `scale(${big ? 1.16 : 1.28})`, offset: 0.35 },
        { transform: 'scale(1)' },
      ],
      { duration: 340, easing: 'cubic-bezier(.22,.9,.3,1)' },
    )
  }

  const onTile = (i: number) => (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (i === puzzle.oddIndex) {
      const newCombo = combo + 1
      const gain = 5 * puzzle.level + 4 * (newCombo - 1)
      const newScore = score + gain
      // 挑战：连过十关（下一关为第 10 关）→ 通关（幂等）
      if (puzzle.level + 1 >= 10) useBookStore.getState().clearRoom(18)
      setPuzzle(makePuzzle(puzzle.level + 1, puzzle.oddIndex))
      setScore(newScore)
      if (newScore > best) setBest(newScore)
      setCombo(newCombo)
      blip(true)
      if (gridRef.current && typeof gridRef.current.animate === 'function') {
        gridRef.current.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.055)', offset: 0.35 },
            { transform: 'scale(1)' },
          ],
          { duration: 360, easing: 'cubic-bezier(.22,.9,.3,1)' },
        )
      }
      pop(levelRef.current, true)
      if (newCombo >= 2) pop(comboRef.current, false)
    } else {
      setCombo(0)
      blip(false)
      if (gridRef.current && typeof gridRef.current.animate === 'function') {
        gridRef.current.animate(
          [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-11px)' },
            { transform: 'translateX(9px)' },
            { transform: 'translateX(-6px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(0)' },
          ],
          { duration: 380, easing: 'ease-out' },
        )
      }
      if (typeof e.currentTarget.animate === 'function') {
        e.currentTarget.animate(
          [
            { boxShadow: '0 0 0 0 rgba(255,45,85,0)' },
            { boxShadow: '0 0 0 6px rgba(255,45,85,0.9)', offset: 0.3 },
            { boxShadow: '0 0 0 0 rgba(255,45,85,0)' },
          ],
          { duration: 440, easing: 'ease-out' },
        )
      }
    }
  }

  // idle 呼吸（网格极缓慢起伏），active=false 时暂停
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!active) return
    let raf = 0
    const t0 = performance.now()
    const breathe = (): void => {
      raf = requestAnimationFrame(breathe)
      const el = wrapRef.current
      if (el) {
        const s = 1 + 0.005 * Math.sin((performance.now() - t0) * 0.0011)
        el.style.transform = `scale(${s.toFixed(4)})`
      }
    }
    raf = requestAnimationFrame(breathe)
    return () => cancelAnimationFrame(raf)
  }, [active])

  const tiles: React.ReactNode[] = []
  const n = puzzle.size
  for (let i = 0; i < n * n; i++) {
    tiles.push(
      <button
        key={`${puzzle.level}-${i}`}
        type="button"
        aria-label={`色块 ${i + 1}`}
        onPointerDown={onTile(i)}
        className="hover:-translate-y-[3px] hover:scale-[1.03] focus:outline-none"
        style={{
          borderRadius: '24%',
          background: i === puzzle.oddIndex ? puzzle.odd : puzzle.base,
          boxShadow: '0 2px 0 rgba(0,0,0,0.24)',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
          transition:
            'translate 150ms ease-out, scale 150ms ease-out, transform 150ms ease-out, background-color 320ms ease, box-shadow 150ms ease',
        }}
      />,
    )
  }

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: puzzle.bg, transition: 'background-color 480ms ease', userSelect: 'none' }}
    >
      {/* HUD · 左上：LEVEL */}
      <div className="pointer-events-none absolute" style={{ left: '13.5%', top: '16.5%', color: puzzle.ink }}>
        <div
          className="font-attitude"
          style={{ fontSize: '1.7cqh', letterSpacing: '0.42em', opacity: 0.66 }}
        >
          LEVEL
        </div>
        <div ref={levelRef} className="font-display" style={{ fontSize: '14cqh', lineHeight: 0.95, letterSpacing: '-0.02em' }}>
          {puzzle.level}
        </div>
        <div
          className="font-cn"
          style={{ fontSize: '1.7cqh', letterSpacing: '0.34em', opacity: 0.6, marginTop: '0.6cqh' }}
        >
          {n}×{n} 网格
        </div>
      </div>

      {/* HUD · 右上：SCORE / BEST / COMBO */}
      <div className="pointer-events-none absolute text-right" style={{ right: '13.5%', top: '18.5%', color: puzzle.ink }}>
        <div className="font-attitude" style={{ fontSize: '1.6cqh', letterSpacing: '0.32em', opacity: 0.66 }}>
          SCORE
        </div>
        <div className="font-display" style={{ fontSize: '4.2cqh', lineHeight: 1.05 }}>
          {score}
        </div>
        <div className="font-attitude" style={{ fontSize: '1.6cqh', letterSpacing: '0.32em', opacity: 0.66, marginTop: '1.6cqh' }}>
          BEST
        </div>
        <div className="font-display" style={{ fontSize: '2.6cqh', lineHeight: 1.1, opacity: 0.85 }}>
          {best}
        </div>
        <div
          ref={comboRef}
          className="font-attitude"
          style={{
            fontSize: '2cqh',
            letterSpacing: '0.22em',
            marginTop: '1.6cqh',
            opacity: combo >= 2 ? 1 : 0.4,
            fontWeight: combo >= 2 ? 700 : 400,
          }}
        >
          COMBO ×{combo}
        </div>
      </div>

      {/* 中央网格 */}
      <div ref={wrapRef} className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: '4cqh' }}>
        <div
          ref={gridRef}
          style={{
            width: 'min(56cqw, 47cqh)',
            aspectRatio: '1',
            display: 'grid',
            gridTemplateColumns: `repeat(${n}, 1fr)`,
            gridTemplateRows: `repeat(${n}, 1fr)`,
            gap: '3.6%',
          }}
        >
          {tiles}
        </div>
      </div>

      {/* 开局“眼睛适应”提示 */}
      {hint !== 'gone' && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
          style={{
            top: '31%',
            opacity: hint === 'show' ? 1 : 0,
            transition: 'opacity 1.3s ease',
            color: puzzle.ink,
            textAlign: 'center',
          }}
        >
          <div className="font-cn" style={{ fontSize: '2.6cqh', letterSpacing: '0.5em' }}>
            眼睛适应中
          </div>
          <div
            className="font-attitude"
            style={{ fontSize: '1.6cqh', letterSpacing: '0.4em', opacity: 0.62, marginTop: '1cqh' }}
          >
            SPOT THE ODD ONE
          </div>
        </div>
      )}

      {/* 光谱旅程条：当前关卡在可见光谱上的位置 */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: '50%',
          bottom: '8.8%',
          transform: 'translateX(-50%)',
          width: 'min(34cqw, 30cqh)',
          transition: 'opacity 0.5s ease',
        }}
      >
        <div
          style={{
            height: '0.7cqh',
            borderRadius: 99,
            background:
              'linear-gradient(90deg, hsl(0 85% 60%), hsl(45 90% 58%), hsl(90 80% 52%), hsl(150 80% 48%), hsl(200 85% 55%), hsl(250 80% 62%), hsl(300 80% 58%), hsl(345 85% 62%))',
            boxShadow: `0 0 1.2cqh hsla(${puzzle.hue} 90% 60% / 0.45)`,
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '-0.75cqh',
            left: `${((puzzle.hue / 360) * 100).toFixed(1)}%`,
            width: '0.22cqw',
            height: '2.2cqh',
            transform: 'translateX(-50%)',
            background: '#fff',
            borderRadius: 2,
            boxShadow: '0 0 0.8cqh rgba(255,255,255,0.8)',
            transition: 'left 0.42s cubic-bezier(0.3, 1.2, 0.4, 1)',
          }}
        />
      </div>

      <div
        className="pointer-events-none absolute flex items-baseline gap-[1.1em] whitespace-nowrap"
        style={{ left: '50%', bottom: '3.2%', transform: 'translateX(-50%)', color: puzzle.ink }}
      >
        <span className="font-attitude" style={{ fontSize: '1.5cqh', letterSpacing: '0.3em', opacity: 0.72 }}>
          CHROMA · 色觉
        </span>
        <span className="font-cn" style={{ fontSize: '1.5cqh', opacity: 0.45 }}>
          找出不同的色块
        </span>
      </div>
    </div>
  )
}
