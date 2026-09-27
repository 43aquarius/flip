import { useBookStore } from '@/lib/book-store'

let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** 合成纸张翻动声：带通滤波的噪声脉冲 + 频率上扬 */
export function playFlipSound(volume = 1) {
  if (useBookStore.getState().muted) {
    // 音频可能已解锁：仍需同步环境音状态（静音时关闭）
    syncAmbience()
    return
  }
  const c = ac()
  if (!c) return
  onAudioUnlocked()
  const t = c.currentTime
  const dur = 0.34

  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const p = i / data.length
    const attack = p < 0.1 ? p / 0.1 : 1
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 1.7) * attack
  }

  const src = c.createBufferSource()
  src.buffer = buf

  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.8
  bp.frequency.setValueAtTime(750, t)
  bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.72)

  const g = c.createGain()
  const peak = 0.13 * volume
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  src.connect(bp)
  bp.connect(g)
  g.connect(c.destination)
  src.start(t)
  src.stop(t + dur)
}

/** 开书仪式感：低频闷响 + 纸噪声 */
export function playOpenSound() {
  if (useBookStore.getState().muted) {
    syncAmbience()
    return
  }
  const c = ac()
  if (!c) return
  onAudioUnlocked()
  const t = c.currentTime

  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(120, t)
  osc.frequency.exponentialRampToValueAtTime(46, t + 0.28)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)

  osc.connect(g)
  g.connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.36)

  playFlipSound(0.7)
}

/** 盖章音效：低频闷击（印泥落纸）+ 短促纸面脆响（volume<1 为落纸轻印版） */
export function playStampSound(volume = 1) {
  if (useBookStore.getState().muted) {
    syncAmbience()
    return
  }
  const c = ac()
  if (!c) return
  onAudioUnlocked()
  const t = c.currentTime
  const v = Math.max(0.05, Math.min(1, volume))

  // 闷击：正弦短滑落，模拟印章压纸
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(180, t)
  osc.frequency.exponentialRampToValueAtTime(52, t + 0.12)

  const og = c.createGain()
  og.gain.setValueAtTime(0.0001, t)
  og.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.012)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  osc.connect(og)
  og.connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.32)

  // 脆响：极短带通噪声脉冲（印泥边缘）
  const dur = 0.05
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const p = i / data.length
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 3)
  }
  const src = c.createBufferSource()
  src.buffer = buf
  const hp = c.createBiquadFilter()
  hp.type = 'bandpass'
  hp.Q.value = 1.4
  hp.frequency.value = 2400
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.06 * v, t + 0.02)
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
  src.connect(hp)
  hp.connect(ng)
  ng.connect(c.destination)
  src.start(t + 0.02)
  src.stop(t + 0.07)
}

/** 房间通关音效：印泥闷击 + 五度双音上行（比钤印更亮、带一点凯旋感） */
export function playClearSound(volume = 0.85) {
  if (useBookStore.getState().muted) {
    syncAmbience()
    return
  }
  const c = ac()
  if (!c) return
  onAudioUnlocked()
  const t = c.currentTime
  const v = Math.max(0.05, Math.min(1, volume))

  // 闷击打底（与钤印同族的印泥落纸）
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(190, t)
  osc.frequency.exponentialRampToValueAtTime(56, t + 0.14)
  const og = c.createGain()
  og.gain.setValueAtTime(0.0001, t)
  og.gain.exponentialRampToValueAtTime(0.19 * v, t + 0.012)
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
  osc.connect(og)
  og.connect(c.destination)
  osc.start(t)
  osc.stop(t + 0.34)

  // 五度双音上行（C5 → G5，短促、亮而不吵）
  const notes = [523.25, 783.99]
  notes.forEach((f, i) => {
    const start = t + 0.1 + i * 0.085
    const o = c.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(f, start)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(0.085 * v, start + 0.018)
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.42)
    o.connect(g)
    g.connect(c.destination)
    o.start(start)
    o.stop(start + 0.45)
  })
}

/* ============================================================
   环境音层（room tone）：纸面底噪 + 极低画廊嗡鸣
   仅在 AudioContext 已存在（用户首次手势后）时启动
   每个房间拥有自己的 room tone 参数（换房时平滑滑移）
   ============================================================ */

