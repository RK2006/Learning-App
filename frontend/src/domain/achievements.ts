import type { Concept } from '../types/domain';
import type { AppState, SessionRecord, StreakState } from '../types/state';
import { effectiveMastery, COMPLETED_AT } from './mastery';
import { daysBetween } from './time';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  tier: 'common' | 'rare' | 'epic' | 'legendary';
  xp: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_steps', name: 'First Steps', description: 'Complete your first session', tier: 'common', xp: 20 },
  { id: 'path_finder', name: 'Path Finder', description: 'Create your first course', tier: 'common', xp: 10 },
  { id: 'perfect_run', name: 'Perfect Run', description: 'Score 100% on a session', tier: 'rare', xp: 30 },
  { id: 'week_one', name: 'Week One', description: 'Reach a 7-day streak', tier: 'rare', xp: 50 },
  { id: 'unshakeable', name: 'Unshakeable', description: 'Reach a 30-day streak', tier: 'legendary', xp: 200 },
  { id: 'comeback_kid', name: 'Comeback Kid', description: 'Return after 3 days away and hit your goal', tier: 'rare', xp: 25 },
  { id: 'night_owl', name: 'Night Owl', description: 'Finish a session between 10pm and 4am', tier: 'common', xp: 15 },
  { id: 'early_bird', name: 'Early Bird', description: 'Finish a session between 5am and 8am', tier: 'common', xp: 15 },
  { id: 'clean_sweep', name: 'Clean Sweep', description: 'Clear a review queue of 5 or more in a day', tier: 'epic', xp: 40 },
  { id: 'deep_diver', name: 'Deep Diver', description: 'Hold 5 concepts at 80% or better at once', tier: 'epic', xp: 60 },
  { id: 'polymath', name: 'Polymath', description: 'Study 3 different courses', tier: 'epic', xp: 50 },
  { id: 'course_complete', name: 'Course Complete', description: 'Take every concept in a course to 80%', tier: 'legendary', xp: 250 },
  { id: 'on_the_books', name: 'On The Books', description: 'Export your study plan to a calendar', tier: 'common', xp: 15 },
  {
    id: 'honest_learner',
    name: 'Honest Learner',
    description: 'Score below 50% on a concept, then above 85% on your next try',
    tier: 'epic',
    xp: 35,
  },
];

export const ACHIEVEMENTS_BY_ID: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

export interface AchievementContext {
  state: AppState;
  record: SessionRecord;
  concepts: Concept[];
  streak: StreakState;
  at: number;
  /** Scores on the session's concepts BEFORE this session. */
  previousScores: number[];
  queueClearedFrom: number;
}

/**
 * Pure evaluation. Returns ids newly unlocked by this session.
 *
 * `honest_learner` is the one worth keeping: it rewards the failure-then-recovery
 * arc, which is the actual thesis of an adaptive learning app, and nothing else
 * in the list rewards getting something wrong first.
 */
export function checkAchievements(ctx: AchievementContext): string[] {
  const { state, record, concepts, streak, at, previousScores } = ctx;
  const have = (id: string) => Boolean(state.achievements[id]);
  const out: string[] = [];
  const add = (id: string) => {
    if (!have(id) && !out.includes(id)) out.push(id);
  };

  add('first_steps');
  if (state.courses.length > 0) add('path_finder');

  if (record.score === 100 && record.total >= 2) add('perfect_run');
  if (streak.current >= 7) add('week_one');
  if (streak.current >= 30) add('unshakeable');

  const hour = new Date(at).getHours();
  if (hour >= 22 || hour < 4) add('night_owl');
  if (hour >= 5 && hour < 8) add('early_bird');

  if (ctx.queueClearedFrom >= 5) add('clean_sweep');

  const strong = concepts.filter((c) => effectiveMastery(c, at) >= COMPLETED_AT).length;
  if (strong >= 5) add('deep_diver');
  if (concepts.length > 0 && strong === concepts.length) add('course_complete');

  const studied = new Set(state.sessions.map((s) => s.courseId));
  studied.add(record.courseId);
  if (studied.size >= 3) add('polymath');

  // Failure -> recovery, on the same concept, on consecutive attempts.
  if (record.score >= 85 && previousScores.some((s) => s < 50)) add('honest_learner');

  // Returned from a real absence and still hit the goal.
  if (streak.lastGoalDate && state.streak.lastGoalDate) {
    const gap = daysBetween(state.streak.lastGoalDate, streak.lastGoalDate);
    if (gap >= 3) add('comeback_kid');
  }

  return out;
}
