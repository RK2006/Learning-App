import { useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useRoute, useSearch } from 'wouter';
import { X, Lightning, CheckCircle, XCircle, Question } from '@phosphor-icons/react';
import { Press } from '../components/Press/Press';
import { Chip } from '../components/Chip/Chip';
import { Pica } from '../components/Pica/Pica';
import { PressLoader } from '../components/PressLoader/PressLoader';
import { Reveal } from '../components/Reveal/Reveal';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { lessonCacheKey, selectActiveCourse } from '../state/selectors';
import {
  canCheck,
  currentQuestion,
  initSession,
  isLastQuestion,
  questionCount,
  sessionReducer,
} from '../state/sessionMachine';
import { buildCommit } from '../state/commit';
import { ai } from '../lib/ai';
import { atLeast } from '../lib/atLeast';
import { useFocusTrap } from '../lib/useFocusTrap';
import { playCue } from '../lib/sound';
import { describeAiError } from '../lib/ai/errorCopy';
import { AiError } from '../lib/ai/contracts';
import { now } from '../domain/time';
import { gradeLocally, matchRubric, rubricFromModelAnswer } from '../domain/grade';
import { ROUTES } from '../router/routes';
import { parseMode, parseQueue } from '../router/session';
import type { AssessmentResult, SessionMode } from '../types/domain';
import { ResultsPanel } from './ResultsPanel';
import { TeachBack } from '../components/TeachBack/TeachBack';
import s from './SessionScreen.module.css';

/**
 * Number keys for multiple choice.
 *
 * Was exactly four, while nothing on either side of the wire enforced four
 * options -- so a five-option question rendered one option with a blank key
 * badge and no keyboard route to it at all. The server now enforces exactly
 * four (backend/app/validate.py::MC_OPTIONS), and this list runs past it so
 * that an under- or over-count from an older backend degrades into a working
 * shortcut rather than a dead one. `optionKey` returns undefined beyond this,
 * and the badge is hidden rather than rendered blank.
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * The grade when /assess could not be reached.
 *
 * Derived only from questions this client actually graded -- exact match for
 * multiple choice, rubric overlap for short answers -- and it says so, both in
 * `feedback` and through the banner on the results screen. It reports NO
 * misconceptions, because finding those is exactly the part a local check
 * cannot do, and inventing one would be the same lie as the hardcoded
 * "Confuses P(A|B) with P(B|A)" this project deleted from the backend.
 */
/** Beyond this many questions, segments stop being readable and the bar
 *  switches to a window plus a count. 20 segments at 360px is ~12px each,
 *  about the floor for something that needs a gap beside it. */
const SEG_MAX = 20;

/** A fixed-width window of question indices centred on the current one, clamped
 *  to the ends so the bar never renders half-empty at the start or finish. */
function segWindow(index: number, total: number, size = SEG_MAX): number[] {
  const start = Math.max(0, Math.min(index - Math.floor(size / 2), total - size));
  return Array.from({ length: Math.min(size, total) }, (_, i) => start + i);
}

function localAssessment(correct: number, total: number): AssessmentResult {
  const score = total === 0 ? 0 : Math.round((correct / total) * 100);
  return {
    score,
    correct: score >= 70,
    needsReview: score < 70,
    misconceptions: [],
    feedback:
      `Scored on this device from the ${total} question${total === 1 ? '' : 's'} checked as you went, ` +
      `because the full assessment could not be reached. Your progress is saved. ` +
      `The written feedback and any misconceptions are the parts that need the model, so they are missing here.`,
  };
}