/** 房间音色：嗡鸣双振荡频率 / 噪声截止 / 噪声增益 / 嗡鸣增益 */
interface RoomTone {
  a: number
  b: number
  cut: number
  noise: number
  drone: number
}

/** 索引 0 = 结构页默认（画廊），1..20 = 房间 */
const ROOM_TONES: RoomTone[] = [
  { a: 54.0, b: 54.35, cut: 230, noise: 0.016, drone: 0.0055 }, // 00 画廊 / 结构页
  { a: 46.0, b: 46.4, cut: 180, noise: 0.018, drone: 0.007 }, // 01 尘之场 · 深金嗡鸣
  { a: 96.0, b: 97.2, cut: 520, noise: 0.014, drone: 0.004 }, // 02 字暴 · 亮纸高频
  { a: 50.0, b: 50.2, cut: 150, noise: 0.02, drone: 0.006 }, // 03 墨池 · 闷湿低频
  { a: 110.0, b: 113.0, cut: 900, noise: 0.012, drone: 0.0035 }, // 04 故障花园 · 电子嘶
  { a: 66.0, b: 67.5, cut: 320, noise: 0.015, drone: 0.005 }, // 05 干涉 · 细密拍频
  { a: 40.0, b: 40.3, cut: 120, noise: 0.019, drone: 0.008 }, // 06 引力剧场 · 深空
  { a: 60.0, b: 60.6, cut: 260, noise: 0.016, drone: 0.005 }, // 07 生命游戏 · 中性纸面
  { a: 44.0, b: 45.2, cut: 160, noise: 0.017, drone: 0.0065 }, // 08 井 · 下坠低频
  { a: 52.0, b: 52.9, cut: 210, noise: 0.02, drone: 0.0075 }, // 09 声之池 · 水汽嗡鸣
  { a: 72.0, b: 73.1, cut: 380, noise: 0.014, drone: 0.0045 }, // 10 群鸟 · 风感中频
  { a: 88.0, b: 89.5, cut: 700, noise: 0.013, drone: 0.0038 }, // 11 终端之环 · CRT 嘶
  { a: 58.0, b: 59.8, cut: 280, noise: 0.017, drone: 0.006 }, // 12 水银 · 流体拍频
  { a: 48.0, b: 48.9, cut: 190, noise: 0.016, drone: 0.0062 }, // 13 无限海岸 · 低频海岸
  { a: 64.0, b: 64.4, cut: 240, noise: 0.015, drone: 0.005 }, // 14 开花 · 温暖中低
  { a: 92.0, b: 93.8, cut: 620, noise: 0.012, drone: 0.004 }, // 15 躲避线 · 街机电流
  { a: 56.0, b: 56.2, cut: 200, noise: 0.016, drone: 0.0055 }, // 16 磷光 · 极细拍频
  { a: 78.0, b: 79.9, cut: 420, noise: 0.014, drone: 0.0042 }, // 17 眩晕文字 · 旋转中频
  { a: 84.0, b: 85.9, cut: 350, noise: 0.015, drone: 0.0046 }, // 18 色觉 · 明亮中性
  { a: 62.0, b: 63.7, cut: 230, noise: 0.018, drone: 0.006 }, // 19 声纹 · 琥珀嗡鸣
  { a: 50.0, b: 50.15, cut: 140, noise: 0.013, drone: 0.004 }, // 20 白 · 近乎无声
]

/** 当前房间音色（0..20） */
let roomTone = 0

/** 切换房间音色：环境音运行中则平滑滑移，未运行则记住待用 */
export function setRoomTone(i: number) {
  const idx = Math.max(0, Math.min(20, Math.round(i)))
  if (idx === roomTone) return
  roomTone = idx
  const t = ROOM_TONES[idx]
  if (!amb || !ctx) return
  const now = ctx.currentTime
  const tc = 2.2 // 滑移时间常数（秒）：像走进另一个房间
  amb.droneA.frequency.setTargetAtTime(t.a, now, tc)
  amb.droneB.frequency.setTargetAtTime(t.b, now, tc)
  amb.lp.frequency.setTargetAtTime(t.cut, now, tc)
  amb.noiseGain.gain.setTargetAtTime(t.noise, now, tc)
  amb.droneGain.gain.setTargetAtTime(t.drone, now, tc)
}

