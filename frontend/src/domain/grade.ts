import type { Question } from '../types/domain';

/**
 * Local grading, and an honest third answer.
 *
 * A verdict is `true`, `false`, or `null` meaning NOT GRADED. That third case
 * is the whole point of this module. The code it replaces read:
 *
 *   const correct = expected == null ? true : value === expected;
 *
 * under a comment claiming it recorded the answer "without claiming a verdict".
 * It claimed the best possible verdict. Short-answer questions carry no
 * `correctAnswer`, so every one of them was marked Correct the instant it was
 * submitted -- green footer, "Correct", combo incremented -- for any text at
 * all, including a single character. An adaptive learning app that tells you
 * you are right regardless of what you typed is worse than one that says
 * nothing, because it teaches you to trust it.
 */

/** Words too common to be evidence of anything. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'was', 'were', 'be', 'been',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'that', 'this', 'it', 'its', 'as', 'by', 'from',
  'you', 'your', 'we', 'i', 'they', 'not', 'no', 'can', 'will', 'would', 'so', 'do', 'does',
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export interface RubricMatch {
  found: string[];
  missed: string[];
  required: number;
  passed: boolean;
}

/**
 * Keyword overlap, not comprehension.
 *
 * A keyword matches if it appears whole, or -- for multi-word keys -- if every
 * one of its significant words appears somewhere in the answer. Substring
 * matching would let "rate" satisfy "separate", so the comparison is on token
 * boundaries.
 *
 * This is deliberately coarse and the UI says so. It exists to keep the loop
 * honest until the backend can grade semantically; it is not pretending to be
 * that.
 */
export function matchRubric(rubric: { keywords: string[]; required: number }, answer: string): RubricMatch {
  const answerTokens = new Set(tokens(answer));
  const found: string[] = [];
  const missed: string[] = [];

  for (const key of rubric.keywords) {
    const parts = tokens(key);
    const hit = parts.length > 0 && parts.every((p) => answerTokens.has(p));
    (hit ? found : missed).push(key);
  }

  const required = Math.max(1, Math.min(rubric.required || 1, rubric.keywords.length));
  return { found, missed, required, passed: found.length >= required };
}

/**
 * `null` means "we could not grade this" -- never "correct".
 *
 * Callers must treat null as its own case: no combo, no correct-count, and a
 * neutral verdict in the UI.
 */
export function gradeLocally(q: Question, answer: string): boolean | null {
  const value = answer.trim();
  if (value.length === 0) return false;

  /**
   * Exact match is for multiple choice ONLY.
   *
   * There the answer IS one of the options, so string equality is exactly
   * right. A short answer's `correct_answer` is a model answer in prose --
   * "The Punic Wars were significant for Rome's expansion as they led to the
   * destruction of Carthage..." -- and comparing a learner's sentence to that
   * character by character marks every correct answer wrong. Checking the key
   * before the rubric (which is what this did) was the same bug as the old
   * auto-correct, pointing the other way.
   */
  if (q.type === 'multipleChoice') {
    if (q.correctAnswer == null) return null;
    return value.localeCompare(q.correctAnswer.trim(), undefined, { sensitivity: 'base' }) === 0;
  }

  // Short answer: the rubric if the model gave us one...
  if (q.rubric && q.rubric.keywords.length > 0) {
    return matchRubric(q.rubric, value).passed;
  }
  // ...otherwise fall back to overlap with the model answer itself. Coarse, and
  // labelled as such in the UI, but far closer to the truth than either
  // "everything is right" or "nothing matches the prose exactly".
  if (q.correctAnswer != null) {
    return matchRubric(rubricFromModelAnswer(q.correctAnswer), value).passed;
  }
  return null;
}

/**
 * Derive a rubric from a prose model answer.
 *
 * Distinctive words only, and it asks for roughly half of them: a model answer
 * is one phrasing of a correct idea, not the only one, so demanding all of its
 * vocabulary would grade wording rather than understanding.
 */
export function rubricFromModelAnswer(modelAnswer: string): { keywords: string[]; required: number } {
  const keywords = Array.from(new Set(tokens(modelAnswer))).filter((w) => w.length > 3).slice(0, 8);
  return { keywords, required: Math.max(1, Math.ceil(keywords.length / 2)) };
}
