import { useState } from 'react';
import { Redirect } from 'wouter';
import { Press } from '../components/Press/Press';
import { Pica } from '../components/Pica/Pica';
import { PressLoader } from '../components/PressLoader/PressLoader';
import { ImportData } from '../components/ImportData/ImportData';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { ai } from '../lib/ai';
import { describeAiError } from '../lib/ai/errorCopy';
import { AiError } from '../lib/ai/contracts';
import { ROUTES } from '../router/routes';
import { now } from '../domain/time';
import { makeCourse } from '../state/course';
import type { Level } from '../types/domain';
import s from './OnboardingScreen.module.css';

const SUBJECTS = [
  'Probability',
  'Spanish vocabulary',
  'Music theory',
  'JavaScript fundamentals',
  'Cell biology',
  'Chess openings',
];

const LEVELS: { value: Level; label: string; note: string }[] = [
  { value: 'easy', label: 'Easy', note: 'Assume nothing. Define every term.' },
  { value: 'medium', label: 'Medium', note: 'Some background, new to this topic.' },
  { value: 'hard', label: 'Hard', note: 'Move fast, include the edge cases.' },
];

const GOALS: { minutes: number; xp: number; label: string; note: string }[] = [
  { minutes: 5, xp: 20, label: 'Casual', note: '5 min · 20 XP' },
  { minutes: 10, xp: 30, label: 'Regular', note: '10 min · 30 XP' },
  { minutes: 15, xp: 50, label: 'Serious', note: '15 min · 50 XP' },
  { minutes: 20, xp: 80, label: 'Intense', note: '20 min · 80 XP' },
];

