import type { SessionMode } from '../types/domain';
import type { XpLine } from '../types/state';

/**
 * XP, levels and the daily goal.
 *
 * Tuned so the default 30 XP goal takes TWO sessions, not one. A goal you clear
 * by accident on the first lesson stops being a goal.
 */

export interface XpContext {
  mode: SessionMode;
  score: number;
  questionCount: number;
  firstTime: boolean;
  wasDue: boolean;
  durationMs: number;
  hintsUsed: number;
  streakCurrent: number;
}

export function sessionXp(ctx: XpContext): { lines: XpLine[]; total: number } {
  const lines: XpLine[] = [];

  const base = ctx.mode === 'review' ? 8 : 10;
  lines.push({ label: ctx.mode === 'review' ? 'Review session' : 'Lesson', value: base });

  const accuracy = Math.round(ctx.score / 10);
  if (accuracy > 0) lines.push({ label: `Accuracy (${Math.round(ctx.score)}%)`, value: accuracy });

  const firstTime = ctx.firstTime ? 5 : 0;
  if (firstTime) lines.push({ label: 'First time through', value: firstTime });

  const reviewBonus = ctx.wasDue ? 5 : 0;
  if (reviewBonus) lines.push({ label: 'Cleared a due review', value: reviewBonus });

  const perfect = ctx.score === 100 && ctx.questionCount >= 2 ? 10 : 0;
  if (perfect) lines.push({ label: 'Perfect run', value: perfect });

  const speed = ctx.durationMs <= 90_000 && ctx.score >= 80 ? 3 : 0;
  if (speed) lines.push({ label: 'Quick and accurate', value: speed });

  const hintPenalty = ctx.hintsUsed * -2;
  if (hintPenalty) lines.push({ label: `Hints used (${ctx.hintsUsed})`, value: hintPenalty });

  const subtotal = base + accuracy + firstTime + reviewBonus + perfect + speed + hintPenalty;

  // Capped at 10 days so a long streak is a nudge, not a runaway multiplier
  // that makes a day-40 session worth four day-1 sessions.
  const multiplier = 1 + Math.min(Math.max(ctx.streakCurrent, 0), 10) * 0.02;
  if (multiplier > 1) {
    lines.push({
      label: `Streak bonus (x${multiplier.toFixed(2)})`,
      value: Math.round(subtotal * multiplier) - subtotal,
    });
  }

  return { lines, total: Math.max(1, Math.round(subtotal * multiplier)) };
}

/* -------------------------------------------------------------- levels --- */

/** Total XP required to REACH level n. L1=0, L2=50, L3=150, L4=300, L5=500. */
export function xpForLevel(n: number): number {
  const k = Math.max(0, n - 1);
  return 25 * k * k + 25 * k;
}

export function levelFromXp(xp: number): number {
  return Math.floor((-1 + Math.sqrt(1 + Math.max(0, xp) / 6.25)) / 2) + 1;
}

export interface LevelInfo {
  level: number;
  title: string;
  intoLevel: number;
  forNextLevel: number;
  progress: number;
}

const TITLES: [number, string][] = [
  [20, 'Master'],
  [15, 'Scholar'],
  [10, 'Adept'],
  [6, 'Practitioner'],
  [3, 'Apprentice'],
  [1, 'Novice'],
];

export function levelTitle(level: number): string {
  return TITLES.find(([min]) => level >= min)?.[1] ?? 'Novice';
}

export function levelInfo(totalXp: number): LevelInfo {
  const level = levelFromXp(totalXp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const intoLevel = Math.max(0, totalXp - floor);
  return {
    level,
    title: levelTitle(level),
    intoLevel,
    forNextLevel: span,
    progress: Math.max(0, Math.min(1, intoLevel / span)),
  };
}