export function SessionScreen() {
  const [, params] = useRoute(ROUTES.session);
  const [location, navigate] = useLocation();
  const app = useAppState();
  const dispatch = useDispatch();

  const course = selectActiveCourse(app);
  const conceptId = params?.conceptId ?? '';
  const concept = course?.concepts.find((c) => c.id === conceptId) ?? null;
  /**
   * useSearch(), NOT location.split('?').
   *
   * wouter's useLocation() returns the PATHNAME ONLY -- the query string is
   * never in it, so splitting on '?' silently yields ''. That made every
   * `?mode=review` session run as a lesson: review sessions showed the teach
   * slides they are supposed to skip and paid the lesson XP base instead of the
   * review one. It failed quietly for three phases because 'lesson' is also the
   * fallback, so the bug and the default were indistinguishable.
   */
  const search = useSearch();
  const mode = parseMode(search);
  /** Concepts still to come in a multi-concept run. Lives in the URL so a
   *  refresh mid-queue resumes exactly. See router/session.ts. */
  const queue = parseQueue(search);

  const [st, send] = useReducer(
    sessionReducer,
    {
      mode,
      courseId: course?.id ?? '',
      conceptIds: conceptId ? [conceptId] : [],
      hearts: app.settings.challengeMode ? app.settings.heartsPerSession : Number.POSITIVE_INFINITY,
      startedAt: now(),
    },
    initSession,
  );

  const [committed, setCommitted] = useState(false);
  const [hintState, setHintState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const [hintError, setHintError] = useState<string | null>(null);
  const [practiceState, setPracticeState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [explainState, setExplainState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const [explainError, setExplainError] = useState<string | null>(null);
  /** slideId -> the alternative explanation, once asked for. */
  const [explained, setExplained] = useState<Record<string, string>>({});
  // Every in-flight generation this screen can start. Aborted on unmount, so
  // walking away never leaves a metered request running for a screen that is
  // gone -- previously only the lesson fetch was cancellable.
  const hintAbort = useRef<AbortController | null>(null);
  const practiceAbort = useRef<AbortController | null>(null);
  const explainAbort = useRef<AbortController | null>(null);
  const assessAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      hintAbort.current?.abort();
      practiceAbort.current?.abort();
      explainAbort.current?.abort();
      // Unmount only. Aborting this on a dependency change deadlocked the
      // session permanently on the evaluating screen -- see the evaluate effect.
      assessAbort.current?.abort();
    },
    [],
  );
  const exitRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  /* ------------------------------------------------------------ load --- */
  /**
   * No "run once" ref here, deliberately.
   *
   * A ref guard combined with an abort-on-cleanup deadlocks under StrictMode:
   * the first pass starts the request and sets the guard, cleanup aborts it,
   * and the second pass returns early -- so the lesson never arrives and the
   * screen sits on its loading state forever. Letting the effect re-run and
   * aborting the superseded request is the pattern that actually works.
   */
  /**
   * Deps are IDS, not the store objects.
   *
   * `course` and `concept` are plain store references, and COMMIT_SESSION
   * rebuilds both (the reducer maps `courses`, and buildCommit rebuilds every
   * studied Concept). With them in the dependency array, finishing a session
   * changed their identity, re-ran this effect, re-fetched the lesson and sent
   * LOADED -- which resets the stage to `intro`. About a second after the
   * results appeared they were replaced by the intro card, and in a review run
   * the "Next review" button vanished before it could be pressed.
   *
   * The latest objects are read through a ref so the fetch still uses current
   * data without current data being able to retrigger the fetch.
   */
  const latest = useRef({ course, concept });
  latest.current = { course, concept };
  // Read through a ref for exactly the reason `course` and `concept` are: this
  // effect DISPATCHES CACHE_LESSON, which changes `lessonCache`'s identity, so
  // listing it as a dependency would make the effect retrigger itself.
  const latestCache = useRef(app.lessonCache);
  latestCache.current = app.lessonCache;

  useEffect(() => {
    const { course: c0, concept: k0 } = latest.current;
    if (!c0 || !k0) return;
    const ctrl = new AbortController();

    const isReview = mode === 'review' || k0.status === 'needsReview';
    const misconceptionsToWatch = k0.misconceptions
      .filter((m) => m.resolvedAt == null)
      .map((m) => m.text);
    // The setting finally has a reader. `questionsPerLesson` has been a live
    // 2/3/4/5 control on the Settings screen -- persisted, migrated, rendered --
    // that nothing anywhere consulted. A control that does nothing is the
    // specific bug this project exists to remove, and it was shipping one.
    const questionCount = Math.max(1, app.settings.questionsPerLesson || 2);

    const key = lessonCacheKey({
      courseId: c0.id,
      conceptId: k0.id,
      level: c0.level,
      minutes: c0.dailyTimeMin,
      isReview,
      questionCount,
      misconceptions: misconceptionsToWatch,
    });

    /**
     * Read the cache before spending 7-20 seconds and a generation on something
     * already on disk.
     *
     * Safe only because the key above includes `isReview` and the misconception
     * set, so a re-teach can never be served the lesson it exists to replace.
     * Practice mode deliberately skips the cache: "try this again" that returns
     * the identical questions is not practice.
     */
    const cached = mode !== 'practice' ? latestCache.current[key] : undefined;
    if (cached) {
      send({ type: 'LOADED', payload: { lesson: cached } });
      return;
    }

    (async () => {
      try {
        const lesson = await ai.generateLesson(
          {
            topic: c0.topic,
            conceptName: k0.name,
            level: c0.level,
            minutes: c0.dailyTimeMin,
            misconceptionsToWatch,
            attemptHistory: k0.scoreHistory,
            isReview,
            questionCount,
          },
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        dispatch({ type: 'CACHE_LESSON', payload: { key, lesson } });
        send({ type: 'LOADED', payload: { lesson } });
      } catch (e) {
        // A superseded request is not a failure the user should see.
        if (ctrl.signal.aborted) return;
        send({
          type: 'LOAD_FAILED',
          payload: { message: (e as Error).message, kind: e instanceof AiError ? e.kind : undefined },
        });
      }
    })();

    return () => ctrl.abort();
  }, [course?.id, concept?.id, mode, dispatch, app.settings.questionsPerLesson]);

  /* -------------------------------------------------------- evaluate --- */
  /**
   * THE HIGHEST-SEVERITY FAILURE PATH IN THE APP, and it used to lose the
   * session outright.
   *
   * `buildCommit` was called INSIDE the try, after `await assessResponse`. So
   * an /assess timeout -- and /assess can time out, it is a network call to a
   * metered model -- threw before the commit, sent EVALUATE_FAILED, and landed
   * on the error stage whose only two controls are `window.location.reload()`
   * and "Back to your path". Both discard `st.answers`. A learner who had
   * answered every question then lost the entire session: no XP, no mastery, no
   * streak, no SRS update, nothing.
   *
   * The fix is to notice that the grade and the commit are separable. Every
   * input `buildCommit` needs is ALREADY HERE, locally, and has been the whole
   * time: the answers, the per-question verdicts from the offline check, the
   * hint count, the duration. The model's score is a better signal than the
   * local tally, but it is not a required one.
   *
   * So the commit always happens. If the assessment arrives it is used; if it
   * does not, the session commits on the locally-graded count and the results
   * screen SAYS SO. That is the honest version -- the alternative is either
   * losing real work or inventing a score, and a score computed from questions
   * this client actually graded is neither.
   */
  useEffect(() => {
    if (st.stage !== 'evaluating' || !st.lesson || !course || committed) return;
    setCommitted(true);
    /**
     * The controller lives in a REF, and this effect returns no cleanup.
     *
     * It used to `return () => ctrl.abort()`, which deadlocked the session on
     * the "Checking answers" screen, permanently. The sequence:
     *
     *   1. effect runs, setCommitted(true), /assess starts, cleanup registered
     *   2. `committed` flips -- and it is IN the dependency array -- so React
     *      re-runs the effect, which means first running the cleanup
     *   3. the cleanup aborts the request that was still in flight
     *   4. the effect body re-runs and returns at the `committed` guard, so
     *      nothing restarts it
     *   5. the aborted request rejects, the catch sees signal.aborted and
     *      returns silently, and EVALUATED is never sent
     *
     * That is precisely the "ref guard plus abort-on-cleanup deadlocks" trap
     * the load effect above is commented about. The two effects differ in one
     * decisive way: the load effect has NO once-guard, so a re-run simply
     * supersedes its own request, which is safe. This one does have a guard, so
     * a re-run cancels without replacing.
     *
     * Aborting is still worth doing -- an abandoned /assess is a metered
     * generation nobody will read -- but only when the player is genuinely
     * going away. So the abort moved to the unmount-only effect alongside the
     * hint, practice and explain controllers.
     */
    const ctrl = new AbortController();
    assessAbort.current = ctrl;

    (async () => {
      let assessment: AssessmentResult | null = null;
      let failure: unknown = null;
      try {
        // atLeast: let the three check-off lines actually play.
        assessment = await atLeast(
          900,
          ai.assessResponse(
            {
              topic: course.topic,
              conceptName: st.lesson!.conceptName,
              lesson: st.lesson!,
              answers: st.answers,
            },
            // Previously unsignalled, so leaving mid-grade billed for a
            // generation nobody would ever read.
            { signal: ctrl.signal },
          ),
        );
      } catch (e) {
        if (ctrl.signal.aborted) return;
        failure = e;
      }

      const total = questionCount(st);
      const graded = assessment ?? localAssessment(st.correctCount, total);

      // Outside the try, and unconditional. This is the change.
      dispatch(
        buildCommit(app, {
          courseId: course.id,
          conceptIds: st.conceptIds,
          mode: st.mode,
          startedAt: st.startedAt,
          assessment: graded,
          answers: st.answers,
          correct: st.correctCount,
          total,
          hintsUsed: st.hintsUsed,
        }),
      );

      send({
        type: 'EVALUATED',
        payload: {
          assessment: graded,
          gradedLocally: assessment == null,
          gradingError: failure ? describeAiError(failure).title : null,
        },
      });
    })();
    // Deliberately no cleanup -- see the note above the controller.
  }, [st.stage, st.lesson, course, committed, app, dispatch, st]);

  /**
   * The exit confirmation is a real modal now.
   *
   * It was reached by pressing Escape and then received no focus at all, so the
   * dialog appeared and the keyboard was still on the page behind it -- Tab
   * walked the lesson underneath while a modal claimed to be blocking it.
   */
  useFocusTrap(exitRef, st.exitPrompt, {
    onEscape: () => send({ type: 'PROMPT_EXIT', payload: { open: false } }),
    initial: keepRef,
  });

  /* ------------------------------------------------------ keyboard --- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (st.stage === 'attempt' && !st.revealed) {
        const q = currentQuestion(st);
        if (q?.type === 'multipleChoice' && q.options) {
          const i = KEYS.indexOf(e.key);
          if (i >= 0 && i < q.options.length) {
            send({ type: 'SELECT', payload: { value: q.options[i]! } });
            e.preventDefault();
          }
        }
      }
      // Escape OPENS the prompt; once it is open the focus trap owns the key
      // and closes it, so this must not re-open what the trap just dismissed.
      if (e.key === 'Escape' && !st.exitPrompt) {
        send({ type: 'PROMPT_EXIT', payload: { open: true } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st]);

  if (!course || !concept) {
    return (
      <div className={s.wrap}>
        <div className={s.center}>
          <p>That concept is not in your current course.</p>
          <Press onClick={() => navigate(ROUTES.path)}>Back to your path</Press>
        </div>
      </div>
    );
  }

  const q = currentQuestion(st);
  const total = questionCount(st);
  // Computed for the feedback stage only: which rubric keys the answer hit.
  const rubric =
    st.stage === 'feedback' && q && q.type === 'shortAnswer'
      ? matchRubric(
          q.rubric && q.rubric.keywords.length > 0 ? q.rubric : rubricFromModelAnswer(q.correctAnswer ?? ''),
          st.answers[q.id] ?? '',
        )
      : null;
  const slides = st.lesson?.slides ?? [];

  function check() {
    if (!q) return;
    const value = q.type === 'multipleChoice' ? (st.selected ?? '') : st.draft.trim();
    const verdict = gradeLocally(q, value);
    // Three verdicts, three cues. An ungraded answer gets its own neutral note
    // rather than borrowing the "correct" one, for the same reason the UI
    // refuses to call it correct.
    playCue(verdict === true ? 'correct' : verdict === false ? 'incorrect' : 'ungraded');
    send({ type: 'CHECK', payload: { correct: verdict } });
  }

  /**
   * A hint is a network request, and it was being treated as if it could not
   * fail or take time.
   *
   * There was no pending state -- the button sat there looking unclicked for
   * the length of the round trip -- and no catch at all. In live mode
   * generateHint throws `unconfigured`, because there is no /hint endpoint yet,
   * so clicking Hint produced an unhandled rejection and absolutely nothing on
   * screen. The one path where the user has already admitted they are stuck was
   * the one path that failed silently.
   */
  /**
   * Hints ESCALATE now, and there is more than one of them.
   *
   * Before: `level: 1` hardcoded at the only call site, a button that disabled
   * itself the moment it was used, and a `1 | 2 | 3` type that made levels 2
   * and 3 unreachable anyway. So the contract described a three-step ladder and
   * the product shipped a single rung.
   *
   * Widening the type was the easy half. The half that matters is `priorHints`:
   * the endpoint is stateless, so asked for "hint 4" and nothing else it
   * regenerates roughly the nudge it gave for hint 1. Sending what has already
   * been said is the only thing that makes the next one go further -- and it is
   * why this state is per-question and cleared on CONTINUE.
   */
  const hintLevel = st.hintsForQuestion.length + 1;
  const maxHintLevel = Math.max(3, hintLevel);
  const hintsLeft = !st.hintsExhausted;

  async function hint() {
    if (!q || !course || hintState === 'pending' || st.hintsExhausted) return;
    setHintState('pending');
    setHintError(null);
    const ctrl = new AbortController();
    hintAbort.current?.abort();
    hintAbort.current = ctrl;
    try {
      const r = await ai.generateHint(
        {
          topic: course.topic,
          conceptName: concept!.name,
          question: q,
          partialAttempt: st.draft,
          level: hintLevel,
          maxLevel: maxHintLevel,
          priorHints: st.hintsForQuestion,
        },
        // Was unsignalled. Leaving the screen mid-hint billed for a generation
        // nobody would ever read -- on the one path where the learner has
        // already said they are stuck.
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      send({ type: 'HINT', payload: { text: r.text, exhausted: r.exhausted } });
      setHintState('idle');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const copy = describeAiError(e);
      setHintState('failed');
      setHintError(copy.body.split('\n')[0] ?? copy.title);
    }
  }

  /**
   * "More practice" -- the unbounded half of the product.
   *
   * Batched rather than bulk: a lesson's latency tracks its output tokens, so
   * twenty questions is 19.8s measured and forty would breach the client's
   * abort. Asking for a few at a time, and telling the server what has already
   * been seen, is what makes practice both responsive AND non-repeating.
   */
  async function morePractice() {
    if (!course || !concept || practiceState === 'pending') return;
    setPracticeState('pending');
    setPracticeError(null);
    const ctrl = new AbortController();
    practiceAbort.current?.abort();
    practiceAbort.current = ctrl;
    try {
      const batch = await ai.generateQuestions(
        {
          topic: course.topic,
          conceptName: concept.name,
          level: course.level,
          count: Math.max(1, app.settings.questionsPerLesson || 2),
          types: ['multipleChoice', 'shortAnswer'],
          // Every prompt this session has shown, so the next batch cannot
          // repeat one. This is the entire mechanism behind "forever".
          seenPrompts: (st.lesson?.questions ?? []).map((x) => x.prompt),
        },
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      send({ type: 'APPEND_QUESTIONS', payload: { questions: batch } });
      setPracticeState('idle');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setPracticeState('failed');
      setPracticeError(describeAiError(e).title);
    }
  }

  /**
   * "I don't follow this" on a single slide.
   *
   * Deliberately NOT a re-teach. `/lesson` with `isReview` replaces the whole
   * session on a later day; this replaces the PARAGRAPH in front of the learner
   * and keeps them where they are. The contract has always had both and they
   * are different products -- collapsing them would mean regenerating an entire
   * lesson to answer a question about one slide.
   */
  async function explainThisSlide() {
    const slide = slides[st.slideIndex];
    if (!course || !concept || !slide || explainState === 'pending') return;
    setExplainState('pending');
    const ctrl = new AbortController();
    explainAbort.current?.abort();
    explainAbort.current = ctrl;
    try {
      const text = await ai.explainDifferently(
        {
          topic: course.topic,
          conceptName: concept.name,
          priorExplanation: slide.body,
          confusionPoint: '',
        },
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      setExplained((prev) => ({ ...prev, [slide.id]: text }));
      setExplainState('idle');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setExplainState('failed');
      setExplainError(describeAiError(e).title);
    }
  }

  const exitNow = () => navigate(st.stage === 'results' ? ROUTES.today : ROUTES.path);

  return (
    <div className={s.wrap}>
      <div className={s.top}>
        <button
          type="button"
          className={s.close}
          aria-label="Leave session"
          onClick={() =>
            st.stage === 'intro' || st.stage === 'results'
              ? exitNow()
              : send({ type: 'PROMPT_EXIT', payload: { open: true } })
          }
        >
          <X size={22} weight="bold" />
        </button>

        {/*
          WINDOWED, because the question count is now the learner's to choose.

          One segment per question is fine at 2 and unreadable past about 20:
          at 360px, 30 questions is roughly 8px each and 60 is 2px, which is
          narrower than the gap between them. A bar that renders as grey mush is
          not a progress indicator.

          Past the threshold it shows a fixed window around the current question
          plus a count. The count is the honest part -- it says exactly where you
          are, which the segments stop being able to do.
        */}
        {total > SEG_MAX ? (
          <div className={s.segsWide}>
            <div className={s.segs} aria-hidden="true">
              {segWindow(st.questionIndex, total).map((i) => (
                <span
                  key={i}
                  className={s.seg}
                  data-state={
                    i < st.questionIndex ? 'done' : i === st.questionIndex ? 'active' : 'idle'
                  }
                />
              ))}
            </div>
            <span className={s.segCount}>
              {st.questionIndex + 1}/{total}
            </span>
          </div>
        ) : (
        <div className={s.segs} aria-hidden="true">
          {Array.from({ length: Math.max(total, 1) }, (_, i) => (
            <span
              key={i}
              className={s.seg}
              data-state={
                i < st.questionIndex || (i === st.questionIndex && st.revealed)
                  ? st.answers[st.lesson?.questions[i]?.id ?? ''] != null &&
                    st.lesson?.questions[i]?.correctAnswer ===
                      st.answers[st.lesson?.questions[i]?.id ?? '']
                    ? 'done'
                    : i === st.questionIndex && st.lastCorrect
                      ? 'done'
                      : 'wrong'
                  : i === st.questionIndex
                    ? 'active'
                    : 'idle'
              }
            />
          ))}
        </div>
        )}

        <div className={s.topStats}>
          {st.combo >= 2 && (
            <Chip tone="streak" caps>
              {st.combo} in a row
            </Chip>
          )}
          {app.settings.challengeMode && Number.isFinite(st.hearts) && (
            <Chip tone={st.hearts <= 1 ? 'stop' : 'neutral'}>{'♥'.repeat(Math.max(0, st.hearts))}</Chip>
          )}
        </div>
      </div>

      <div className={s.body}>
        {st.stage === 'loading' && (
          <div className={s.center}>
            <PressLoader
              label={mode === 'review' ? 'Pulling your review…' : 'Writing your lesson…'}
              note={`${concept.name} · ${course.level} · about ${course.dailyTimeMin} minutes`}
            />
          </div>
        )}

        {st.stage === 'error' && (
          <div className={s.center}>
            <Pica state="oof" size={140} />
            {(() => {
              const copy = describeAiError(
                st.errorKind ? new AiError(st.errorKind, st.error ?? '') : new Error(st.error ?? ''),
              );
              return (
                <>
                  <h2 className={s.dialogTitle}>{copy.title}</h2>
                  <p className={s.errorBody}>{copy.body}</p>
                  <div className={s.errorActions}>
                    {copy.retryable && (
                      <Press onClick={() => window.location.reload()}>Try again</Press>
                    )}
                    <Press variant="ghost" onClick={() => navigate(ROUTES.path)}>
                      Back to your path
                    </Press>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {st.stage === 'intro' && st.lesson && (
          <div className={s.center}>
            <Chip tone="brand" caps>
              Concept {concept.order} of {course.concepts.length}
            </Chip>
            <h1 className={s.conceptName}>{concept.name}</h1>
            <div className={s.objectives}>
              {st.lesson.objectives.map((o) => (
                <div key={o} className={s.objective}>
                  <span className={s.dot} aria-hidden="true" />
                  <span>{o}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {st.stage === 'teach' && st.lesson && (
          <div className={s.card}>
            {/* Same problem, same answer. The dots are fixed 8px in a flex row
                with no wrap, so they overflow a phone card past roughly 28 --
                and a lesson may now carry up to 12 slides, with older responses
                deriving one per paragraph. Past the threshold this becomes a
                count, which does not overflow at any length. */}
            {slides.length > SEG_MAX ? (
              <div className={s.slideCount}>
                Slide {st.slideIndex + 1} of {slides.length}
              </div>
            ) : (
              <div className={s.slideDots} aria-hidden="true">
                {slides.map((sl, i) => (
                  <span key={sl.id} className={s.slideDot} data-on={i <= st.slideIndex} />
                ))}
              </div>
            )}
            {/*
              Keyed on the slide index so the reveal replays on every Continue.
              Without the key React reuses the same nodes and only swaps their
              text, which updates the words without re-triggering the animation
              -- the first slide would animate and every later one would appear.
            */}
            <div key={st.slideIndex} className={s.slideBody}>
              <h2 className={s.slideHeading}>{slides[st.slideIndex]?.heading}</h2>
              {slides[st.slideIndex]?.kind === 'example' ? (
                <div className={s.exampleBox}>
                  <Reveal text={slides[st.slideIndex]?.body ?? ''} />
                </div>
              ) : (
                <div className={s.prose}>
                  <Reveal text={slides[st.slideIndex]?.body ?? ''} />
                </div>
              )}

              {/*
                "Explain differently" is a real control now.

                `explainDifferently` was one of four contracted tasks with no
                endpoint AND no caller. Shipping the endpoint alone would have
                left it to drift unexercised, so it arrives with the button --
                here, on the slide, because this task replaces a PARAGRAPH and
                keeps the learner in place. The whole-session re-teach is a
                different product and lives on /lesson with isReview.
              */}
              {explained[slides[st.slideIndex]?.id ?? ''] ? (
                <div className={s.reExplain}>
                  <span className={s.reExplainLabel}>Another way of putting it</span>
                  {explained[slides[st.slideIndex]?.id ?? '']}
                </div>
              ) : (
                <div className={s.slideActions}>
                  <Press
                    size="sm"
                    variant="ghost"
                    disabled={explainState === 'pending'}
                    onClick={explainThisSlide}
                  >
                    {explainState === 'pending' ? 'Rethinking…' : "I don't follow this"}
                  </Press>
                  {explainState === 'failed' && explainError && (
                    <span className={s.inlineError} role="status">
                      {explainError}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {(st.stage === 'attempt' || st.stage === 'feedback') && q && (
          <div className={s.card}>
            <div className={s.qCount}>
              Question {st.questionIndex + 1} of {total}
            </div>
            <div className={s.prompt}>{q.prompt}</div>

            {q.type === 'multipleChoice' && q.options ? (
              <div className={s.options} role="radiogroup" aria-label={q.prompt}>
                {q.options.map((opt, i) => {
                  const chosen = st.selected === opt;
                  const verdict = !st.revealed
                    ? undefined
                    : opt === q.correctAnswer
                      ? 'correct'
                      : chosen
                        ? 'incorrect'
                        : undefined;
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      data-verdict={verdict}
                      data-dim={st.revealed && !verdict}
                      className={s.option}
                      disabled={st.revealed}
                      onClick={() => send({ type: 'SELECT', payload: { value: opt } })}
                    >
                      {/* Hidden rather than rendered empty past the shortcut
                          list: a blank badge looks like a missing character,
                          and implies a key that does nothing. */}
                      {KEYS[i] && (
                        <span className={s.optionKey} aria-hidden="true">
                          {KEYS[i]}
                        </span>
                      )}
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className={s.hintRow}>
                  {/* Stays enabled while levels remain. It used to disable
                      itself after one press, which is why levels 2 and 3 of a
                      three-level ladder were unreachable in the shipped app. */}
                  <Press
                    size="sm"
                    variant="ghost"
                    disabled={!hintsLeft || hintState === 'pending'}
                    onClick={hint}
                  >
                    {hintState === 'pending'
                      ? 'Thinking…'
                      : !hintsLeft
                        ? 'No more hints'
                        : st.hintsForQuestion.length === 0
                          ? 'Hint (−2 XP)'
                          : `Another hint (−2 XP)`}
                  </Press>
                  {st.hintsForQuestion.length > 0 && (
                    <span className={s.hintCount}>
                      {st.hintsForQuestion.length} hint
                      {st.hintsForQuestion.length === 1 ? '' : 's'} used
                    </span>
                  )}
                </div>
                <textarea
                  className={s.answerBox}
                  value={st.draft}
                  disabled={st.revealed}
                  aria-label="Your answer"
                  placeholder="Explain it in your own words…"
                  onChange={(e) => send({ type: 'DRAFT', payload: { value: e.target.value } })}
                />
                {/* True in both modes, so it does not have to lie in either: the
                    instant check is keyword overlap, and the score on the
                    results screen comes from the full assessment. The previous
                    copy promised a real model "when the backend is connected",
                    which went stale the moment it was. */}
                <p className={s.gradingNote}>
                  The instant check looks for key ideas, not meaning. Your score comes from the full
                  assessment at the end.
                </p>
              </>
            )}

            {/* All of them, in order. Replacing the previous hint with the next
                one would hide the ladder the learner just climbed, and the
                earlier rungs are what make the later ones make sense. */}
            {st.hintsForQuestion.map((h, i) => (
              <div key={`${i}-${h.slice(0, 24)}`} className={s.hintText}>
                {st.hintsForQuestion.length > 1 && (
                  <span className={s.hintIndex} aria-hidden="true">
                    {i + 1}
                  </span>
                )}
                {h}
              </div>
            ))}
            {/* A failed hint is stated, and charges nothing -- the XP penalty
                is applied by the HINT action, which never fired. */}
            {hintState === 'failed' && hintError && (
              <div className={s.hintText} data-failed="true" role="status">
                No hint available. {hintError}
              </div>
            )}
            {practiceState === 'failed' && practiceError && (
              <div className={s.hintText} data-failed="true" role="status">
                Could not write more questions. {practiceError}
              </div>
            )}
          </div>
        )}

        {st.stage === 'evaluating' && (
          <div className={s.center}>
            <Pica state="think" size={120} />
            <div className={s.steps}>
              {['Checking answers', 'Looking for misconceptions', 'Updating mastery'].map((label, i) => (
                <div key={label} className={s.step} style={{ '--i': i } as CSSProperties}>
                  <CheckCircle size={20} weight="fill" className={s.stepDone} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}

        {st.stage === 'results' && st.assessment && (
          <>
            {/*
              Says out loud that this score did not come from the model.

              The session is committed either way now, which is the fix for
              losing a completed run to an /assess timeout. But a keyword tally
              presented as a model's judgement would be the same class of lie
              as the hardcoded 75% this project deleted -- so the banner is not
              optional, it is the thing that makes committing anyway honest.
            */}
            {st.gradedLocally && (
              <div className={s.localGrade} role="status">
                <strong>Scored on this device.</strong> {st.gradingError ?? 'The full assessment could not be reached'} —
                so this score counts only the questions checked as you went, and there is no written
                feedback or misconception analysis. Your progress was saved.
              </div>
            )}
            <ResultsPanel
            assessment={st.assessment}
            conceptId={concept.id}
            queue={queue}
            onNavigate={(to) => navigate(to)}
            />
            {/* The last contracted task to gain a caller. Offered after the
                commit, never required, and explicitly scoreless. */}
            <TeachBack topic={course.topic} conceptName={st.lesson?.conceptName ?? concept.name} />
          </>
        )}
      </div>

      {/* One footer, one primary button, label changes per stage -- the user
          never has to hunt for the next click. */}
      {st.stage !== 'results' && st.stage !== 'loading' && st.stage !== 'error' && (
        <div
          className={s.footer}
          data-verdict={
            st.stage === 'feedback'
              ? st.lastCorrect === true
                ? 'correct'
                : st.lastCorrect === false
                  ? 'incorrect'
                  : 'ungraded'
              : undefined
          }
        >
          <div className={s.footerInner}>
            {st.stage === 'feedback' && q && (
              <div className={s.verdict} aria-live="polite">
                {/*
                  `replay` is the question index, not the verdict.

                  Two correct answers in a row leave `state` at "cheer" on an
                  element that is already cheering, and a CSS animation cannot
                  re-trigger itself -- so the reward would silently stop
                  arriving exactly when someone starts doing well. Changing
                  `replay` is what tells usePica to restart it. See usePica.ts.
                */}
                <Pica
                  className={s.verdictPica}
                  size={46}
                  state={st.lastCorrect === true ? 'cheer' : st.lastCorrect === false ? 'oof' : 'think'}
                  replay={st.questionIndex}
                />
                <div className={s.verdictText}>
                <div className={s.verdictLabel}>
                  {st.lastCorrect === true ? (
                    <CheckCircle size={24} weight="fill" />
                  ) : st.lastCorrect === false ? (
                    <XCircle size={24} weight="fill" />
                  ) : (
                    <Question size={24} weight="fill" />
                  )}
                  {st.lastCorrect === true
                    ? 'Correct'
                    : st.lastCorrect === false
                      ? 'Not quite'
                      : 'Recorded — not graded'}
                </div>

                {/* Rubric answers say WHICH key ideas landed. "Offline grading"
                    is only honest if it shows its working. */}
                {rubric && (
                  <div className={s.rubric}>
                    <span className={s.rubricNote}>
                      Offline grading — checks for key ideas ({rubric.found.length}/{rubric.required})
                    </span>
                    <span className={s.rubricChips}>
                      {rubric.found.map((k) => (
                        <Chip key={k} tone="go">
                          ✓ {k}
                        </Chip>
                      ))}
                      {rubric.missed.map((k) => (
                        <Chip key={k} tone="neutral">
                          {k}
                        </Chip>
                      ))}
                    </span>
                  </div>
                )}

                {st.lastCorrect === false && q.correctAnswer && (
                  <div className={s.verdictWhy}>
                    The answer is: {q.correctAnswer}
                    {q.why ? ` — ${q.why}` : ''}
                  </div>
                )}
                {st.lastCorrect === null && (
                  <div className={s.verdictWhy}>
                    This one has no answer key, so we recorded it without scoring it. Your final
                    score comes from the full assessment.
                  </div>
                )}
                {st.lastCorrect === true && q.why && <div className={s.verdictWhy}>{q.why}</div>}
                </div>
              </div>
            )}

            {st.stage === 'intro' && <div className={s.verdict} />}
            {st.stage === 'teach' && <div className={s.verdict} />}
            {st.stage === 'attempt' && <div className={s.verdict} />}

            {st.stage === 'intro' && (
              <Press size="lg" onClick={() => send({ type: 'START' })}>
                {st.mode === 'lesson' ? 'Start lesson' : 'Start review'}
              </Press>
            )}

            {st.stage === 'teach' && (
              <>
                {st.slideIndex > 0 && (
                  <Press variant="ghost" onClick={() => send({ type: 'SLIDE_PREV' })}>
                    Back
                  </Press>
                )}
                <Press size="lg" onClick={() => send({ type: 'SLIDE_NEXT' })}>
                  {st.slideIndex >= slides.length - 1 ? 'Got it — quiz me' : 'Continue'}
                </Press>
              </>
            )}

            {st.stage === 'attempt' && (
              <Press size="lg" disabled={!canCheck(st)} onClick={check}>
                Check
              </Press>
            )}

            {st.stage === 'feedback' && (
              <>
                {/*
                  UNLIMITED PRACTICE, and it needed a button as much as an
                  endpoint. `/questions` had neither a route nor a caller; the
                  route alone would have shipped zero user-visible behaviour.

                  Offered only on the last question, where "keep going" is a
                  real choice rather than a way to skip the one in front of you.
                */}
                {isLastQuestion(st) && (
                  <Press
                    variant="ghost"
                    disabled={practiceState === 'pending'}
                    onClick={morePractice}
                  >
                    {practiceState === 'pending' ? 'Writing more…' : 'More practice'}
                  </Press>
                )}
                <Press
                  size="lg"
                  variant={st.lastCorrect === true ? 'go' : st.lastCorrect === false ? 'stop' : 'brand'}
                  onClick={() => send({ type: 'CONTINUE' })}
                >
                  {isLastQuestion(st) ? 'See results' : 'Continue'}
                </Press>
              </>
            )}
          </div>
        </div>
      )}

      {st.exitPrompt && (
        <div
          ref={exitRef}
          className={s.scrim}
          role="dialog"
          aria-modal="true"
          aria-label="Leave this lesson?"
        >
          <div className={s.dialog}>
            <div className={s.dialogTitle}>Leave this lesson?</div>
            <p className={s.dialogBody}>
              Nothing from this session will be saved — no XP, no change to your mastery or your review
              schedule.
            </p>
            <div className={s.dialogActions}>
              {/*
                "Keep learning" takes focus, not "Leave".

                This dialog is reached by pressing Escape, which is frequently a
                miss-hit. Landing focus on the destructive option means one
                reflexive Enter discards the session -- so the safe choice is
                the default, and it is also the one Escape now maps to.
              */}
              <Press
                ref={keepRef}
                block
                onClick={() => send({ type: 'PROMPT_EXIT', payload: { open: false } })}
              >
                Keep learning
              </Press>
              <Press block variant="danger" onClick={exitNow}>
                Leave
              </Press>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { Lightning };
