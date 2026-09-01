/**
 * The imperative motion layer.
 *
 * Everything in this app that moves is driven from one of two places: a CSS
 * class (declarative, degrades through the token overrides in tokens.css) or
 * this module (imperative, must ask permission). The split matters because of
 * the single most common reduced-motion bug in hand-rolled animation:
 *
 *   A CSS MEDIA QUERY CANNOT STOP A RUNNING JS ANIMATION.
 *
 * `@media (prefers-reduced-motion)` rewrites CSS declarations. It has no
 * opinion whatsoever about a script writing inline transforms every frame. So
 * every imperative call routes through shouldAnimate() or animate() here, and
 * there is exactly one place to audit.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE WEB ANIMATIONS API AND NOT GSAP
 *
 * The plan specified GSAP, with Flip, MotionPath and DrawSVG. That was the
 * right call for the animation inventory as written, and the wrong one for the
 * inventory that survived contact with the design:
 *
 *   - MotionPath and DrawSVG were for the serpentine's connector line. The
 *     serpentine was rebuilt in Phase 5 as discs on a wave with no connector,
 *     so there is no path to follow and no line to draw.
 *   - Presses, entrances, staggers, feedback states, sheets and toasts all
 *     turned out to be expressible in CSS, where they also degrade for free.
 *   - What was actually left was one FLIP animation and some sequencing.
 *
 * Measured: gsap 32.1 KB gzip, + Flip 9.5 KB. That is 41.6 KB against a 140 KB
 * budget -- roughly a third of it -- for flyTo() below, which is forty lines,
 * and for sequencing that `await animation.finished` already expresses.
 *
 * The parts of GSAP that are genuinely hard to replace (timeline scrubbing,
 * morphing, inertia, plugin ecosystem) are not used here. If a later phase
 * needs them, this module is the seam to swap: nothing outside it imports an
 * animation API.
 */

/* ------------------------------------------------------------ permission --- */

/**
 * The one question every imperative animation must ask.
 *
 * Reads the attribute rather than matchMedia because the user's explicit
 * setting (Settings > Reduced motion) has to beat the OS preference in both
 * directions. lib/theme.ts resolves the two and stamps the result.
 */
export function shouldAnimate(): boolean {
  return document.documentElement.dataset.motion !== 'reduced';
}

/* ---------------------------------------------------------------- tokens --- */

/**
 * Durations and easings are READ FROM CSS, never written in JS.
 *
 * This is not tidiness. It is the only way the two halves of the motion system
 * can agree: a footer that slides up in CSS and a chit that flies into it in JS
 * have to share a curve, or the two land at visibly different moments. It also
 * means the reduced-motion token overrides reach imperative code for free --
 * shorten --d-4 and everything reading it shortens with it.
 */
let cache = new Map<string, string>();

// Durations and easings change when data-motion flips, so the cache cannot
// outlive an attribute change on the root element.
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => {
    cache = new Map();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-theme'] });
}

function token(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cache.set(name, value);
  return value;
}

/** A duration token (`--d-4`) in MILLISECONDS, which is what WAAPI wants. */
export function dur(name: string, fallbackMs = 240): number {
  const raw = token(name);
  if (raw.endsWith('ms')) return parseFloat(raw);
  if (raw.endsWith('s')) return parseFloat(raw) * 1000;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallbackMs;
}

/**
 * An easing token as a CSS string, which WAAPI accepts verbatim.
 *
 * This is the whole reason the imperative layer can share curves with the
 * stylesheet without a conversion table: `easing: 'cubic-bezier(0.22,1,0.36,1)'`
 * is the same declaration the CSS made, parsed by the same engine.
 */
export function easeCss(name: string, fallback = 'ease'): string {
  return token(name) || fallback;
}

/** A color token, for the places that genuinely need the value (confetti). */
export function color(name: string, fallback = '#000000'): string {
  return token(name) || fallback;
}

