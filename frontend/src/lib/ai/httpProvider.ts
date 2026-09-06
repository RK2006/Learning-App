/**
 * The real provider: FastAPI.
 *
 * Written in the same phase as the mock, deliberately. Writing it later would
 * let the interface quietly become "whatever the mock found convenient" instead
 * of something actually implementable against the backend -- and the mismatch
 * would surface after three thousand lines had been built on top of it.
 *
 * ALL NINE TASKS HAVE ROUTES NOW. Five of them used to throw `unconfigured`
 * naming the endpoint somebody needed to build; that list was a work order and
 * the work is done.
 *
 * Four of those five had neither a route nor a caller, so each shipped
 * alongside the screen that uses it rather than on its own. An endpoint with no
 * caller ships no behaviour and cannot be observed drifting from its contract,
 * which is how three of them came to disagree with `contracts.ts` unnoticed.
 */

import type {
  AiProvider,
  AssessResponseRequest,
  ExplainDifferentlyRequest,
  ExtendPathRequest,
  GenerateHintRequest,
  GenerateLessonRequest,
  GeneratePathRequest,
  GenerateQuestionsRequest,
  HintResult,
  NextRecommendation,
  RecommendNextRequest,
  RequestOpts,
  TeachBackAnalysis,
  TeachBackRequest,
} from './contracts';
import { AiError } from './contracts';
import type { AssessmentResult, Concept, Lesson, Question } from '../../types/domain';
import type {
  ApiErrorWire,
  AssessmentResultWire,
  ExplanationResponseWire,
  HintResponseWire,
  LessonWire,
  QuestionsResponseWire,
  RecommendationResponseWire,
  SetupResponseWire,
  TeachBackResponseWire,
} from '../../types/wire';
import {
  toAssessment,
  toAssessWire,
  toConcept,
  toExplainWire,
  toExtendWire,
  toHintResult,
  toHintWire,
  toLesson,
  toLessonRequestWire,
  toQuestion,
  toQuestionsWire,
  toRecommendation,
  toRecommendWire,
  toSetupWire,
  toTeachBack,
  toTeachBackWire,
} from '../api/normalize';
import {
  isAssessmentWire,
  isExplanationWire,
  isHintWire,
  isLessonWire,
  isQuestionsWire,
  isRecommendationWire,
  isSetupResponseWire,
  isTeachBackWire,
} from '../api/guards';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

/**
 * 45s, not 30s.
 *
 * Measured against the real backend: a lesson's latency tracks its output
 * tokens at roughly 1.5s + tokens/150, so two questions takes 7s and twenty
 * takes 19.8s. The old 30s budget was comfortable only while every lesson was
 * hardcoded to exactly two questions. Now that the count is the learner's to
 * choose, a 30s abort would turn the largest legal request into a guaranteed
 * timeout -- and the learner would still be billed for the generation, because
 * aborting the fetch does not stop the model.
 *
 * The server's upstream timeout is 40s and its SDK retries are pinned to zero,
 * so the server always gives up first and this abort is the outer bound rather
 * than a race with it. The retry pin matters: with the SDK's default of two, a
 * measured /questions call took 49.5s against a 45s per-attempt timeout -- the
 * client had already aborted, and the generation completed into a closed
 * connection and was billed for.
 */
const TIMEOUT_MS = 45_000;

/** The kinds this build knows the server can send. Anything else still reaches
 *  `describeAiError`, which is default-safe -- but an unrecognised kind means
 *  the client is older than the server, and saying so in the message beats
 *  swallowing it. */
const KNOWN_KINDS = new Set([
  'unconfigured', 'rate_limited', 'model_down', 'content_refused', 'invalid', 'malformed',
]);

async function post<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Honour the caller's signal as well as our own timeout.
  opts?.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (opts?.signal?.aborted) throw new AiError('aborted', 'Request aborted');
    if (controller.signal.aborted) throw new AiError('timeout', `${path} timed out after ${TIMEOUT_MS}ms`);
    throw new AiError('network', `Could not reach the backend at ${BASE}`);
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    /**
     * Read the server's own classification instead of flattening everything to
     * `http`.
     *
     * Every failure from this backend carries `{kind, message}`, and `kind` is
     * what decides the copy the learner sees AND whether a Retry button is
     * offered at all. Collapsing a 503 `unconfigured` and a 429 `rate_limited`
     * into one generic "the server said no" loses exactly the distinction that
     * matters: one of them will never succeed and the other will succeed in a
     * minute.
     */
    let payload: ApiErrorWire | null = null;
    try {
      payload = (await res.json()) as ApiErrorWire;
    } catch {
      // A proxy or a crash can produce a non-JSON error body. Fall through.
    }
    const kind = payload?.kind;
    const message = payload?.message ?? payload?.detail ?? `${path} returned ${res.status}`;
    if (typeof kind === 'string' && kind) {
      if (!KNOWN_KINDS.has(kind)) {
        throw new AiError(kind, `${message} (unrecognised error kind "${kind}")`, res.status);
      }
      throw new AiError(kind, message, res.status);
    }
    // FastAPI's own 422 for a request shape this client got wrong. Not
    // retryable: the identical body would be rejected identically.
    if (res.status === 422) throw new AiError('invalid', message, 422);
    throw new AiError('http', message, res.status);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new AiError('malformed', `${path} did not return JSON`);
  }
}

