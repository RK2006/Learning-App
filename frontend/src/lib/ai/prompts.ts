/**
 * PROMPT BUILDERS -- reference and mock-side only. NOT the live prompts.
 *
 * CORRECTING WHAT THIS FILE USED TO CLAIM. The header here said these were
 * "already wired: httpProvider ships them to the backend". That was false, and
 * it stayed false for three phases. httpProvider never sent a prompt; it sent a
 * SetupRequest, and the backend built its own text from scratch in
 * llm_service.py. So prompts existed twice, with different wording, and the
 * live one was the thinner of the two -- a reviewer reading this file was
 * reviewing prose that never reached a model.
 *
 * That is resolved, and it is resolved in the only direction that works: the
 * prompts live where the API KEY lives, in backend/app/prompts.py, which is now
 * the single source of truth. The better text from this file moved there
 * wholesale -- the level guides, the misconception targeting, the data-fencing
 * rules -- along with several things it could not have known to say, like the
 * scale sentence that stops a perfect session being recorded as 2%.
 *
 * What remains here, and why it is not simply deleted:
 *
 *  - It documents the request types as executable prose. `contracts.ts` says
 *    what a GenerateLessonRequest contains; this says what each field is FOR.
 *  - The schemas are the reference the wire types are checked against by hand.
 *  - It is the reviewable artifact for anyone without backend access.
 *
 * THE RULE, so this does not drift again: changing a prompt means changing
 * backend/app/prompts.py. A change made only here changes nothing that any
 * learner will ever see. If the two disagree, the Python is right and this file
 * is stale.
 *
 * House style, shared by both copies:
 *  - State the learner's exact level and time budget; both change the answer.
 *  - Name the misconceptions to target. This is the difference between an
 *    adaptive lesson and a generic one.
 *  - Demand plain language and one concrete worked example.
 *  - Require strict JSON matching the paired schema -- no prose wrapper.
 */

import type {
  AssessResponseRequest,
  ExplainDifferentlyRequest,
  GenerateHintRequest,
  GenerateLessonRequest,
  GeneratePathRequest,
  GenerateQuestionsRequest,
  RecommendNextRequest,
  TeachBackRequest,
} from './contracts';

const LEVEL_GUIDE: Record<string, string> = {
  easy: 'Assume no background. Define every term on first use. Prefer everyday analogies over notation.',
  medium: 'Assume general familiarity with the subject area but not this specific concept. Introduce notation, then use it.',
  hard: 'Assume solid grounding. Move quickly, use precise terminology, and include an edge case or a common trap.',
};

const JSON_RULE =
  'Reply with a single JSON object and nothing else. No markdown fence, no commentary before or after.';

function misconceptionClause(list: string[]): string {
  if (list.length === 0) return '';
  return `\n\nThis learner has previously shown these specific misconceptions. Target them directly -- do not merely avoid them:\n${list
    .map((m) => `  - ${m}`)
    .join('\n')}`;
}

/* ---------------------------------------------------------------- path --- */

export function buildPathPrompt(r: GeneratePathRequest): string {
  return [
    `Design a ${r.conceptCount}-concept learning path for the topic: "${r.topic}".`,
    '',
    `Learner level: ${r.level}. ${LEVEL_GUIDE[r.level]}`,
    `Daily study budget: ${r.dailyTimeMin} minutes, so each concept must be teachable in one sitting of that length.`,
    r.goal ? `Their stated goal: "${r.goal}". Order the path so the earliest concepts serve that goal.` : '',
    r.priorKnowledge ? `They say they already know: "${r.priorKnowledge}". Do not spend a concept on it.` : '',
    '',
    'Requirements:',
    `  - Exactly ${r.conceptCount} concepts, ordered so each depends only on the ones before it.`,
    '  - Name each concept the way a practitioner would, not as a chapter title.',
    '  - The first concept must be genuinely approachable from zero.',
    '  - The last concept should be the one that makes the topic useful.',
    '',
    JSON_RULE,
  ]
    .filter(Boolean)
    .join('\n');
}

export const PATH_SCHEMA = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          order: { type: 'integer' },
          // No mastery, no status. A stateless server has never seen this
          // learner's answers, so asking the model for progress produced
          // brand-new courses with three concepts already "completed".
        },
        required: ['id', 'name', 'order'],
        additionalProperties: false,
      },
    },
  },
  required: ['concepts'],
  additionalProperties: false,
} as const;

/* -------------------------------------------------------------- lesson --- */

