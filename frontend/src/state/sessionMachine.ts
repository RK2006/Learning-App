import type { AiErrorKind } from '../lib/ai/contracts';
import type { QuestionResult } from '../lib/ai/contracts';
import type { AssessmentResult, Lesson, Question, SessionMode } from '../types/domain';

/**
 * The lesson player's state machine.
 *
 * The stage the old build was missing entirely is FEEDBACK. Previously,
 * clicking an option WAS the submission: it recorded the answer and advanced in
 * one uncancellable click, with no selection state and no indication of whether
 * you were right. A Duolingo-style app that never once tells you whether you
 * got it right is a clickable mockup.
 */

export type Stage =
  | 'loading'
  | 'intro'
  | 'teach'
  | 'attempt'
  | 'feedback'
  | 'evaluating'
  | 'results'
  | 'error';

export interface SessionState {
  stage: Stage;
  mode: SessionMode;
  courseId: string;
  conceptIds: string[];
  lesson: Lesson | null;
  slideIndex: number;
  questionIndex: number;
  /** Selected but NOT yet committed. This is the whole point of the rewrite. */
  selected: string | null;
  draft: string;
  answers: Record<string, string>;
  revealed: boolean;
  lastCorrect: boolean | null;
  /** True while a free-response answer is with the grader. */
  grading: boolean;
  /** The grader's one-line note on the answer just submitted. */
  lastFeedback: string | null;
  /**
   * Which grader produced `lastCorrect` -- and there are only two, plus the
   * case where nobody did.
   *
   * 'model'    -- read by the grader. EVERY free-response verdict is this one.
   * 'exact'    -- multiple choice, compared against the option. Not an
   *               approximation of the right check; it IS the right check.
   * 'ungraded' -- the grader could not be reached, so there is no verdict and
   *               `lastCorrect` is null. This replaces a keyword fallback that
   *               graded prose on this device: it could not see negation, so
   *               "did not capture Rome" and "captured Rome" scored the same,
   *               and it disagreed with the recap about the same sentence.
   *               Saying nothing is the honest answer, and it costs the
   *               learner nothing -- an ungraded answer is left out of the
   *               score rather than counted wrong.
   */
  lastGradedBy: 'model' | 'exact' | 'ungraded' | null;
  /**
   * Every verdict this session, in order.
   *
   * Sent to /assess so the recap SUMMARISES rather than re-judges, and
   * averaged into the offline score by the same arithmetic the server uses.
   * Without it the session graded by keyword and the recap graded by meaning,
   * and a learner was told they were wrong mid-lesson and right at the end
   * about the same sentence.
   *
   * An UNGRADED answer is absent from this list, which is what keeps it out of
   * the score in both places rather than scoring it zero.
   */
  results: QuestionResult[];
  correctCount: number;
  combo: number;
  bestCombo: number;
  hearts: number;
  hintsUsed: number;
  hintText: string | null;
  /**
   * Every hint shown for the CURRENT question, in order.
   *
   * Required by the endpoint, not decoration. `/hint` is stateless, so given
   * only `level: 4` it regenerates roughly the level-1 nudge with a bigger
   * number attached -- hint 4 would be hint 1. Sending what was already said is
   * the only thing that makes the next one go further.
   *
   * Cleared on CONTINUE, because these are per-question and question 2's first
   * hint must not be told to escalate past question 1's last.
   */
  hintsForQuestion: string[];
  /** True once the server says there are no further levels. */
  hintsExhausted: boolean;
  skipsUsed: number;
  startedAt: number;
  assessment: AssessmentResult | null;
  /** The session was committed on the local check because /assess failed. */
  gradedLocally: boolean;
  gradingError: string | null;
  error: string | null;
  /** The AiError kind behind `error`, so the UI can say something useful and
   *  decide whether a Retry button would be honest. See lib/ai/errorCopy.ts. */
  errorKind: AiErrorKind | null;
  exitPrompt: boolean;
}