function bad(path: string): never {
  throw new AiError('malformed', `${path} returned an unexpected shape`);
}

export const httpProvider: AiProvider = {
  name: 'http',

  async health(opts?: RequestOpts) {
    try {
      const res = await fetch(`${BASE}/health`, { signal: opts?.signal });
      if (!res.ok) return { ok: false };
      const body = (await res.json()) as { ok?: boolean; configured?: boolean };
      // `configured` is the field with teeth. A server with no API key is
      // running perfectly and cannot generate a single word, so reporting it as
      // healthy would tell the caller the opposite of what it needs to know
      // before committing someone to a twelve-second wait.
      return { ok: body.ok !== false && body.configured !== false };
    } catch {
      return { ok: false };
    }
  },

  async generatePath(req: GeneratePathRequest, opts?: RequestOpts): Promise<Concept[]> {
    const raw = await post<unknown>(
      '/setup',
      toSetupWire(
        { topic: req.topic, goal: req.goal, dailyTimeMin: req.dailyTimeMin, level: req.level },
        req.conceptCount,
        req.priorKnowledge,
      ),
      opts,
    );
    if (!isSetupResponseWire(raw)) bad('/setup');
    return (raw as SetupResponseWire).concepts.map((c, i) => toConcept(c, i));
  },

  async extendPath(req: ExtendPathRequest, opts?: RequestOpts): Promise<Concept[]> {
    const raw = await post<unknown>('/path/extend', toExtendWire(req), opts);
    if (!isSetupResponseWire(raw)) bad('/path/extend');
    // Indexed from the END of the existing path, not from zero: `toConcept`
    // marks index 0 as `current`, and a freshly appended concept must not
    // arrive already unlocked ahead of the ones before it.
    return (raw as SetupResponseWire).concepts.map((c, i) => toConcept(c, req.after.length + i));
  },

  async generateLesson(req: GenerateLessonRequest, opts?: RequestOpts): Promise<Lesson> {
    // No more smuggling the concept through `goal`. `concept_name` is a typed
    // field, and the three inputs that were computed and discarded --
    // misconceptions, attempt history, isReview -- now actually travel.
    const raw = await post<unknown>('/lesson', toLessonRequestWire(req, req.questionCount ?? 2), opts);
    if (!isLessonWire(raw)) bad('/lesson');
    return toLesson(raw as LessonWire);
  },

  async generateQuestions(req: GenerateQuestionsRequest, opts?: RequestOpts): Promise<Question[]> {
    const raw = await post<unknown>('/questions', toQuestionsWire(req), opts);
    if (!isQuestionsWire(raw)) bad('/questions');
    return (raw as QuestionsResponseWire).questions.map(toQuestion);
  },

  async assessResponse(req: AssessResponseRequest, opts?: RequestOpts): Promise<AssessmentResult> {
    const raw = await post<unknown>(
      '/assess',
      // conceptName is sent now. It was computed by the caller and dropped
      // here, so the grader never learned which concept it was grading.
      toAssessWire(req.topic, req.conceptName, req.answers, req.lesson),
      opts,
    );
    if (!isAssessmentWire(raw)) bad('/assess');
    return toAssessment(raw as AssessmentResultWire);
  },

  async generateHint(req: GenerateHintRequest, opts?: RequestOpts): Promise<HintResult> {
    const raw = await post<unknown>('/hint', toHintWire(req), opts);
    if (!isHintWire(raw)) bad('/hint');
    return toHintResult(raw as HintResponseWire);
  },

  async explainDifferently(req: ExplainDifferentlyRequest, opts?: RequestOpts): Promise<string> {
    const raw = await post<unknown>('/explain', toExplainWire(req), opts);
    if (!isExplanationWire(raw)) bad('/explain');
    return (raw as ExplanationResponseWire).explanation;
  },

  async analyzeTeachBack(req: TeachBackRequest, opts?: RequestOpts): Promise<TeachBackAnalysis> {
    const raw = await post<unknown>('/teach-back', toTeachBackWire(req), opts);
    if (!isTeachBackWire(raw)) bad('/teach-back');
    return toTeachBack(raw as TeachBackResponseWire);
  },

  async recommendNext(req: RecommendNextRequest, opts?: RequestOpts): Promise<NextRecommendation> {
    const raw = await post<unknown>('/recommend', toRecommendWire(req), opts);
    if (!isRecommendationWire(raw)) bad('/recommend');
    return toRecommendation(raw as RecommendationResponseWire);
  },
};