export function OnboardingScreen() {
  const state = useAppState();
  const dispatch = useDispatch();

  const [done, setDone] = useState(false);
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState('');
  const [restoreNote, setRestoreNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [restored, setRestored] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof describeAiError> | null>(null);
  const [custom, setCustom] = useState('');
  const [level, setLevel] = useState<Level>('medium');
  const [goal, setGoal] = useState(GOALS[1]!);

  const chosenTopic = topic === '__custom' ? custom.trim() : topic;
  const busy = state.pathStatus === 'loading';

  async function generate() {
    dispatch({ type: 'PATH_REQUEST' });
    try {
      const concepts = await ai.generatePath({
        topic: chosenTopic,
        level,
        dailyTimeMin: goal.minutes,
        goal: '',
        // Was a literal 7, matched by a backend schema pinned at exactly 7, so
        // no caller could have asked for anything else even if it wanted to.
        conceptCount: Math.max(1, state.settings.pathLength || 7),
      });
      const at = now();
      const course = makeCourse({
        id: `c_${at}`,
        topic: chosenTopic,
        goal: '',
        level,
        dailyTimeMin: goal.minutes,
        createdAt: at,
        concepts,
      });
      dispatch({ type: 'PATH_SUCCESS', payload: { course, at } });
      dispatch({ type: 'SET_SETTING', payload: { level, dailyTimeMin: goal.minutes, dailyGoalXp: goal.xp } });
      setDone(true);
    } catch (e) {
      // The kind decides the words AND whether Try again is offered at all --
      // a retry button on an endpoint that does not exist is a lie with a
      // click target. See lib/ai/errorCopy.ts.
      const copy = describeAiError(e);
      setFailure(copy);
      dispatch({ type: 'PATH_FAILURE', payload: { message: copy.title } });
    }
  }

  /**
   * Leave declaratively, not with an imperative navigate().
   *
   * Calling navigate() right after dispatch races the reducer: wouter's location
   * updates, App's onboarding guard re-runs while `onboarded` is still false,
   * and it bounces straight back to /onboarding with the step state reset.
   * Batching `done` with the dispatches means this only renders once the state
   * it depends on has actually committed.
   */
  if (done && state.onboarded) return <Redirect to={ROUTES.path} />;

  /**
   * Same pattern, same reason, for a restored backup.
   *
   * The onboarding guard only ever redirects INTO this screen; nothing carries
   * you back out. So a successful import left the user sitting on "What do you
   * want to learn?" with twenty-four sessions of restored history behind it and
   * a one-line note as the only evidence anything had happened. Deciding to
   * leave declaratively -- rather than calling navigate() from the import
   * callback -- is what stops this racing the reducer the way the comment
   * above describes.
   */
  if (restored && state.onboarded) return <Redirect to={ROUTES.today} />;

  if (busy) {
    return (
      <div className={s.wrap}>
        <div className={s.inner}>
          <div className={s.loading}>
            <PressLoader
              label="Drafting your path…"
              note="Working out which concepts get you from nothing to useful, in the right order."
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <div className={s.inner}>
        <div className={s.progress} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={s.tick} data-done={i <= step} />
          ))}
        </div>

        {state.pathError && (
          <div className={s.error} role="alert">
            <strong className={s.errorTitle}>{failure?.title ?? state.pathError}</strong>
            {failure && <span className={s.errorBody}>{failure.body}</span>}
            {failure?.retryable !== false && (
              <Press size="sm" onClick={generate}>
                Try again
              </Press>
            )}
          </div>
        )}

        {step === 0 && (
          <>
            <div className={s.head}>
              <Pica size={72} />
              <div className={s.copy}>
                <h1 className={s.title}>What do you want to learn?</h1>
                <p className={s.sub}>Anything at all. The path is generated for whatever you pick.</p>
              </div>
            </div>
            <div className={s.grid}>
              {SUBJECTS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={s.tile}
                  aria-pressed={topic === t}
                  onClick={() => setTopic(t)}
                >
                  {t}
                </button>
              ))}
              <button
                type="button"
                className={s.tile}
                aria-pressed={topic === '__custom'}
                onClick={() => setTopic('__custom')}
              >
                Something else
                <span className={s.tileNote}>Type your own</span>
              </button>
            </div>
            {topic === '__custom' && (
              <div className={s.field}>
                <label className={s.label} htmlFor="custom-topic">
                  Your topic
                </label>
                <input
                  id="custom-topic"
                  value={custom}
                  autoFocus
                  placeholder="Roman history, knot theory, bread baking…"
                  onChange={(e) => setCustom(e.target.value)}
                />
              </div>
            )}

            {/*
              The way back in for a returning user.

              The router sends anyone with `onboarded === false` here and will
              not let them leave, which is right for a new user and a trap for
              someone who cleared their site data or opened a new browser: the
              Profile screen holding Import is unreachable, so the export they
              made was a one-way door. This is the only place that door opens
              from the outside.
            */}
            <div className={s.restore}>
              <span className={s.restoreText}>Been here before and have a backup file?</span>
              <ImportData
                size="sm"
                onDone={(text, bad) => setRestoreNote({ text, bad })}
                onImported={() => setRestored(true)}
              >
                Restore from a file
              </ImportData>
            </div>
            {restoreNote && (
              <p className={s.restoreNote} data-bad={restoreNote.bad || undefined} role="status">
                {restoreNote.text}
              </p>
            )}
            <div className={s.actions}>
              <div className={s.spacer} />
              <Press size="lg" disabled={!chosenTopic} onClick={() => setStep(1)}>
                Continue
              </Press>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className={s.head}>
              <div className={s.copy}>
                <h1 className={s.title}>How deep should we go?</h1>
                <p className={s.sub}>This changes how each lesson is written, not just how hard it is.</p>
              </div>
            </div>
            <div className={s.grid}>
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  className={s.tile}
                  aria-pressed={level === l.value}
                  onClick={() => setLevel(l.value)}
                >
                  {l.label}
                  <span className={s.tileNote}>{l.note}</span>
                </button>
              ))}
            </div>
            <div className={s.actions}>
              <Press variant="ghost" onClick={() => setStep(0)}>
                Back
              </Press>
              <div className={s.spacer} />
              <Press size="lg" onClick={() => setStep(2)}>
                Continue
              </Press>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className={s.head}>
              <div className={s.copy}>
                <h1 className={s.title}>How much time a day?</h1>
                <p className={s.sub}>
                  Your daily goal is XP, not minutes — so a good short session counts the same as a long
                  distracted one.
                </p>
              </div>
            </div>
            <div className={s.grid}>
              {GOALS.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  className={s.tile}
                  aria-pressed={goal.label === g.label}
                  onClick={() => setGoal(g)}
                >
                  {g.label}
                  <span className={s.tileNote}>{g.note}</span>
                </button>
              ))}
            </div>
            <div className={s.actions}>
              <Press variant="ghost" onClick={() => setStep(1)}>
                Back
              </Press>
              <div className={s.spacer} />
              <Press size="lg" onClick={generate}>
                Build my path
              </Press>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
