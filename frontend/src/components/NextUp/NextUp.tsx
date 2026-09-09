import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Card } from '../Card/Card';
import { Press } from '../Press/Press';
import { Chip } from '../Chip/Chip';
import { useAppState } from '../../state/AppStateContext';
import {
  selectActiveCourse,
  selectQueue,
  selectToday,
} from '../../state/selectors';
import { effectiveMastery } from '../../domain/mastery';
import { ai } from '../../lib/ai';
import { describeAiError } from '../../lib/ai/errorCopy';
import type { NextRecommendation } from '../../lib/ai/contracts';
import { sessionHref } from '../../router/session';
import { ROUTES } from '../../router/routes';
import s from './NextUp.module.css';

/**
 * `recommendNext` finally has a caller.
 *
 * It was one of four contracted tasks with neither an endpoint nor a screen.
 * Building the endpoint alone would have shipped exactly zero user-visible
 * behaviour and left the route to drift away from its own contract unnoticed,
 * so it arrives with this.
 *
 * WHY IT IS A BUTTON AND NOT AUTOMATIC. The app already decides what to do next
 * locally, for free, from real SRS state -- `selectNextAction` and the due queue
 * are correct and instant. A model call cannot beat them on scheduling, because
 * the scheduling is arithmetic this client already did.
 *
 * What it adds is the reasoning: a sentence about WHY, given the shape of this
 * learner's retention, which no amount of local arithmetic produces. That is
 * worth a deliberate press and a few seconds. It is not worth spending a
 * generation on every single render of the home screen, which is what making it
 * automatic would mean.
 */
export function NextUp() {
  const app = useAppState();
  const [, navigate] = useLocation();
  const [rec, setRec] = useState<NextRecommendation | null>(null);
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const course = selectActiveCourse(app);
  if (!course) return null;

  const today = selectToday(app);
  const queue = selectQueue(app, 0);
  // Scoped to the active course: the queue spans every course, and naming a
  // concept from a different subject in this course's recommendation would
  // produce a button that navigates somewhere the learner did not expect.
  const mine = queue.filter((e) => e.courseId === course.id);
  const dueNames = mine.map((e) => e.concept.name);
  const overdueNames = mine.filter((e) => e.overdueDays > 0).map((e) => e.concept.name);

  async function ask() {
    if (state === 'pending' || !course) return;
    setState('pending');
    setError(null);
    const ctrl = new AbortController();
    abort.current?.abort();
    abort.current = ctrl;
    try {
      const out = await ai.recommendNext(
        {
          topic: course.topic,
          // DECAYED mastery, not the stored value. The stored number is what it
          // was when last studied; what matters for "what should I do now" is
          // what is left of it today, which is the whole point of the decay
          // model living client-side.
          masteryByConcept: Object.fromEntries(
            course.concepts
              .filter((c) => c.attempts > 0)
              .map((c) => [c.name, effectiveMastery(c)]),
          ),
          dueConcepts: dueNames,
          overdueConcepts: overdueNames,
          minutesAvailable: app.settings.dailyTimeMin,
        },
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      setRec(out);
      setState('idle');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState('failed');
      setError(describeAiError(e).title);
    }
  }

  /** The concept a recommendation points at, if this course actually has it.
   *  The server already filters names to the ones it was given, but the button
   *  is only rendered when a real target resolves -- a control that navigates
   *  nowhere is the thing this project exists to delete. */
  const target = rec?.conceptNames
    .map((n) => course.concepts.find((c) => c.name === n))
    .find((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <Card className={s.wrap}>
      <div className={s.head}>
        <span className={s.eyebrow}>What next</span>
        {rec && <Chip tone={rec.action === 'rest' ? 'neutral' : 'brand'}>{rec.action}</Chip>}
      </div>

      {rec ? (
        <>
          <p className={s.reason}>{rec.reason}</p>
          <div className={s.actions}>
            {rec.action === 'rest' ? (
              // No navigation offered, because the recommendation is to stop.
              // A "start something" button under the word "rest" would be the
              // app disagreeing with its own advice.
              <span className={s.restNote}>Nothing scheduled — coming back tomorrow is the plan.</span>
            ) : target ? (
              <Press
                onClick={() =>
                  navigate(
                    sessionHref(
                      target.id,
                      rec.action === 'review' ? 'review' : rec.action === 'practice' ? 'practice' : 'lesson',
                    ),
                  )
                }
              >
                {rec.action === 'review' ? 'Review' : rec.action === 'practice' ? 'Practice' : 'Start'}{' '}
                {target.name}
              </Press>
            ) : (
              <Press onClick={() => navigate(ROUTES.path)}>Open your path</Press>
            )}
            <Press variant="ghost" size="sm" disabled={state === 'pending'} onClick={ask}>
              {state === 'pending' ? 'Thinking…' : 'Ask again'}
            </Press>
          </div>
        </>
      ) : (
        <>
          <p className={s.pitch}>
            {dueNames.length > 0
              ? `${dueNames.length} concept${dueNames.length === 1 ? '' : 's'} due today. Ask for a read on what is worth your ${app.settings.dailyTimeMin} minutes.`
              : `Nothing is due. Ask for a read on where your ${app.settings.dailyTimeMin} minutes would do the most good.`}
          </p>
          <div className={s.actions}>
            <Press variant="ghost" disabled={state === 'pending'} onClick={ask}>
              {state === 'pending' ? 'Thinking…' : 'What should I do next?'}
            </Press>
          </div>
        </>
      )}

      {state === 'failed' && error && (
        <p className={s.error} role="status">
          {error}. Your due list above is unaffected — it is computed on this device.
        </p>
      )}
      <p className={s.footnote} aria-hidden={today ? undefined : true}>
        Scheduling is decided on this device from your own review history. This asks a model only
        for the reasoning.
      </p>
    </Card>
  );
}
