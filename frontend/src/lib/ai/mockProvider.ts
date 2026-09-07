/**
 * SIMULATED LLM.
 *
 * Not a content bank. This receives the same request objects a real model would
 * and synthesizes a structured reply from them, seeded by the topic string --
 * so "Roman History" yields Roman History scaffolding, never the conditional
 * probability lesson that the old build returned for every topic on earth.
 *
 * Two deliberate properties:
 *
 *  1. It emits WIRE shapes and runs them through the real normalize.ts, exactly
 *     as httpProvider does. That keeps the mapping layer exercised for the whole
 *     frontend-only phase and is the best defence against mock/real drift.
 *
 *  2. It is seeded, not random, so a demo is reproducible. A path that
 *     reshuffles on reload is unusable to present from.
 *
 * The content is structural rather than subject-expert -- it knows how a lesson
 * is SHAPED, not the subject. That is the honest boundary of what a frontend can
 * do alone, and the UI labels it as simulated rather than pretending otherwise.
 */

import type {
  AiProvider,
  AssessResponseRequest,
  ExplainDifferentlyRequest,
  GenerateHintRequest,
  GenerateLessonRequest,
  GeneratePathRequest,
  GenerateQuestionsRequest,
  ExtendPathRequest,
  HintResult,
  NextRecommendation,
  RecommendNextRequest,
  RequestOpts,
  TeachBackAnalysis,
  TeachBackRequest,
} from './contracts';
import { AiError } from './contracts';
import type { AssessmentResult, Concept, Lesson, Question } from '../../types/domain';
import type { AssessmentResultWire, ConceptWire, LessonWire, QuestionWire } from '../../types/wire';
import { toAssessment, toConcept, toLesson, toQuestion } from '../api/normalize';
import { intBetween, pick, seededRng, shuffle } from '../rng';
import type { Rng } from '../rng';

/* --------------------------------------------------------- simulation --- */

const FAIL_RATE = Number(import.meta.env.VITE_MOCK_FAIL_RATE ?? '0') || 0;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiError('aborted', 'Request aborted'));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t);
        reject(new AiError('aborted', 'Request aborted'));
      },
      { once: true },
    );
  });
}

/** Generation is slow. Pretending it is instant would design the UI wrong --
 *  the loading states have to be real or they will not exist when the backend
 *  lands. */
async function think(rng: Rng, base: number, opts?: RequestOpts): Promise<void> {
  await sleep(base + rng() * base * 0.6, opts?.signal);
  if (FAIL_RATE > 0 && rng() < FAIL_RATE) {
    throw new AiError('network', 'Simulated generation failure');
  }
}

/* ------------------------------------------------------------ language --- */

/** Strip an article and normalize spacing so a typed topic reads naturally
 *  inside a generated sentence. */
function cleanTopic(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/^(the|a|an)\s+/i, '') || 'your topic';
}

/**
 * Downcase a topic for use mid-sentence -- but ONLY when it is a single
 * ordinary word.
 *
 * Naively downcasing the first letter turns "Roman History" into
 * "roman History", which looks broken. Multi-word topics are far more likely to
 * contain a proper noun than not, and a capitalised topic mid-sentence reads
 * fine, so those are left exactly as typed. Acronyms are untouched either way.
 */
