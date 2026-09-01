/**
 * Synthesised feedback tones. Opt-in, off by default.
 *
 * Why synthesis and not audio files: five short cues as .mp3 or .ogg is
 * somewhere north of 40 KB and a set of network requests, for sounds that are
 * each a couple of sine tones and an envelope. Web Audio makes them at runtime
 * for nothing, they scale to any sample rate, and there is no format-support
 * matrix to worry about.
 *
 * Why it is off until asked for: an app that makes noise on first load, in
 * whatever tab it happens to be in, is an app people mute at the OS level and
 * never trust again. `settings.sound` defaults to false and the Settings screen
 * is the visible affordance that turns it on -- which is also what the anti-slop
 * checklist means by "first load is silent with a visible enable affordance".
 *
 * The tones themselves are deliberately soft and short (under 300ms, low gain,
 * no sharp attack). In particular the wrong-answer cue is a gentle fall rather
 * than a buzzer: the mascot already refuses to do shame, and the sound should
 * not undo that.
 */

let enabled = false;
let ctx: AudioContext | null = null;

/** Mirrored from settings on hydrate and on change, like the clock offset. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  // Let a disabled context go: an AudioContext holds an audio device open, and
  // on a laptop that is a measurable amount of battery for silence.
  if (!on && ctx) {
    void ctx.close().catch(() => undefined);
    ctx = null;
  }
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/**
 * The context is created on first PLAY, never at import.
 *
 * Browsers refuse to start an AudioContext outside a user gesture, and one
 * created at module load is born `suspended` and stays that way -- which looks
 * like "sound is broken" rather than "sound is blocked". Every call site here
 * is already inside a click or a keypress, so creating it lazily means the
 * first sound is also the moment the context is allowed to exist.
 */
function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // Safari and Chrome both suspend on tab-away; resume is a no-op otherwise.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    // Blocked, unsupported, or too many contexts. Silence is an acceptable
    // outcome for a decorative channel -- never throw into a caller that is
    // in the middle of grading an answer.
    return null;
  }
}

interface Tone {
  freq: number;
  /** Seconds from the cue's start. */
  at: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
}

function play(tones: Tone[]): void {
  const ac = audio();
  if (!ac) return;

  const start = ac.currentTime;
  for (const t of tones) {
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.value = t.freq;

    const t0 = start + t.at;
    const peak = t.gain ?? 0.06;
    // A 12ms fade in and an exponential tail. A square-edged envelope produces
    // an audible click at both ends, which is most of what makes hand-rolled
    // UI sound cheap.
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + t.duration);

    osc.connect(amp).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + t.duration + 0.02);
  }
}

/* ------------------------------------------------------------------ cues --- */

const A4 = 440;
const note = (semitonesFromA4: number) => A4 * Math.pow(2, semitonesFromA4 / 12);

export type Cue = 'correct' | 'incorrect' | 'ungraded' | 'complete' | 'levelUp';

const CUES: Record<Cue, Tone[]> = {
  // A rising major third: the smallest interval that reads as "yes".
  correct: [
    { freq: note(4), at: 0, duration: 0.1 },
    { freq: note(9), at: 0.07, duration: 0.16 },
  ],
  // Falls, quietly. Not a buzzer, not a minor second, nothing that stings.
  incorrect: [
    { freq: note(-3), at: 0, duration: 0.13, gain: 0.05 },
    { freq: note(-8), at: 0.08, duration: 0.2, gain: 0.045 },
  ],
  // Neutral: one note, no direction, because no verdict was reached.
  ungraded: [{ freq: note(0), at: 0, duration: 0.14, gain: 0.045 }],
  complete: [
    { freq: note(4), at: 0, duration: 0.12 },
    { freq: note(9), at: 0.09, duration: 0.12 },
    { freq: note(12), at: 0.18, duration: 0.26 },
  ],
  levelUp: [
    { freq: note(0), at: 0, duration: 0.12 },
    { freq: note(7), at: 0.1, duration: 0.12 },
    { freq: note(12), at: 0.2, duration: 0.12 },
    { freq: note(16), at: 0.3, duration: 0.34, gain: 0.07 },
  ],
};

export function playCue(cue: Cue): void {
  play(CUES[cue]);
}
