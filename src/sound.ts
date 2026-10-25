// Tiny synthesized cues. No audio files; one AudioContext made on the first cue, suspended when quiet.
const KEY = 'pocket-farm-sound'
const IDLE_MS = 2000

// [wave, start Hz, end Hz, start offset s, duration s, peak gain]. 'noise' is filtered white noise; its Hz sweep the band.
type Tone = [OscillatorType | 'noise', number, number, number, number, number]

const CUES = {
  pluck: [['triangle', 660, 440, 0, 0.16, 0.22]],
  splash: [['noise', 1600, 350, 0, 0.35, 0.3]],
  reel: [
    ['triangle', 420, 700, 0, 0.12, 0.16],
    ['triangle', 560, 940, 0.12, 0.16, 0.16],
  ],
  coin: [
    ['square', 988, 988, 0, 0.08, 0.08],
    ['square', 1319, 1319, 0.08, 0.28, 0.08],
  ],
  bark: [
    ['sawtooth', 560, 330, 0, 0.09, 0.14],
    ['sawtooth', 620, 360, 0.14, 0.1, 0.12],
  ],
  chime: [
    ['sine', 1047, 1047, 0, 0.38, 0.18],
    ['sine', 1568, 1568, 0.09, 0.3, 0.12],
  ],
} satisfies Record<string, Tone[]>

export type Cue = keyof typeof CUES

let muted = false
try {
  muted = localStorage.getItem(KEY) === 'off'
} catch {}

let ctx: AudioContext | undefined
let out: AudioNode
let noise: AudioBuffer
let idle: ReturnType<typeof setTimeout> | undefined

export const isMuted = () => muted

export function setMuted(m: boolean) {
  muted = m
  try {
    localStorage.setItem(KEY, m ? 'off' : 'on')
  } catch {}
  if (m) ctx?.suspend()
}

// Must first run inside a user gesture, or the browser keeps the context suspended.
export function play(cue: Cue) {
  if (muted) return
  if (!ctx) {
    ctx = new AudioContext()
    // A gentle lowpass over every cue keeps square and saw waves soft.
    const lp = new BiquadFilterNode(ctx, { frequency: 3200 })
    lp.connect(ctx.destination)
    out = lp
    noise = new AudioBuffer({ length: ctx.sampleRate * 0.4, sampleRate: ctx.sampleRate })
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state !== 'running') ctx.resume()
  const t0 = ctx.currentTime + 0.01
  for (const [wave, f0, f1, at, dur, peak] of CUES[cue] as Tone[]) {
    const s = t0 + at
    const env = new GainNode(ctx, { gain: 0 })
    env.gain.setValueAtTime(0, s)
    env.gain.linearRampToValueAtTime(peak, s + 0.01)
    env.gain.exponentialRampToValueAtTime(0.0001, s + dur)
    env.connect(out)
    let src: AudioScheduledSourceNode
    if (wave === 'noise') {
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f0, Q: 0.8 })
      band.frequency.exponentialRampToValueAtTime(f1, s + dur)
      band.connect(env)
      src = new AudioBufferSourceNode(ctx, { buffer: noise })
      src.connect(band)
    } else {
      const osc = new OscillatorNode(ctx, { type: wave, frequency: f0 })
      osc.frequency.exponentialRampToValueAtTime(f1, s + dur)
      osc.connect(env)
      src = osc
    }
    src.start(s)
    src.stop(s + dur + 0.02)
  }
  clearTimeout(idle)
  idle = setTimeout(() => ctx?.suspend(), IDLE_MS)
}