export type SessionAction =
  | { type: 'LOADED'; payload: { lesson: Lesson } }
  | { type: 'LOAD_FAILED'; payload: { message: string; kind?: AiErrorKind } }
  | { type: 'START' }
  | { type: 'SLIDE_NEXT' }
  | { type: 'SLIDE_PREV' }
  | { type: 'BEGIN_QUESTIONS' }
  | { type: 'SELECT'; payload: { value: string } }
  | { type: 'DRAFT'; payload: { value: string } }
  | { type: 'HINT'; payload: { text: string; exhausted?: boolean } }
  /** `correct: null` means UNGRADED -- no answer key and no rubric. It is not
   *  a synonym for false, and it must never be coerced to true. */
  | { type: 'GRADING' }
  | {
      type: 'CHECK';
      payload: {
        correct: boolean | null;
        /** 0..100. Defaults to 100/0 from `correct` when the grader gave none. */
        score?: number;
        feedback?: string | null;
        misconception?: string | null;
        gradedBy?: 'model' | 'exact' | 'ungraded';
      };
    }
  | { type: 'SKIP' }
  | { type: 'CONTINUE' }
  | {
      type: 'EVALUATED';
      payload: {
        assessment: AssessmentResult;
        /** True when /assess could not be reached and the score came from the
         *  average of the marks already shown instead. The results screen must
         *  say so -- a score presented as a model's considered judgement when
         *  nothing considered it is exactly the kind of quiet lie this app
         *  exists to remove. */
        gradedLocally?: boolean;
        /** Why the model grade is missing, for the banner. */
        gradingError?: string | null;
      };
    }
  | { type: 'EVALUATE_FAILED'; payload: { message: string; kind?: AiErrorKind } }
  | { type: 'PROMPT_EXIT'; payload: { open: boolean } }
  /**
   * Append a freshly generated batch to the run in flight.
   *
   * This is what "more practice, forever" is made of: rather than one enormous
   * generation (20 questions is 19.8s measured, and 40 would breach the client
   * timeout), the drill asks for a small batch and appends another when the
   * learner reaches the end.
   *
   * The ids MUST already be namespaced when they arrive. Answers are keyed by
   * question id, so a second batch that reused `mc1` would overwrite the first
   * batch's answer in the map and the grader would score the wrong text. Both
   * providers namespace server-side now; this reducer does not re-check,
   * because a silent de-duplication here would hide a real contract break.
   */
  | { type: 'APPEND_QUESTIONS'; payload: { questions: Question[] } };

export interface SessionInit {
  mode: SessionMode;
  courseId: string;
  conceptIds: string[];
  hearts: number;
  startedAt: number;
}

export function initSession(init: SessionInit): SessionState {
  return {
    stage: 'loading',
    mode: init.mode,
    courseId: init.courseId,
    conceptIds: init.conceptIds,
    lesson: null,
    slideIndex: 0,
    questionIndex: 0,
    selected: null,
    draft: '',
    answers: {},
    revealed: false,
    lastCorrect: null,
    grading: false,
    lastFeedback: null,
    lastGradedBy: null,
    results: [],
    correctCount: 0,
    combo: 0,
    bestCombo: 0,
    hearts: init.hearts,
    hintsUsed: 0,
    hintText: null,
    hintsForQuestion: [],
    hintsExhausted: false,
    skipsUsed: 0,
    startedAt: init.startedAt,
    assessment: null,
    gradedLocally: false,
    gradingError: null,
    error: null,
    errorKind: null,
    exitPrompt: false,
  };
}

export function currentQuestion(s: SessionState): Question | null {
  return s.lesson?.questions[s.questionIndex] ?? null;
}

export function questionCount(s: SessionState): number {
  return s.lesson?.questions.length ?? 0;
}

export function isLastQuestion(s: SessionState): boolean {
  return s.questionIndex >= questionCount(s) - 1;
}

/** Answered enough to submit? Trim-only -- no minimum length. A 20-character
 *  gate would reject the correct 15-character answer `P(A and B)/P(B)`. */
