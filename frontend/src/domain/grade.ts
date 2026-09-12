import type { Question } from '../types/domain';

/**
 * What this device is allowed to decide, and the honest third answer.
 *
 * A verdict is `true`, `false`, or `null` meaning NOT GRADED. That third case
 * is the whole point of this module. The code it replaces read:
 *
 *   const correct = expected == null ? true : value === expected;
 *
 * under a comment claiming it recorded the answer "without claiming a verdict".
 * It claimed the best possible verdict, so every short answer was marked
 * Correct the instant it was submitted -- for any text at all, including a
 * single character. An adaptive learning app that tells you you are right
 * regardless of what you typed is worse than one that says nothing, because it
 * teaches you to trust it.
 *
 * WHAT IS NO LONGER HERE, AND WHY. This module used to carry a keyword grader:
 * `matchRubric`, a hand-rolled stemmer, and a rubric derived from the model
 * answer's vocabulary. It graded every free-response answer in the session,
 * and it failed in both directions at once:
 *
 *   "Conditioning changes the denominators"       -> marked WRONG
 *        (the rubric said "conditional"/"denominator"; a plural missed)
 *   "Hannibal captured many cities but not Rome"  -> marked RIGHT
 *        (all three keywords present, and a bag of words cannot see "not")
 *
 * The stemmer fixed the first family and could never fix the second: negation
 * is invisible to word matching, so a correct answer and its exact opposite
 * score identically. Prose needs a reader, and there is exactly one reader in
 * this system -- the model behind `/grade`. Every free-response verdict the
 * learner sees now comes from it, and when it cannot be reached the answer is
 * recorded UNGRADED rather than guessed at by counting words. A second,
 * weaker grader standing in for the first is what produced "wrong during the
 * lesson, right in the recap"; keeping one on the bench invites it back.
 */

/**
 * Multiple choice, and multiple choice only.
 *
 * Here the answer IS one of the options, so string equality is not an
 * approximation of the right check -- it is the right check, instant and free,
 * and incapable of disagreeing with the recap because the recap is handed this
 * same verdict. A short answer's `correctAnswer` is a model answer in prose,
 * and comparing a learner's sentence to it character by character marks every
 * correct answer wrong, so anything that is not multiple choice returns `null`
 * and must be sent to the grader instead.
 *
 * Callers must treat null as its own case: no combo, no correct-count, and a
 * neutral verdict in the UI.
 */
export function checkMultipleChoice(q: Question, answer: string): boolean | null {
  if (q.type !== 'multipleChoice') return null;
  const value = answer.trim();
  if (value.length === 0) return false;
  if (q.correctAnswer == null) return null;
  return value.localeCompare(q.correctAnswer.trim(), undefined, { sensitivity: 'base' }) === 0;
}

/**
 * The mean of marks the learner has ALREADY BEEN SHOWN.
 *
 * The one number that cannot contradict them, and deliberately the same
 * arithmetic the server does in `/assess` (backend/app/main.py) so a session
 * scored here and a session scored there land on the same value. A second
 * independent judgement over the same answers is exactly what produced "wrong
 * during, right at the end" -- and no prompt wording fixes that, because the
 * problem was having two graders at all rather than a badly behaved one.
 *
 * Questions that were never graded are not in `results`, so they do not pull
 * the average down. Scoring an ungraded answer 0 would punish the learner for
 * a grader we could not reach.
 */
export function meanScore(results: readonly { score: number }[]): number {
  if (results.length === 0) return 0;
  const sum = results.reduce((t, r) => t + Math.max(0, Math.min(100, Math.round(r.score))), 0);
  return Math.round(sum / results.length);
}

/** Misconceptions as named by the grader that saw each answer, deduplicated,
 *  order preserved. Same rule as the server's: carried through, never
 *  re-derived from marks. */
export function carriedMisconceptions(
  results: readonly { misconception?: string | null }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    const m = (r.misconception ?? '').trim();
    if (m && !seen.has(m.toLowerCase())) {
      seen.add(m.toLowerCase());
      out.push(m);
    }
  }
  return out;
}