function lower(s: string): string {
  if (/\s/.test(s)) return s;
  return /^[A-Z][a-z]+$/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/**
 * Present a fragment as a standalone sentence: capitalised, terminally
 * punctuated. Safe to place next to hand-written prose, which splicing is not.
 */
function asSentence(s: string): string {
  const t = s.trim();
  if (!t) return '';
  const capped = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * A short way to refer to a concept mid-sentence.
 *
 * Concept names are headings, and dropping one whole into a sentence produces
 * things like "Which statement best captures Orientation: the shape of Roman
 * History?". Anything with a colon gets its subtitle taken; anything still long
 * becomes a pronoun. A real model writes around this naturally; the template
 * has to be told.
 */
function shortRef(concept: string): string {
  const afterColon = concept.includes(':') ? concept.split(':').slice(1).join(':').trim() : concept;
  const candidate = afterColon || concept;
  return candidate.length > 34 ? 'this idea' : lower(candidate);
}

/**
 * Concept names, composed rather than listed.
 *
 * This used to be three hardcoded arrays of exactly seven names, sliced to
 * `conceptCount`. So the mock could truncate BELOW seven and could never
 * produce an eighth: `conceptCount: 12` silently yielded 7, and nothing said
 * so. A no-key demo that cannot show more than seven concepts cannot honestly
 * demonstrate an unbounded path, and the whole point of the mock is that it
 * exercises the same shapes the real provider does.
 *
 * So names are now built from two independent axes -- an ARC position (where in
 * a course this concept sits) and a LENS (what angle it takes) -- which
 * multiply out to far more distinct names than any list, and degrade gracefully
 * past that by qualifying with the lens rather than repeating.
 */
const ARC = [
  (t: string) => `What ${lower(t)} actually is`,
  (t: string) => `The vocabulary of ${lower(t)}`,
  () => 'First principles',
  (t: string) => `Reading ${lower(t)} in the wild`,
  () => 'Common traps',
  () => 'Putting it together',
  (t: string) => `Where ${lower(t)} breaks down`,
  () => 'Working an example end to end',
  () => 'Edge cases that matter',
  () => 'Judgement calls',
  () => 'Diagnosing your own mistakes',
  (t: string) => `Why ${lower(t)} exists`,
  () => 'The essential distinctions',
  () => 'Notation and conventions',
  () => 'The standard method',
  () => 'When the standard method fails',
  () => 'Fluency',
  (t: string) => `Orientation: the shape of ${lower(t)}`,
  () => 'Core building blocks',
  () => 'How the pieces connect',
];

const LENS = [
  'in practice',
  'under pressure',
  'from first principles',
  'at scale',
  'for the sceptic',
  'when time is short',
  'in the messy case',
  'compared with the alternatives',
  'as practitioners use it',
  'when the data is poor',
];

/** Unbounded, and distinct. Past the length of ARC it qualifies with a LENS,
 *  which multiplies the space rather than wrapping back to name one. */
function conceptNames(rng: Rng, topic: string, count: number): string[] {
  const offset = intBetween(rng, 0, ARC.length - 1);
  const out: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; out.length < count; i++) {
    const arc = ARC[(i + offset) % ARC.length]!;
    const round = Math.floor(i / ARC.length);
    const base = arc(topic);
    const name = round === 0 ? base : `${base}, ${LENS[(round - 1 + offset) % LENS.length]}`;
    // A duplicate would collide on the path screen, where React keys by id and
    // the learner reads two identical rows as a bug in the app.
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (i > count * ARC.length + 64) break; // structural guard, never reached in practice
  }
  return out;
}

const SLIDE_OPENERS = [
  (c: string) => `In one sentence: ${shortRef(c)} is the idea that lets you move from what you can observe to what you actually want to know.`,
  (c: string) => `Start here: ${shortRef(c)} is best understood as a rule for deciding what follows from what.`,
  (c: string) => `The short version: ${shortRef(c)} gives you a reliable way to handle a situation that otherwise invites guesswork.`,
];

/* ---------------------------------------------------------------- path --- */

function buildConceptWires(req: GeneratePathRequest, after: string[] = []): ConceptWire[] {
  const rng = seededRng('path', req.topic, req.level, req.conceptCount, after.length);
  const topic = cleanTopic(req.topic);
  const banned = new Set(after.map((n) => n.toLowerCase()));
  // Over-generate, then drop anything already on the path, so an extend call
  // still returns the number of NEW concepts that was asked for.
  const names = conceptNames(rng, topic, req.conceptCount + after.length)
    .filter((n) => !banned.has(n.toLowerCase()))
    .slice(0, req.conceptCount);

  return names.map((name, i) => ({
    id: `c${after.length + i + 1}`,
    name,
    order: after.length + i + 1,
    // Sent as honest zeros rather than omitted. The real backend now omits them
    // entirely -- they are progress a stateless server cannot know -- but the
    // mock keeps emitting them precisely BECAUSE they are optional now: it is
    // the only remaining exercise of the guard's tolerate-when-present branch,
    // which is what an older backend will hit.
    mastery: 0,
    status: after.length + i === 0 ? ('current' as const) : ('locked' as const),
  }));
}

/* -------------------------------------------------------------- lesson --- */

/**
 * Question FRAMES.
 *
 * The mock used to hold exactly two question bodies and cycle them, so
 * `count: 10` produced five identical multiple-choice prompts with ids that
 * also collided, and `seenPrompts` was accepted and ignored -- it fed the RNG
 * seed and nothing else. That cannot demonstrate "more practice, forever": the
 * one property practice has to have is that the next question is a new one.
 *
 * A frame is an angle of attack, not a wording variant. Rewording the same
 * question is exactly what the real prompt tells the model NOT to do, so a mock
 * that reworded would be demonstrating the failure rather than the feature.
 */
type McFrame = {
  key: string;
  prompt: (c: string, t: string) => string;
  correct: (c: string, t: string) => string;
  distractors: (c: string, t: string) => [string, string, string];
};

const MC_FRAMES: McFrame[] = [
  {
    key: 'definition',
    prompt: (c) => `Which statement best captures ${c}?`,
    correct: (c) => `It describes how ${c} constrains what you can conclude.`,
    distractors: (c, t) => [
      `It is another name for the subject of ${lower(t)} as a whole.`,
      `It applies only when you already know the answer.`,
      `It is a formatting convention with no effect on meaning.`,
    ],
  },
  {
    key: 'application',
    prompt: (c) => `You are part-way through a problem and two facts point in different directions. How does ${c} help?`,
    correct: (c) => `It tells you which of the two actually narrows the possibilities.`,
    distractors: (c) => [
      `It averages the two so neither dominates.`,
      `It says to prefer whichever fact you learned first.`,
      `It rules the problem out of scope for ${c}.`,
    ],
  },
  {
    key: 'diagnosis',
    prompt: (c) => `Someone applies ${c} and gets an answer that is obviously too confident. What is the most likely cause?`,
    correct: () => `They ignored a condition that had to hold before the rule applied.`,
    distractors: (c, t) => [
      `They used ${lower(t)} notation instead of plain language.`,
      `They worked the steps in the wrong order, which changes nothing.`,
      `${capitalize(c)} cannot produce an overconfident answer.`,
    ],
  },
  {
    key: 'boundary',
    prompt: (c) => `In which situation does ${c} NOT give you any leverage?`,
    correct: () => `When the new information could not have come out any other way.`,
    distractors: (c) => [
      `When there are more than two possibilities to consider.`,
      `Whenever the numbers involved are large.`,
      `When you are working the problem by hand rather than by machine.`,
    ],
  },
  {
    key: 'contrast',
    prompt: (c, t) => `What distinguishes ${c} from the surface-level rule it is often confused with in ${lower(t)}?`,
    correct: (c) => `${capitalize(c)} asks what the evidence rules out; the other asks only what it is consistent with.`,
    distractors: () => [
      `One is used by beginners and the other by experts.`,
      `They are the same rule under two names.`,
      `One applies to numbers and the other to words.`,
    ],
  },
  {
    key: 'prediction',
    prompt: (c) => `If you strengthened one piece of evidence, what would ${c} predict about your conclusion?`,
    correct: () => `It would narrow further, but only if that evidence bears on the question.`,
    distractors: () => [
      `It would narrow in proportion to how much evidence you have in total.`,
      `Nothing changes; conclusions are fixed once drawn.`,
      `It would widen, because more evidence means more uncertainty.`,
    ],
  },
];

const SA_FRAMES: ((c: string, t: string) => { prompt: string; keywords: string[] })[] = [
  (c) => ({ prompt: `Explain ${c} in your own words, then give one concrete example of it.`,
            keywords: [c, 'because', 'example', 'when'] }),
  (c) => ({ prompt: `Describe a situation where ignoring ${c} would lead someone to a wrong conclusion.`,
            keywords: [c, 'wrong', 'because', 'assume'] }),
  (c, t) => ({ prompt: `A friend new to ${lower(t)} asks why ${c} matters at all. Answer them in two sentences.`,
               keywords: [c, 'matters', 'otherwise', 'because'] }),
  (c) => ({ prompt: `What is the single most common way ${c} gets misapplied, and how would you catch it?`,
            keywords: [c, 'check', 'condition', 'mistake'] }),
  (c) => ({ prompt: `Give an example where ${c} does NOT apply, and say what makes it different.`,
            keywords: [c, 'not', 'different', 'condition'] }),
];

/**
 * ANGLES, applied once every base frame has been used.
 *
 * Without these the mock has 6 multiple-choice frames and 5 short-answer ones,
 * and batch 4 of a drill starts repeating batch 1. That is precisely the
 * property "more practice, forever" has to demonstrate, so a mock that runs out
 * is showing the bug rather than the feature.
 *
 * An angle re-contextualises a frame rather than rewording it: the same
 * underlying question asked about a different setting is a different question
 * to answer, which is what the real prompt asks the model for when it says to
 * vary the frame and not the wording.
 */
const ANGLES = [
  'in a real-world setting',
  'when the usual assumptions do not hold',
  'as it would appear in an exam',
  'from the perspective of someone teaching it',
  'where the stakes of getting it wrong are high',
  'in the simplest case you can imagine',
  'at the boundary of where it applies',
];

/** Frame plus angle, so the supply of distinct prompts does not run out. */
function angled(prompt: string, round: number, offset: number): string {
  if (round <= 0) return prompt;
  const angle = ANGLES[(round - 1 + offset) % ANGLES.length]!;
  return prompt.replace(/\?$/, `, ${angle}?`).replace(/\.$/, `, ${angle}.`);
}

/**
 * `idPrefix` is required, not decorative.
 *
 * Ids were `mc1`/`sa1` on every batch, from both providers. Answers are keyed
 * by question id, so appending a practice batch to a running session silently
 * overwrote an earlier answer and the assessment graded the wrong text. The
 * real backend namespaces ids server-side; the mock has to do the same or it
 * cannot reproduce the bug's absence.
 */
function buildQuestionWires(
  rng: Rng,
  topic: string,
  concept: string,
  count: number,
  types: ('multiple-choice' | 'short-answer')[],
  idPrefix: string,
  seenPrompts: string[] = [],
): QuestionWire[] {
  const out: QuestionWire[] = [];
  const c = shortRef(concept);
  const seen = new Set(seenPrompts.map((s) => s.trim().toLowerCase()));
  // Start somewhere different per batch, so successive calls do not both open
  // with the definition question.
  const mcOffset = intBetween(rng, 0, MC_FRAMES.length - 1);
  const saOffset = intBetween(rng, 0, SA_FRAMES.length - 1);
  let mcUsed = 0;
  let saUsed = 0;

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length]!;

    if (type === 'multiple-choice') {
      // Walk forward past anything already seen, adding an ANGLE each time the
      // frames are exhausted. Bounded by frames x angles, which is large enough
      // that the practice supply is unbounded in every practical sense -- and
      // it degrades by becoming more specific rather than by repeating.
      let frame = MC_FRAMES[(mcUsed + mcOffset) % MC_FRAMES.length]!;
      let prompt = angled(frame.prompt(c, topic), 0, mcOffset);
      const mcSpace = MC_FRAMES.length * (ANGLES.length + 1);
      for (let k = 0; k < mcSpace; k++) {
        const idx = mcUsed + mcOffset + k;
        const cand = MC_FRAMES[idx % MC_FRAMES.length]!;
        const p = angled(cand.prompt(c, topic), Math.floor(idx / MC_FRAMES.length), mcOffset);
        if (!seen.has(p.trim().toLowerCase())) {
          frame = cand;
          prompt = p;
          mcUsed += k;
          break;
        }
      }
      mcUsed += 1;

      const correct = frame.correct(c, topic);
      const distractors = frame.distractors(c, topic);
      const options = shuffle(rng, [correct, ...distractors]);
      seen.add(prompt.trim().toLowerCase());

      out.push({
        id: `${idPrefix}-${i + 1}`,
        type: 'multiple-choice',
        prompt,
        options,
        correct_answer: correct,
        why: `${capitalize(shortRef(concept))} is a constraint on inference: it tells you which conclusions the evidence actually supports.`,
        misconception_on_wrong: {
          [distractors[0]]: `Treats ${c} as the whole subject rather than one tool within it`,
          [distractors[1]]: `Believes ${c} applies without checking its condition`,
          [distractors[2]]: `Mistakes ${c} for notation rather than substance`,
        },
        rubric: null,
        hint: `Ask yourself what ${c} lets you rule OUT, not just what it lets you say.`,
      });
    } else {
      let built = SA_FRAMES[(saUsed + saOffset) % SA_FRAMES.length]!(c, topic);
      const saSpace = SA_FRAMES.length * (ANGLES.length + 1);
      for (let k = 0; k < saSpace; k++) {
        const idx = saUsed + saOffset + k;
        const cand = SA_FRAMES[idx % SA_FRAMES.length]!(c, topic);
        const p = angled(cand.prompt, Math.floor(idx / SA_FRAMES.length), saOffset);
        if (!seen.has(p.trim().toLowerCase())) {
          built = { ...cand, prompt: p };
          saUsed += k;
          break;
        }
      }
      saUsed += 1;
      seen.add(built.prompt.trim().toLowerCase());

      out.push({
        id: `${idPrefix}-${i + 1}`,
        type: 'short-answer',
        prompt: built.prompt,
        options: null,
        correct_answer: null,
        why: `A solid answer names the idea, states the condition under which it applies, and grounds it in a specific case.`,
        misconception_on_wrong: null,
        // Offline grading is keyword overlap, not semantics. The UI says so.
        rubric: { keywords: built.keywords, required: 2 },
        hint: `Try finishing this sentence: "${concept} matters when..."`,
      });
    }
  }
  return out;
}

