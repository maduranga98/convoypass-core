// Result feedback for the gate: a short generated tone (WebAudio, no audio files) and a vibration. Both are best
// effort and silent where unsupported. Colour is never the only signal: every result also has an icon and text.

export type FeedbackKind = 'ok' | 'blocked'

let ctx: AudioContext | null = null

function beep(audio: AudioContext, freq: number, start: number, duration: number, type: OscillatorType): void {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(0.3, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** Approved: two rising high beeps. Blocked: one low buzz. */
export function playTone(kind: FeedbackKind): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    if (kind === 'ok') {
      beep(ctx, 880, now, 0.12, 'sine')
      beep(ctx, 1320, now + 0.15, 0.18, 'sine')
    } else {
      beep(ctx, 196, now, 0.45, 'square')
    }
  } catch {
    // no audio: the screen still says it all
  }
}

export function vibrate(kind: FeedbackKind): void {
  try {
    navigator.vibrate?.(kind === 'ok' ? 120 : [250, 100, 250])
  } catch {
    // unsupported
  }
}

export function feedback(kind: FeedbackKind, soundOn: boolean): void {
  vibrate(kind)
  if (soundOn) playTone(kind)
}