export function canCheck(s: SessionState): boolean {
  const q = currentQuestion(s);
  if (!q || s.grading) return false;
  return q.type === 'multipleChoice' ? s.selected != null : s.draft.trim().length > 0;
}

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case 'LOADED':
      return {
        ...s,
        lesson: a.payload.lesson,
        // Review and practice skip the teaching stage: you have been taught
        // this already, and re-reading it is not what the queue is for.
        stage: 'intro',
        error: null,
        errorKind: null,
      };

    case 'LOAD_FAILED':
      return { ...s, stage: 'error', error: a.payload.message, errorKind: a.payload.kind ?? null };

    case 'START':
      return { ...s, stage: s.mode === 'lesson' ? 'teach' : 'attempt' };

    case 'SLIDE_NEXT': {
      const last = (s.lesson?.slides.length ?? 1) - 1;
      if (s.slideIndex >= last) return { ...s, stage: 'attempt' };
      return { ...s, slideIndex: s.slideIndex + 1 };
    }

    case 'SLIDE_PREV':
      return { ...s, slideIndex: Math.max(0, s.slideIndex - 1) };

    case 'BEGIN_QUESTIONS':
      return { ...s, stage: 'attempt' };

    case 'SELECT':
      // Selection ONLY. No answer recorded, no advance.
      return s.revealed ? s : { ...s, selected: a.payload.value };

    case 'DRAFT':
      return s.revealed ? s : { ...s, draft: a.payload.value };

    case 'HINT':
      return {
        ...s,
        hintText: a.payload.text,
        hintsUsed: s.hintsUsed + 1,
        hintsForQuestion: [...s.hintsForQuestion, a.payload.text],
        hintsExhausted: a.payload.exhausted ?? s.hintsExhausted,
      };

    case 'GRADING':
      return { ...s, grading: true };

    case 'CHECK': {
      const q = currentQuestion(s);
      if (!q) return s;
      const value = q.type === 'multipleChoice' ? (s.selected ?? '') : s.draft.trim();
      const correct = a.payload.correct;
      // Partial credit where the grader gave it; otherwise the boolean decides.
      // An ungraded answer contributes NOTHING rather than zero -- scoring it 0
      // would punish the learner for our missing answer key.
      const score = a.payload.score ?? (correct === true ? 100 : 0);
      const result: QuestionResult | null =
        correct === null
          ? null
          : {
              questionId: q.id,
              prompt: q.prompt,
              answer: value,
              score,
              correct: correct === true,
              misconception: a.payload.misconception ?? null,
            };
      // Ungraded answers leave the combo and the hearts exactly where they are.
      // Breaking a streak on a question we could not grade punishes the user for
      // our own missing answer key; rewarding it is the bug this replaces.
      const combo = correct === true ? s.combo + 1 : correct === false ? 0 : s.combo;
      return {
        ...s,
        stage: 'feedback',
        revealed: true,
        grading: false,
        lastCorrect: correct,
        lastFeedback: a.payload.feedback ?? null,
        lastGradedBy: a.payload.gradedBy ?? null,
        results: result ? [...s.results, result] : s.results,
        answers: { ...s.answers, [q.id]: value },
        correctCount: s.correctCount + (correct === true ? 1 : 0),
        combo,
        bestCombo: Math.max(s.bestCombo, combo),
        hearts: correct === false ? s.hearts - 1 : s.hearts,
      };
    }

    case 'SKIP': {
      const q = currentQuestion(s);
      if (!q) return s;
      // A skip is a verdict, so it belongs in `results` like any other: the
      // learner declined to answer, which is a 0, not an absence. Leaving it
      // out would quietly EXCLUDE it from the mean -- the treatment reserved
      // for answers we could not grade -- and make skipping everything score
      // better than answering badly.
      return {
        ...s,
        stage: 'feedback',
        revealed: true,
        lastCorrect: false,
        combo: 0,
        skipsUsed: s.skipsUsed + 1,
        answers: { ...s.answers, [q.id]: '' },
        results: [
          ...s.results,
          { questionId: q.id, prompt: q.prompt, answer: '', score: 0, correct: false, misconception: null },
        ],
      };
    }

    case 'CONTINUE': {
      const outOfHearts = s.hearts <= 0;
      if (isLastQuestion(s) || outOfHearts) return { ...s, stage: 'evaluating' };
      return {
        ...s,
        stage: 'attempt',
        questionIndex: s.questionIndex + 1,
        selected: null,
        draft: '',
        revealed: false,
        lastCorrect: null,
        lastFeedback: null,
        lastGradedBy: null,
        grading: false,
        hintText: null,
        // Per-question, so the next question's first hint is a first hint.
        hintsForQuestion: [],
        hintsExhausted: false,
      };
    }

    case 'EVALUATED':
      return {
        ...s,
        stage: 'results',
        assessment: a.payload.assessment,
        gradedLocally: a.payload.gradedLocally ?? false,
        gradingError: a.payload.gradingError ?? null,
      };

    case 'EVALUATE_FAILED':
      return { ...s, stage: 'error', error: a.payload.message, errorKind: a.payload.kind ?? null };

    case 'APPEND_QUESTIONS': {
      if (!s.lesson || a.payload.questions.length === 0) return s;
      return {
        ...s,
        lesson: { ...s.lesson, questions: [...s.lesson.questions, ...a.payload.questions] },
        // Advance INTO the first new question and clear the answer widgets.
        // Without this the learner sits on the last answered question with a
        // Continue button that now leads somewhere, which reads as a stutter.
        stage: 'attempt',
        questionIndex: s.questionIndex + 1,
        selected: null,
        draft: '',
        revealed: false,
        lastCorrect: null,
        hintText: null,
        hintsForQuestion: [],
        hintsExhausted: false,
      };
    }

    case 'PROMPT_EXIT':
      return { ...s, exitPrompt: a.payload.open };

    default: {
      const never: never = a;
      throw new Error(`Unhandled session action: ${JSON.stringify(never)}`);
    }
  }
}