/**
 * Solve a cubic-bezier the way the browser does.
 *
 * Needed only where a value is interpolated by hand rather than by the
 * animation engine -- useCounter, which is counting a number rather than moving
 * a box, and so cannot hand the curve to WAAPI. Newton-Raphson converges in a
 * handful of iterations for the curves in tokens.css; bisection covers the
 * flat-slope case where Newton stalls.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }

    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 20 && Math.abs(sampleX(t) - x) > 1e-6; i++) {
      if (sampleX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

const LINEAR = (t: number) => t;
const easeCache = new Map<string, (t: number) => number>();

/** An easing token as a function, for hand-interpolated values. */
export function ease(name: string): (t: number) => number {
  const raw = token(name);
  const hit = easeCache.get(raw);
  if (hit) return hit;

  const match = /cubic-bezier\(([^)]+)\)/.exec(raw);
  if (!match) return LINEAR;
  const parts = match[1]!.split(',').map((n) => parseFloat(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return LINEAR;

  const fn = cubicBezier(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
  easeCache.set(raw, fn);
  return fn;
}

/* ------------------------------------------------------------- animating --- */

export interface AnimateOptions {
  durationToken?: string;
  easeToken?: string;
  delay?: number;
  fill?: FillMode;
}

/**
 * A WAAPI animation that obeys the motion preference.
 *
 * Under reduced motion it does NOT refuse to run -- it runs in a single frame,
 * so every end state lands and `finished` still resolves. That distinction is
 * the whole reason this helper exists: an animation that simply doesn't start
 * leaves elements stuck at their first keyframe, which is how a reduced-motion
 * user ends up staring at an invisible results screen. Skipping the JOURNEY is
 * accessibility; skipping the DESTINATION is a bug.
 *
 * Motion that is purely decorative -- confetti, a flourish with no end state to
 * preserve -- should be guarded with shouldAnimate() instead, so it never runs.
 */
export function animate(
  el: Element,
  keyframes: Keyframe[],
  { durationToken = '--d-3', easeToken = '--e-settle', delay = 0, fill = 'both' }: AnimateOptions = {},
): Animation {
  return el.animate(keyframes, {
    duration: shouldAnimate() ? dur(durationToken) : 1,
    easing: easeCss(easeToken),
    delay: shouldAnimate() ? delay : 0,
    fill,
  });
}

/**
 * Fly a copy of one element into another, and resolve when it lands.
 *
 * This is the FLIP idea reduced to the one case the app has: measure where the
 * thing is, measure where it should end up, and animate the difference. Used
 * for the XP chits, which have to accelerate INTO the running total rather than
 * fade somewhere near it.
 *
 * The point of measuring rather than hardcoding an offset is that the landing
 * spot is wherever the counter actually is -- at any window width, with the
 * list scrolled or not, in either theme. An offset that is correct at one
 * viewport is wrong at every other one.
 *
 * It is a CLONE that travels, not the element itself. Moving the original
 * pulls it out of the list it is laid out in, so the remaining rows jump to
 * close the gap at exactly the moment the user's eye is following something
 * else. The clone is `position: fixed`, aria-hidden, and removed on landing.
 */
export function flyTo(
  source: Element | null,
  target: Element | null,
  { durationToken = '--d-5', easeToken = '--e-squash', delay = 0 } = {},
): Promise<void> {
  // Decorative in full: the total is already correct and already on screen, so
  // there is no end state that would be lost by not running this.
  if (!source || !target || !shouldAnimate()) return Promise.resolve();

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return Promise.resolve();

  const clone = source.cloneNode(true) as HTMLElement;
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: 'var(--z-particles)',
  });
  document.body.appendChild(clone);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);

  const anim = clone.animate(
    [
      { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
      // Squashes as it arrives, which is what makes it read as being absorbed
      // by the counter rather than parked on top of it.
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.6)`, opacity: 0.25 },
    ],
    { duration: dur(durationToken), easing: easeCss(easeToken), delay, fill: 'both' },
  );

  return anim.finished
    .catch(() => undefined)
    .then(() => {
      clone.remove();
    });
}