function buildLessonWire(req: GenerateLessonRequest): LessonWire {
  const rng = seededRng('lesson', req.topic, req.conceptName, req.level, req.isReview ? 'r' : 'f');
  const topic = cleanTopic(req.topic);
  const c = req.conceptName;

  const opener = pick(rng, SLIDE_OPENERS)(c);
  const watch = req.misconceptionsToWatch;

  const explanation = [
    opener,
    '',
    req.isReview
      ? `You have seen this once already, so this pass comes at it from a different direction: instead of defining ${lower(c)} first, we will start from a case where getting it wrong costs you something, and let the definition fall out of that.`
      : `The reason ${lower(c)} earns its place in ${lower(topic)} is that the obvious approach quietly fails in a class of cases, and this is what tells you which cases those are.`,
    watch.length
      ? `\nOne thing to watch specifically, because it tripped you up last time: ${watch[0]}. Keep it in mind as you read the example.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const example = `Suppose you are working through a problem in ${lower(topic)} and you have two pieces of information that each seem to point somewhere different. Applying ${lower(c)}, you first ask which of them actually constrains the outcome. Working it through step by step, the second piece turns out to narrow the possibilities from ${intBetween(rng, 8, 40)} down to ${intBetween(rng, 2, 6)} -- and that reduction, not the raw count, is the thing ${lower(c)} is really about.`;

  return {
    concept: c,
    title: req.isReview ? `${c}, a second look` : `Understanding ${lower(c)}`,
    explanation,
    example,
    objectives: [
      `State what ${lower(c)} means without using notation`,
      `Recognise a situation where it applies`,
      `Spot the most common way it is misapplied`,
    ],
    slides: null, // let normalize.ts derive the deck -- same path a real reply takes
    // Was a hardcoded 2. That literal is what made `settings.questionsPerLesson`
    // inert in mock mode even after the backend could honour it -- and mock
    // mode is the default, so the control would still have done nothing for
    // most people running this.
    questions: buildQuestionWires(
      rng,
      topic,
      c,
      Math.max(1, req.questionCount ?? 2),
      ['multiple-choice', 'short-answer'],
      idPrefix('lesson', req.conceptName, req.isReview),
    ),
  };
}

/**
 * A stable, per-generation id namespace.
 *
 * Stable rather than random because the mock's whole value is reproducibility:
 * a demo that renumbers its questions on every reload cannot be presented from.
 * Distinct per generation because two batches in one session must not collide
 * in the answers map.
 */
function idPrefix(...parts: (string | number | boolean)[]): string {
  const s = parts.join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `m${(h >>> 0).toString(36).slice(0, 5)}`;
}

/* -------------------------------------------------------------- assess --- */

/**
 * Offline grading: exact match for multiple choice, rubric keyword overlap for
 * short answers.
 *
 * Genuinely mediocre compared to a model, and the UI says so rather than
 * passing it off as comprehension. Crucially, the misconception it reports is
 * real -- it comes from `misconception_on_wrong` on the distractor the learner
 * actually picked, so the misconception log is not invented.
 */
function gradeLocally(req: AssessResponseRequest): AssessmentResultWire {
  const questions = req.lesson.questions;
  let earned = 0;
  let possible = 0;
  const misconceptions: string[] = [];

  for (const q of questions) {
    possible += 100;
    const given = (req.answers[q.id] ?? '').trim();

    if (q.type === 'multipleChoice') {
      if (given && q.correctAnswer && given === q.correctAnswer) {
        earned += 100;
      } else if (given && q.misconceptionOnWrong?.[given]) {
        misconceptions.push(q.misconceptionOnWrong[given]!);
      }
    } else {
      const words = given.toLowerCase();
      const kw = q.rubric?.keywords ?? [];
      const need = Math.max(1, q.rubric?.required ?? 1);
      const hits = kw.filter((k) => words.includes(k.toLowerCase())).length;
      if (given.length < 15) {
        earned += 0;
      } else {
        earned += Math.round(Math.min(1, hits / need) * 100);
      }
    }
  }

  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  const correct = score >= 70;

  /**
   * Misconceptions are stated as their OWN sentence, never spliced into one.
   *
   * They arrive as verb phrases with an implied subject -- "Mistakes X for Y" --
   * so embedding one after "The gap is that" produced "The gap is that Mistakes
   * the shape of Roman History for notation". Splicing model-authored text into
   * a hand-written clause needs the two halves to agree grammatically, and
   * nothing here can guarantee that. A colon and a full stop always work.
   */
  const feedback = correct
    ? misconceptions.length
      ? `You have the main idea. One thing to tighten — ${asSentence(misconceptions[0]!)} Worth a second look before you move on.`
      : `That holds together. You stated the idea and applied it to a specific case, which is the part most people skip.`
    : misconceptions.length
      ? `Not quite yet. ${asSentence(misconceptions[0]!)} Re-read the worked example and check where that assumption breaks.`
      : `Not quite yet. Your answer did not touch the key ideas the question was after -- try naming the condition under which the concept applies.`;

  return {
    score,
    correct,
    misconceptions,
    feedback,
    needs_review: score < 70 || misconceptions.length > 0,
  };
}

/* ------------------------------------------------------------ provider --- */

export const mockProvider: AiProvider = {
  name: 'mock',

  async health() {
    return { ok: true };
  },

  async generatePath(req: GeneratePathRequest, opts?: RequestOpts): Promise<Concept[]> {
    const rng = seededRng('path-latency', req.topic);
    await think(rng, 900, opts);
    return buildConceptWires(req).map((c, i) => toConcept(c, i));
  },

  async extendPath(req: ExtendPathRequest, opts?: RequestOpts): Promise<Concept[]> {
    const rng = seededRng('extend-latency', req.topic, req.after.length);
    await think(rng, 900, opts);
    const wires = buildConceptWires(
      { topic: req.topic, level: req.level, dailyTimeMin: req.dailyTimeMin,
        goal: req.goal, conceptCount: req.conceptCount },
      req.after,
    );
    // Offset by the existing path length: toConcept marks index 0 `current`,
    // and an appended concept must not unlock ahead of everything before it.
    return wires.map((c, i) => toConcept(c, req.after.length + i));
  },

  async generateLesson(req: GenerateLessonRequest, opts?: RequestOpts): Promise<Lesson> {
    const rng = seededRng('lesson-latency', req.conceptName);
    await think(rng, 700, opts);
    return toLesson(buildLessonWire(req));
  },

  async generateQuestions(req: GenerateQuestionsRequest, opts?: RequestOpts): Promise<Question[]> {
    const rng = seededRng('q', req.conceptName, req.count, req.seenPrompts.length);
    await think(rng, 500, opts);
    const types: ('multiple-choice' | 'short-answer')[] = req.types.map((t) =>
      t === 'shortAnswer' ? 'short-answer' : 'multiple-choice',
    );
    return buildQuestionWires(
      rng,
      cleanTopic(req.topic),
      req.conceptName,
      req.count,
      types,
      // seenPrompts.length is in the namespace, so batch 2 of a drill cannot
      // reuse batch 1's ids even though both are deterministic.
      idPrefix('q', req.conceptName, req.seenPrompts.length, req.count),
      req.seenPrompts,
    ).map(toQuestion);
  },

  async assessResponse(req: AssessResponseRequest, opts?: RequestOpts): Promise<AssessmentResult> {
    const rng = seededRng('assess', req.conceptName, JSON.stringify(req.answers));
    await think(rng, 800, opts);
    return toAssessment(gradeLocally(req));
  },

  /**
   * Escalating, and it has to actually escalate.
   *
   * This returned `question.hint` every time and reported `exhausted` against a
   * hardcoded 3. So asking for hint 4 returned hint 1 verbatim -- which is the
   * exact failure the real endpoint avoids by being sent `priorHints`, and the
   * mock is only useful if it demonstrates the same property.
   */
  async generateHint(req: GenerateHintRequest, opts?: RequestOpts): Promise<HintResult> {
    const rng = seededRng('hint', req.question.id, req.level);
    await think(rng, 350, opts);
    const c = lower(req.conceptName);
    const share = req.maxLevel <= 1 ? 1 : (req.level - 1) / (req.maxLevel - 1);

    // Level 1 prefers the hint the question already carries, because that is
    // the one written for this specific question. Later levels have to say
    // something new, so they are generated from the depth instead.
    const text =
      req.level <= 1
        ? (req.question.hint ?? `Focus on what ${c} rules out, not just what it allows.`)
        : share < 0.5
          ? `Narrow it down: ask which condition has to hold before ${c} applies at all. Rule out any option that ignores it.`
          : share < 0.9
            ? `Closer in: the answer turns on what the evidence ELIMINATES. Look for the option that talks about possibilities being removed rather than added.`
            : `Almost there: the right answer says that ${c} constrains which conclusions the evidence supports. Pick the option that describes a narrowing, and you have it.`;

    // Repeating a hint verbatim is the one thing an escalating hint must not
    // do, and the prior list is the only way to know.
    const repeated = req.priorHints.some((h) => h.trim() === text.trim());
    return {
      text: repeated
        ? `Going further than last time: work backwards from the options. Three of them describe ${c} doing something it never does -- adding information, averaging, or changing notation. The one left is the answer.`
        : text,
      exhausted: req.level >= req.maxLevel,
    };
  },

  async explainDifferently(req: ExplainDifferentlyRequest, opts?: RequestOpts): Promise<string> {
    const rng = seededRng('explain', req.conceptName, req.confusionPoint);
    await think(rng, 700, opts);
    return `Let's drop the formal framing. Think of ${lower(req.conceptName)} as a filter: information arrives, and the question is only ever which possibilities it eliminates. You said the part that lost you was "${req.confusionPoint}" -- that step is doing exactly one job, narrowing the field, and everything after it is bookkeeping.`;
  },

  async analyzeTeachBack(req: TeachBackRequest, opts?: RequestOpts): Promise<TeachBackAnalysis> {
    const rng = seededRng('teachback', req.explanation);
    await think(rng, 900, opts);
    const words = req.explanation.trim().split(/\s+/).filter(Boolean).length;
    const coverage = Math.max(10, Math.min(95, Math.round(words * 2.2)));
    return {
      coverage,
      understood: words > 12 ? ['States the core idea in their own words'] : [],
      missing:
        coverage < 70
          ? [`Does not say WHEN ${lower(req.conceptName)} applies`, 'No concrete example']
          : ['No concrete example'],
      incorrect: [],
      followUpQuestion: `Can you give an example where ${lower(req.conceptName)} would NOT apply?`,
    };
  },

  async recommendNext(req: RecommendNextRequest, opts?: RequestOpts): Promise<NextRecommendation> {
    const rng = seededRng('next', req.topic, req.dueConcepts.length, req.overdueConcepts.length);
    await think(rng, 300, opts);

    if (req.overdueConcepts.length > 0) {
      return {
        action: 'review',
        conceptNames: req.overdueConcepts.slice(0, 3),
        reason: `${req.overdueConcepts.length} concept${req.overdueConcepts.length === 1 ? ' is' : 's are'} overdue -- clearing those first keeps the ground under the next one solid.`,
      };
    }
    if (req.dueConcepts.length > 0) {
      return {
        action: 'review',
        conceptNames: req.dueConcepts.slice(0, 3),
        reason: 'A short review now is cheaper than relearning these next week.',
      };
    }
    const weakest = Object.entries(req.masteryByConcept).sort((a, b) => a[1] - b[1])[0];
    return weakest
      ? { action: 'continue', conceptNames: [weakest[0]], reason: 'Nothing is due, so this is a good moment to move forward.' }
      : { action: 'continue', conceptNames: [], reason: 'Pick a topic to get started.' };
  },
};
