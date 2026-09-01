import confetti from 'canvas-confetti';
import type { CreateTypes, Shape } from 'canvas-confetti';
import { color, shouldAnimate } from './motion';

/**
 * Confetti, in this app's inks and this app's shapes.
 *
 * Default canvas-confetti is circles and squares in primary colours, which
 * reads as "npm install confetti" from across a room. Two things fix that: the
 * particles are ink splats and torn ribbons (a path, drawn to match the
 * risograph vocabulary), and every colour is read from the live token set, so
 * celebration is the same palette as the rest of the page and follows the theme
 * into dark mode.
 */

/** Irregular on purpose -- a symmetrical splat looks like a logo, not like ink. */
const SPLAT =
  'M0 6C1 2.4 4.2 0 7.2 1.1C10.4 2.2 11.6 0 13 3.1C14.8 6.2 13.2 9.4 10.2 10.3C8.4 13.2 4.1 13.6 2 10.6C0.2 9.6-1 8 0 6Z';
/** A torn ribbon: two curved edges, deliberately not a rectangle. */
const RIBBON = 'M0 0C4 2.2 8-2 12.4 0.2L12.4 3.4C8 5.6 4 1.4 0 3.4Z';
/** A register mark -- the crosshair a printer aligns plates against. */
const REGISTER = 'M5 0H7V5H12V7H7V12H5V7H0V5H5Z';

let shapes: Shape[] | null = null;
let instance: CreateTypes | null = null;

function getShapes(): Shape[] {
  if (!shapes) {
    shapes = [
      confetti.shapeFromPath({ path: SPLAT }),
      confetti.shapeFromPath({ path: RIBBON }),
      confetti.shapeFromPath({ path: REGISTER }),
    ];
  }
  return shapes;
}

/**
 * One canvas for the life of the page, sized by the library.
 *
 * z-index comes from the token rather than the library's `zIndex` option,
 * because that option only applies to the canvas canvas-confetti creates for
 * itself -- and we need our own so the whole thing can be torn down on a route
 * change instead of leaking particles across screens.
 */
function getInstance(): CreateTypes | null {
  if (instance) return instance;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'confettiCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  instance = confetti.create(canvas, { resize: true, useWorker: true });
  return instance;
}

function inks(): string[] {
  return [
    color('--spark', '#F2B705'),
    color('--streak', '#FF6C2F'),
    color('--brand', '#0B6FB4'),
    color('--go', '#0E7A43'),
    color('--xp', '#D81E77'),
  ];
}

export type Celebration = 'goal' | 'levelUp' | 'perfect';

/**
 * Particle counts are capped well below what looks impressive in isolation.
 *
 * This fires at the same moment the XP counter is running and the mastery bar
 * is filling; the budget has to be shared. 'levelUp' gets the largest because
 * nothing else is moving under the overlay.
 */
const RECIPES: Record<Celebration, confetti.Options[]> = {
  perfect: [{ particleCount: 34, spread: 58, startVelocity: 32, scalar: 0.9, ticks: 110 }],
  goal: [
    { particleCount: 30, spread: 62, startVelocity: 36, angle: 70, scalar: 1, ticks: 140 },
    { particleCount: 30, spread: 62, startVelocity: 36, angle: 110, scalar: 1, ticks: 140 },
  ],
  levelUp: [
    { particleCount: 46, spread: 96, startVelocity: 42, scalar: 1.15, ticks: 170 },
    { particleCount: 26, spread: 130, startVelocity: 26, scalar: 0.8, ticks: 200, drift: 0.4 },
  ],
};

/**
 * `origin` is in canvas-confetti's normalized space: {x: 0..1, y: 0..1} from the
 * top-left of the viewport. Defaults to slightly above centre, where the eye is.
 */
export function celebrate(kind: Celebration, origin: { x: number; y: number } = { x: 0.5, y: 0.42 }): void {
  // Decorative, in full: there is no end state to land, so reduced motion skips
  // it outright rather than running it instantly.
  if (!shouldAnimate()) return;
  const fire = getInstance();
  if (!fire) return;

  const colors = inks();
  for (const recipe of RECIPES[kind]) {
    void fire({
      origin,
      colors,
      shapes: getShapes(),
      gravity: 1.1,
      decay: 0.92,
      disableForReducedMotion: true,
      ...recipe,
    });
  }
}

/** Fire from wherever an element actually is -- the ring, the flame, the chit. */
export function celebrateFrom(kind: Celebration, el: Element | null): void {
  if (!el) {
    celebrate(kind);
    return;
  }
  const r = el.getBoundingClientRect();
  celebrate(kind, {
    x: (r.left + r.width / 2) / Math.max(1, window.innerWidth),
    y: (r.top + r.height / 2) / Math.max(1, window.innerHeight),
  });
}

/** Clear anything still in flight. Called when a screen that celebrated leaves. */
export function stopCelebrating(): void {
  instance?.reset();
}
