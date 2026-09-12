import type { AppAction, AppState, DayStat, SessionRecord } from '../types/state';
import type { AssessmentResult, Concept, LoggedMisconception, SessionMode } from '../types/domain';
import { dayKey, now } from '../domain/time';
import { effectiveMastery, hasAttempted, nextMastery, restatus } from '../domain/mastery';
import { isDue, schedule } from '../domain/srs';
import { sessionXp } from '../domain/xp';
import { updateStreak } from '../domain/streak';
import { ACHIEVEMENTS_BY_ID, checkAchievements } from '../domain/achievements';
import { buildQueue } from '../domain/srs';
import { LIMITS } from './initial';

/**
 * Merge this session's misconceptions into a concept's log, PURELY.
 *
 * Every entry is rebuilt rather than bumped in place. The obvious version --
 * `merged.find(...).count += 1` over a shallow-copied array -- reaches through
 * and mutates the objects still held by the previous state, which quietly
 * defeats reference equality for anything memoizing on them and makes the old
 * state no longer a truthful record of what it was.
 */
function mergeMisconceptions(
  existing: LoggedMisconception[],
  incoming: string[],
  score: number,
  at: number,
): LoggedMisconception[] {
  const seen = new Set(incoming);
  const merged: LoggedMisconception[] = existing.map((m) =>
    seen.has(m.text) ? { ...m, count: m.count + 1, lastSeen: at, resolvedAt: null } : m,
  );
  for (const text of incoming) {
    if (!existing.some((m) => m.text === text)) {
      merged.push({ text, count: 1, lastSeen: at, resolvedAt: null });
    }
  }
  // Scoring well retires everything still outstanding on this concept -- this
  // is what drives the Progress screen's "resolved" section and the
  // honest_learner achievement.
  return score >= 85 ? merged.map((m) => (m.resolvedAt == null ? { ...m, resolvedAt: at } : m)) : merged;
}

export interface SessionOutcome {
  courseId: string;
  conceptIds: string[];
  mode: SessionMode;
  startedAt: number;
  assessment: AssessmentResult;
  answers: Record<string, string>;
  correct: number;
  total: number;
  hintsUsed: number;
  /**
   * True when NOT ONE answer in the session received a mark.
   *
   * Only reachable when the grader was unreachable for every question and the
   * recap could not be reached either, so `assessment.score` is 0 for want of
   * anything to average -- not because the learner scored 0.
   *
   * The session still commits: XP for the time spent, the day stat, the streak,
   * the history entry. What must NOT happen is writing that 0 into mastery,
   * `bestScore`, `scoreHistory` or the review schedule, because every one of
   * those is a claim about how well the learner knows the concept, and nothing
   * in this session found that out. Tanking someone's mastery for our outage is
   * a worse failure than the lost session this commit path was written to
   * prevent.
   */
  unscored?: boolean;
}

/**
 * Build the one atomic COMMIT_SESSION action.
 *
 * Everything moves together here -- mastery, scheduling, XP, the day stat, the
 * streak, achievements and history. Splitting them across several dispatches is
 * the classic bug in this shape of app: XP awarded but mastery not, or a streak
 * bumped for a session that never made it into history. One action, one
 * transition, one persistence write.
 *
 * PRACTICE MODE IS FREE: it updates neither mastery nor scheduling, which is
 * what makes "Drill this" safe to press repeatedly.
 */
/**
 * @param at Injectable so the demo seeder can replay a fortnight of sessions
 *           through this exact function. Anything that generates history has to
 *           go through the real engines or it will drift away from them.
 */
