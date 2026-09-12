/**
 * Runtime shape guards.
 *
 * Applied ONLY in httpProvider -- mock data is already typed, so validating it
 * would be theatre. A malformed backend response becomes an AiError('malformed')
 * with a useful message, instead of an `undefined.map` crash three components
 * deep.
 *
 * Hand-written rather than a schema library: this is ~50 lines against a
 * five-model contract, and a dependency would earn its place only if the
 * contract were large or changed often.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

export function isQuestionWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isStr(v.id) || !isStr(v.prompt)) return false;
  if (v.type !== 'multiple-choice' && v.type !== 'short-answer') return false;
  // options and correct_answer are optional AND nullable on the wire
  if (v.options != null && !isArr(v.options)) return false;
  if (v.correct_answer != null && !isStr(v.correct_answer)) return false;
  return true;
}

export function isSlideWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isStr(v.id) || !isStr(v.heading) || !isStr(v.body)) return false;
  return v.kind === 'concept' || v.kind === 'example' || v.kind === 'contrast' || v.kind === 'recap';
}

export function isLessonWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isStr(v.concept) || !isStr(v.title) || !isStr(v.explanation) || !isStr(v.example)) return false;
  if (!isArr(v.questions) || !v.questions.every(isQuestionWire)) return false;
  // Optional-and-nullable, because a lesson from an older backend has neither
  // and normalize.ts derives slides from the prose in that case. Checked when
  // present so a malformed slide fails here rather than as a blank card in the
  // teach stage.
  if (v.slides != null && (!isArr(v.slides) || !v.slides.every(isSlideWire))) return false;
  if (v.objectives != null && (!isArr(v.objectives) || !v.objectives.every(isStr))) return false;
  return true;
}

/**
 * `mastery` and `status` are NOT required, deliberately, and that change had to
 * ship before the backend was allowed to stop sending them.
 *
 * They looked dead: normalize.ts::toConcept ignores both and has a twenty-line
 * comment explaining why a stateless server cannot know a learner's progress.
 * But this guard still demanded them, and httpProvider throws
 * AiError('malformed') when a guard fails -- so a backend doing the obviously
 * correct thing and omitting two fields it has no business inventing would have
 * broken every single path fetch.
 *
 * That is the trap in "additive-only": the addition is safe, the REMOVAL is
 * breaking, and the removal is on the far side of the wire from the code that
 * blocks it. Client relaxes first, server drops second. Both orders "work" in
 * review; only one works at runtime.
 *
 * They are still VALIDATED when present, because a wrong type is a real
 * malformed response even though a missing one is not.
 */
export function isConceptWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isStr(v.id) || !isStr(v.name) || !isNum(v.order)) return false;
  if (v.mastery != null && !isNum(v.mastery)) return false;
  if (
    v.status != null &&
    v.status !== 'locked' &&
    v.status !== 'current' &&
    v.status !== 'completed' &&
    v.status !== 'needs-review'
  ) {
    return false;
  }
  return true;
}

export function isSetupResponseWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isStr(v.topic)) return false;
  return isArr(v.concepts) && v.concepts.every(isConceptWire);
}

export function isAssessmentWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isNum(v.score) || typeof v.correct !== 'boolean' || typeof v.needs_review !== 'boolean') return false;
  if (!isStr(v.feedback)) return false;
  return isArr(v.misconceptions) && v.misconceptions.every(isStr);
}


/* ---- guards for the tasks that gained routes in the unbounded phase ---- */

export function isQuestionsWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  return isArr(v.questions) && v.questions.every(isQuestionWire);
}

export function isHintWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  return isStr(v.text) && typeof v.exhausted === 'boolean';
}

export function isExplanationWire(v: unknown): boolean {
  return isObj(v) && isStr(v.explanation);
}

export function isTeachBackWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isNum(v.coverage) || !isStr(v.follow_up_question)) return false;
  return (
    isArr(v.understood) && v.understood.every(isStr) &&
    isArr(v.missing) && v.missing.every(isStr) &&
    isArr(v.incorrect) && v.incorrect.every(isStr)
  );
}

export function isRecommendationWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.action !== 'review' && v.action !== 'continue' && v.action !== 'practice' && v.action !== 'rest') {
    return false;
  }
  if (!isStr(v.reason)) return false;
  return isArr(v.concept_names) && v.concept_names.every(isStr);
}

export function isGradeWire(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isNum(v.score) || typeof v.correct !== 'boolean' || !isStr(v.feedback)) return false;
  return v.misconception == null || isStr(v.misconception);
}
