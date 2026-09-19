"use client"

/**
 * Tiny Web Audio helpers — a clock "tick" for the final countdown and a "boom"
 * for the blast. Synthesized so we ship no audio files. The AudioContext is
 * created lazily and resumed on each call (it was unlocked by the user's click
 * when creating/opening the room).
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new AC()
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/** A single clock tick. `urgent` makes it higher-pitched and louder. */
export function playTick(urgent = false) {
  const ac = getCtx()
  if (!ac) return
  const now = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = "square"
  osc.frequency.setValueAtTime(urgent ? 1400 : 900, now)
  const vol = urgent ? 0.14 : 0.08
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(vol, now + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  osc.connect(gain).connect(ac.destination)
  osc.start(now)
  osc.stop(now + 0.07)
}

/** Soft rising blip when you send a message or finish an upload. */
export function playSend() {
  const ac = getCtx()
  if (!ac) return
  const now = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = "sine"
  osc.frequency.setValueAtTime(520, now)
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.1)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.11, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  osc.connect(gain).connect(ac.destination)
  osc.start(now)
  osc.stop(now + 0.18)
}

/** Gentle two-note ding when a message arrives from someone else. */
export function playReceive() {
  const ac = getCtx()
  if (!ac) return
  const now = ac.currentTime
  const notes: [number, number][] = [
    [880, 0],
    [1174, 0.09],
  ]
  for (const [freq, t] of notes) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(freq, now + t)
    gain.gain.setValueAtTime(0.0001, now + t)
    gain.gain.exponentialRampToValueAtTime(0.1, now + t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.14)
    osc.connect(gain).connect(ac.destination)
    osc.start(now + t)
    osc.stop(now + t + 0.16)
  }
}

/** Explosion boom: noise burst + a descending low sine thud. */
export function playBoom() {
  const ac = getCtx()
  if (!ac) return
  const now = ac.currentTime

  // Noise burst through a closing low-pass filter.
  const dur = 0.9
  const buffer = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  }
  const noise = ac.createBufferSource()
  noise.buffer = buffer
  const lp = ac.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.setValueAtTime(1800, now)
  lp.frequency.exponentialRampToValueAtTime(120, now + dur)
  const nGain = ac.createGain()
  nGain.gain.setValueAtTime(0.9, now)
  nGain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(lp).connect(nGain).connect(ac.destination)
  noise.start(now)
  noise.stop(now + dur)

  // Sub thud.
  const osc = ac.createOscillator()
  const oGain = ac.createGain()
  osc.type = "sine"
  osc.frequency.setValueAtTime(120, now)
  osc.frequency.exponentialRampToValueAtTime(28, now + 0.5)
  oGain.gain.setValueAtTime(0.9, now)
  oGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
  osc.connect(oGain).connect(ac.destination)
  osc.start(now)
  osc.stop(now + 0.6)
}