export function buildLessonPrompt(r: GenerateLessonRequest): string {
  const trend =
    r.attemptHistory.length > 0
      ? `\nTheir past scores on this concept, oldest first: ${r.attemptHistory.join(', ')}.`
      : '';

  return [
    r.isReview
      ? `Re-explain the concept "${r.conceptName}" from the topic "${r.topic}". The learner has already been taught this once and did not retain it, so do NOT repeat the previous framing -- come at it from a different angle.`
      : `Teach the concept "${r.conceptName}" from the topic "${r.topic}".`,
    '',
    `Learner level: ${r.level}. ${LEVEL_GUIDE[r.level]}`,
    `Budget: ${r.minutes} minutes of reading, so roughly ${Math.max(120, r.minutes * 90)} words across all slides.`,
    trend,
    misconceptionClause(r.misconceptionsToWatch),
    '',
    'Produce:',
    '  - 2 to 4 slides. The first states the idea in one sentence before elaborating.',
    '  - Exactly one slide of kind "example" containing a fully worked concrete case with real numbers.',
    '  - If two ideas are commonly confused here, include a slide of kind "contrast".',
    '  - 3 short objectives, each starting with a verb.',
    '  - 2 questions: one multiple-choice with 4 options, one short-answer.',
    '',
    'For the multiple-choice question, every distractor must be wrong for a DIFFERENT and diagnostic reason,',
    'and `misconception_on_wrong` must map each wrong option to the misconception choosing it reveals.',
    'Set `why` on both questions: one sentence on why the answer is what it is.',
    'For the short-answer question, set `rubric` to the key ideas a correct answer must contain.',
    '',
    JSON_RULE,
  ]
    .filter(Boolean)
    .join('\n');
}

export const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    concept: { type: 'string' },
    title: { type: 'string' },
    explanation: { type: 'string' },
    example: { type: 'string' },
    objectives: { type: 'array', items: { type: 'string' } },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['concept', 'example', 'contrast', 'recap'] },
          heading: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['id', 'kind', 'heading', 'body'],
        additionalProperties: false,
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['multiple-choice', 'short-answer'] },
          prompt: { type: 'string' },
          options: { type: ['array', 'null'], items: { type: 'string' } },
          correct_answer: { type: ['string', 'null'] },
          why: { type: ['string', 'null'] },
          misconception_on_wrong: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
          rubric: {
            type: ['object', 'null'],
            properties: {
              keywords: { type: 'array', items: { type: 'string' } },
              required: { type: 'integer' },
            },
            required: ['keywords', 'required'],
            additionalProperties: false,
          },
          hint: { type: ['string', 'null'] },
        },
        required: ['id', 'type', 'prompt', 'options', 'correct_answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['concept', 'title', 'explanation', 'example', 'questions'],
  additionalProperties: false,
} as const;

/* ----------------------------------------------------------- questions --- */

export function buildQuestionsPrompt(r: GenerateQuestionsRequest): string {
  return [
    `Write ${r.count} assessment questions on "${r.conceptName}" from the topic "${r.topic}".`,
    '',
    `Learner level: ${r.level}. ${LEVEL_GUIDE[r.level]}`,
    `Allowed question types: ${r.types.join(', ')}.`,
    r.targetMisconception
      ? `\nEvery question must be capable of exposing this specific misconception: "${r.targetMisconception}". A learner who holds it should get them wrong; a learner who does not should get them right.`
      : '',
    r.seenPrompts.length
      ? `\nThe learner has already seen these prompts. Do not reuse or lightly reword them:\n${r.seenPrompts
          .map((p) => `  - ${p}`)
          .join('\n')}`
      : '',
    '',
    'Test understanding, never recall of wording. Each question must be answerable from the concept alone.',
    '',
    JSON_RULE,
  ]
    .filter(Boolean)
    .join('\n');
}

/* -------------------------------------------------------------- assess --- */

export function buildAssessPrompt(r: AssessResponseRequest): string {
  const qa = r.lesson.questions
    .map((q) => {
      const given = r.answers[q.id] ?? '(no answer)';
      const expected = q.correctAnswer ? `\n    Expected: ${q.correctAnswer}` : '';
      return `  Q (${q.type}): ${q.prompt}${expected}\n    Learner answered: ${given}`;
    })
    .join('\n\n');

  return [
    `Evaluate a learner's work on "${r.conceptName}" from the topic "${r.topic}".`,
    '',
    'What they were taught:',
    `  ${r.lesson.explanation}`,
    `  Example given: ${r.lesson.example}`,
    '',
    'Their answers:',
    qa,
    '',
    'Grade on understanding, not wording. A correct idea expressed loosely scores well; the right words with a',
    'wrong idea underneath does not. Award partial credit on short answers.',
    '',
    'In `misconceptions`, name only errors the answers actually demonstrate -- return an empty array if there are',
    'none. Do not invent a misconception to seem useful. Each entry should be a short noun phrase naming the',
    'confusion itself (for example "reverses the condition and the event"), not a description of the mistake.',
    '',
    'Write `feedback` directly to the learner in at most three sentences: what they got right, the single most',
    'important thing to fix, and how to check themselves next time.',
    '',
    'Set `needs_review` to true if they would likely fail a similar question in three days.',
    '',
    JSON_RULE,
  ].join('\n');
}