export function buildCommit(state: AppState, outcome: SessionOutcome, at: number = now()): AppAction {
  const today = dayKey(at, state.settings.timeZone);
  const course = state.courses.find((c) => c.id === outcome.courseId);
  const concepts = course?.concepts ?? [];

  const score = outcome.assessment.score;
  const isPractice = outcome.mode === 'practice';
  // Practice is free by design; an unscored session is free because there is no
  // score to spend. Both leave mastery and scheduling exactly where they were.
  const leavesMasteryAlone = isPractice || outcome.unscored === true;

  const masteryBefore: Record<string, number> = {};
  const masteryAfter: Record<string, number> = {};
  const previousScores: number[] = [];
  let anyWasDue = false;
  let anyFirstTime = false;

  const updated: Concept[] = concepts.map((c) => {
    if (!outcome.conceptIds.includes(c.id)) return c;

    const before = effectiveMastery(c, at);
    masteryBefore[c.id] = before;
    previousScores.push(...c.scoreHistory.slice(-1));
    // hasAttempted, not reps: reps resets on a lapse, so gating on it paid
    // the "first time through" bonus again every time someone failed.
    if (!hasAttempted(c)) anyFirstTime = true;
    if (isDue(c, today)) anyWasDue = true;

    if (leavesMasteryAlone) {
      masteryAfter[c.id] = before;
      return { ...c, attempts: c.attempts + 1 };
    }

    // Applied to the DECAYED value, not the stored one -- otherwise any session
    // would silently erase the decay for free.
    const after = nextMastery(before, score, !hasAttempted(c));
    masteryAfter[c.id] = after;

    const merged = mergeMisconceptions(c.misconceptions, outcome.assessment.misconceptions, score, at);

    return {
      ...c,
      mastery: after,
      peakMastery: Math.max(c.peakMastery, after),
      attempts: c.attempts + 1,
      lastStudiedAt: at,
      bestScore: Math.max(c.bestScore, score),
      scoreHistory: [...c.scoreHistory, score].slice(-LIMITS.scoreHistory),
      misconceptions: merged,
      review: schedule(c.review, score, today),
      masteryHistory: [...c.masteryHistory, { at, value: after }].slice(-LIMITS.masteryHistory),
    };
  });

  const withStatus = restatus(updated, today, at);

  const { lines, total: xpAwarded } = sessionXp({
    mode: outcome.mode,
    score,
    questionCount: outcome.total,
    firstTime: anyFirstTime,
    wasDue: anyWasDue,
    durationMs: at - outcome.startedAt,
    hintsUsed: outcome.hintsUsed,
    streakCurrent: state.streak.current,
  });

  const prevDay: DayStat = state.days[today] ?? { xp: 0, sessions: 0, ms: 0, goalMet: false, freezeUsed: false };
  const xpToday = prevDay.xp + xpAwarded;
  const goalMet = xpToday >= state.settings.dailyGoalXp;

  const streakUpdate = updateStreak(state.streak, today, goalMet);

  const day: DayStat = {
    xp: xpToday,
    sessions: prevDay.sessions + 1,
    ms: prevDay.ms + (at - outcome.startedAt),
    goalMet,
    freezeUsed: prevDay.freezeUsed,
  };

  const record: SessionRecord = {
    id: `s_${at}`,
    courseId: outcome.courseId,
    conceptIds: outcome.conceptIds,
    mode: outcome.mode,
    startedAt: outcome.startedAt,
    finishedAt: at,
    durationMs: at - outcome.startedAt,
    score,
    correct: outcome.correct,
    total: outcome.total,
    xpAwarded,
    achievementXp: 0,
    hintsUsed: outcome.hintsUsed,
    xpLines: lines,
    masteryBefore,
    masteryAfter,
    assessment: outcome.assessment,
    answers: outcome.answers,
  };

  const queueBefore = buildQueue(state.courses, today, { at }).length;

  const unlockedAchievements = checkAchievements({
    state,
    record,
    concepts: withStatus,
    streak: streakUpdate.streak,
    at,
    previousScores,
    queueClearedFrom:
      queueBefore >= 5 &&
      buildQueue([{ id: outcome.courseId, concepts: withStatus }], today, { at }).length === 0
        ? queueBefore
        : 0,
  });

  /**
   * Achievement bonuses go to the LEVEL, never to the daily goal.
   *
   * Not a style choice -- it breaks a real loop. The daily goal decides whether
   * the streak extends, the streak is what unlocks `week_one`, and `week_one`
   * pays 50 XP. Feeding that back into the same day's goal means the reward
   * for a streak can retroactively create the day that earned it. Paying it to
   * totalXp keeps the level moving and leaves the goal measuring only the work.
   */
  record.achievementXp = unlockedAchievements.reduce(
    (sum, id) => sum + (ACHIEVEMENTS_BY_ID[id]?.xp ?? 0),
    0,
  );

  return {
    type: 'COMMIT_SESSION',
    payload: {
      record,
      concepts: withStatus,
      day,
      streak: streakUpdate.streak,
      today,
      freezeUsedOn: streakUpdate.freezeUsedOn,
      unlockedAchievements,
      at,
    },
  };
}