interface AmbienceNodes {
  noiseSrc: AudioBufferSourceNode
  droneA: OscillatorNode
  droneB: OscillatorNode
  lfo: OscillatorNode
  master: GainNode
  lp: BiquadFilterNode
  noiseGain: GainNode
  droneGain: GainNode
}

let amb: AmbienceNodes | null = null
let ambFadeTimer: ReturnType<typeof setTimeout> | null = null

function buildBrownNoise(c: AudioContext): AudioBuffer {
  const len = Math.ceil(c.sampleRate * 4)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
  // 环形接缝平滑（首尾交叉淡化）
  const fadeLen = Math.floor(c.sampleRate * 0.12)
  for (let i = 0; i < fadeLen; i++) {
    const k = i / fadeLen
    data[i] = data[i] * k + data[len - fadeLen + i] * (1 - k)
  }
  return buf
}

function startAmbience(c: AudioContext) {
  if (amb) return
  const t = c.currentTime
  const tone = ROOM_TONES[roomTone]

  // 层 1：棕噪声 → 低通 = 房间 / 纸面底噪（截止频率随房间变化）
  const noiseSrc = c.createBufferSource()
  noiseSrc.buffer = buildBrownNoise(c)
  noiseSrc.loop = true

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = tone.cut
  lp.Q.value = 0.35

  const noiseGain = c.createGain()
  noiseGain.gain.value = tone.noise

  noiseSrc.connect(lp)
  lp.connect(noiseGain)

  // 层 2：双失谐低频正弦 = 画廊嗡鸣（慢拍频，频率随房间变化）
  const droneA = c.createOscillator()
  droneA.type = 'sine'
  droneA.frequency.value = tone.a
  const droneB = c.createOscillator()
  droneB.type = 'sine'
  droneB.frequency.value = tone.b

  const droneGain = c.createGain()
  droneGain.gain.value = tone.drone

  droneA.connect(droneGain)
  droneB.connect(droneGain)

  // 呼吸 LFO：极慢调制总音量
  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.045
  const lfoGain = c.createGain()
  lfoGain.gain.value = 0.006

  const master = c.createGain()
  master.gain.setValueAtTime(0.0001, t)

  lfo.connect(lfoGain)
  lfoGain.connect(master.gain)
  noiseGain.connect(master)
  droneGain.connect(master)
  master.connect(c.destination)

  noiseSrc.start(t)
  droneA.start(t)
  droneB.start(t)
  lfo.start(t)

  // 3.2s 缓入
  master.gain.setTargetAtTime(1, t, 1.4)

  amb = { noiseSrc, droneA, droneB, lfo, master, lp, noiseGain, droneGain }
}

function stopAmbience() {
  if (!amb || !ctx) return
  const c = ctx
  const nodes = amb
  amb = null
  const t = c.currentTime
  nodes.master.gain.setTargetAtTime(0.0001, t, 0.45)
  if (ambFadeTimer) clearTimeout(ambFadeTimer)
  ambFadeTimer = setTimeout(() => {
    try {
      nodes.noiseSrc.stop()
      nodes.droneA.stop()
      nodes.droneB.stop()
      nodes.lfo.stop()
      nodes.master.disconnect()
    } catch {
      /* 已停止则忽略 */
    }
  }, 1600)
}

/** 根据全局状态同步环境音（静音 / 环境音开关 / AudioContext 可用性） */
export function syncAmbience() {
  if (typeof window === 'undefined') return
  const { muted, ambient } = useBookStore.getState()
  const want = !muted && ambient
  // AudioContext 尚未创建（无手势）时暂不启动；首次翻页声会创建它并再次调用本函数
  if (want && ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    startAmbience(ctx)
  } else if (!want) {
    stopAmbience()
  }
}

/** 手势解锁音频后由翻页声 / 开书声调用，把环境音带起来 */
export function onAudioUnlocked() {
  syncAmbience()
}