export const ASSESS_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    correct: { type: 'boolean' },
    misconceptions: { type: 'array', items: { type: 'string' } },
    feedback: { type: 'string' },
    needs_review: { type: 'boolean' },
  },
  required: ['score', 'correct', 'misconceptions', 'feedback', 'needs_review'],
  additionalProperties: false,
} as const;

/* ---------------------------------------------------------------- hint --- */

export function buildHintPrompt(r: GenerateHintRequest): string {
  // `level` is an open number now, so the depth is INTERPOLATED rather than
  // looked up in a three-entry table -- otherwise hint 5 of 8 falls off the end
  // of the map and the prompt describes no depth at all.
  const share = r.maxLevel <= 1 ? 1 : (r.level - 1) / (r.maxLevel - 1);
  const depth =
    r.level <= 1
      ? 'A nudge. Point at what to think about. Do not narrow the answer.'
      : share >= 0.99
        ? 'Almost tell them. Walk up to the answer but stop one step short so they take it.'
        : `You are ${Math.round(share * 100)}% of the way from a gentle nudge to almost telling them. ` +
          'Rule out a wrong path and name the rule that applies, in more detail than the last hint.';

  return [
    `The learner is stuck on a question about "${r.conceptName}" (topic: "${r.topic}").`,
    '',
    `Question: ${r.question.prompt}`,
    r.partialAttempt ? `What they have so far: "${r.partialAttempt}"` : 'They have not attempted it yet.',
    '',
    `Hint ${r.level} of ${r.maxLevel}. ${depth}`,
    // Without the prior hints a stateless call regenerates hint 1 with a bigger
    // number attached, which is the whole failure mode escalation must avoid.
    r.priorHints.length
      ? `\nHints already given, in order. Yours must go strictly further and must not restate any:\n${r.priorHints
          .map((h, i) => `  ${i + 1}. ${h}`)
          .join('\n')}`
      : '',
    'One or two sentences. Never state the final answer. Never say "simply" or "just".',
    '',
    JSON_RULE,
  ]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------------------------------------- explain --- */

export function buildExplainDifferentlyPrompt(r: ExplainDifferentlyRequest): string {
  return [
    `A learner did not follow this explanation of "${r.conceptName}" (topic: "${r.topic}"):`,
    '',
    `  ${r.priorExplanation}`,
    '',
    `They said what lost them was: "${r.confusionPoint}"`,
    '',
    'Explain it again from a genuinely different direction. If the first attempt was formal, use a concrete story.',
    'If it was abstract, use numbers. Do not reuse its analogy or its sentence shapes. Address their specific',
    'confusion in the first sentence. Keep it under 120 words.',
    '',
    JSON_RULE,
  ].join('\n');
}

/* ----------------------------------------------------------- teach back --- */

export function buildTeachBackPrompt(r: TeachBackRequest): string {
  return [
    `A learner is explaining "${r.conceptName}" (topic: "${r.topic}") in their own words to show what they understand.`,
    '',
    'Their explanation:',
    `  "${r.explanation}"`,
    '',
    'Assess it as a teacher would:',
    '  - `understood`: ideas they have genuinely got, quoting their own phrasing where you can.',
    '  - `missing`: parts of the concept they did not mention that matter.',
    '  - `incorrect`: anything they stated that is actually wrong. Empty array if nothing is.',
    '  - `coverage`: 0-100, how much of the concept their explanation actually covers.',
    '  - `followUpQuestion`: one question that would expose whichever gap matters most.',
    '',
    'Be generous about phrasing and strict about substance. A rough explanation of the right idea is understanding;',
    'a polished explanation of the wrong idea is not.',
    '',
    JSON_RULE,
  ].join('\n');
}

/* --------------------------------------------------------------- next --- */

export function buildRecommendNextPrompt(r: RecommendNextRequest): string {
  const mastery = Object.entries(r.masteryByConcept)
    .map(([name, m]) => `  - ${name}: ${Math.round(m)}%`)
    .join('\n');

  return [
    `Decide what this learner should do next in "${r.topic}". They have ${r.minutesAvailable} minutes.`,
    '',
    'Current retention by concept (decayed since last practice):',
    mastery || '  (nothing studied yet)',
    '',
    r.overdueConcepts.length ? `Overdue for review: ${r.overdueConcepts.join(', ')}` : '',
    r.dueConcepts.length ? `Due today: ${r.dueConcepts.join(', ')}` : '',
    '',
    'Choose one action: "review" (shore up decaying material), "continue" (new concept), "practice" (drill a weak',
    'one without affecting scheduling), or "rest" (they have done enough today).',
    '',
    'Prefer review when anything is overdue -- advancing over a crumbling foundation is the failure mode this app',
    'exists to prevent. Give the reason in one sentence, addressed to the learner.',
    '',
    JSON_RULE,
  ]
    .filter(Boolean)
    .join('\n');
}
