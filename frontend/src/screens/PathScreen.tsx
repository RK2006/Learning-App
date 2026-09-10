import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Lock, CheckCircle, ArrowsClockwise, Star } from '@phosphor-icons/react';
import { Screen } from './Screen';
import { Press } from '../components/Press/Press';
import { Card } from '../components/Card/Card';
import { Chip } from '../components/Chip/Chip';
import { Ring } from '../components/Ring/Ring';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { ai } from '../lib/ai';
import { describeAiError } from '../lib/ai/errorCopy';
import { selectActiveCourse, selectCourseProgress, selectToday } from '../state/selectors';
import { effectiveMastery, hasAttempted } from '../domain/mastery';
import { describeAgo, describeDue } from '../domain/time';
import { ROUTES } from '../router/routes';
import { sessionHref } from '../router/session';
import type { Concept, ConceptStatus } from '../types/domain';
import s from './PathScreen.module.css';

const STATUS_LABEL: Record<ConceptStatus, string> = {
  locked: 'Locked',
  current: 'Current',
  completed: 'Strong',
  needsReview: 'Needs review',
};

function StatusIcon({ status }: { status: ConceptStatus }) {
  if (status === 'locked') return <Lock size={18} weight="fill" />;
  if (status === 'completed') return <CheckCircle size={18} weight="fill" />;
  if (status === 'needsReview') return <ArrowsClockwise size={18} weight="bold" />;
  return <Star size={18} weight="fill" />;
}

export function PathScreen() {
  const app = useAppState();
  const dispatch = useDispatch();
  const [, navigate] = useLocation();
  const [extendState, setExtendState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const [extendError, setExtendError] = useState<string | null>(null);
  const extendAbort = useRef<AbortController | null>(null);
  const search = useSearch();
  const course = selectActiveCourse(app);
  const selectedId = new URLSearchParams(search).get('concept');

  if (!course) {
    return (
      <Screen eyebrow="Course map" title="Path">
        <Card className={s.empty}>
          <p>No course yet.</p>
          <Press onClick={() => navigate(ROUTES.onboarding)}>Create your first course</Press>
        </Card>
      </Screen>
    );
  }

  const today = selectToday(app);
  const allDone = course.concepts.every((c) => c.status === 'completed' || c.markedKnown);

  async function extend() {
    if (!course || extendState === 'pending') return;
    setExtendState('pending');
    setExtendError(null);
    const ctrl = new AbortController();
    extendAbort.current?.abort();
    extendAbort.current = ctrl;
    try {
      const concepts = await ai.extendPath(
        {
          topic: course.topic,
          level: course.level,
          dailyTimeMin: course.dailyTimeMin,
          goal: course.goal ?? '',
          // The path so far, in order. Without it the model regenerates
          // concepts the learner has already completed.
          after: [...course.concepts].sort((a, b) => a.order - b.order).map((c) => c.name),
          conceptCount: 5,
        },
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      dispatch({ type: 'EXTEND_PATH', payload: { courseId: course.id, concepts } });
      setExtendState('idle');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setExtendState('failed');
      setExtendError(describeAiError(e).title);
    }
  }
  const progress = selectCourseProgress(course);
  const selected = course.concepts.find((c) => c.id === selectedId) ?? null;
  const ordered = [...course.concepts].sort((a, b) => a.order - b.order);

  function open(c: Concept) {
    navigate(`${ROUTES.path}?concept=${c.id}`);
  }

  function unlockBlocker(c: Concept): Concept | null {
    const i = ordered.findIndex((x) => x.id === c.id);
    return i > 0 ? (ordered[i - 1] ?? null) : null;
  }

  return (
    <Screen
      eyebrow={`${course.topic} · ${course.level}`}
      title="Path"
      subtitle={`${ordered.filter((c) => c.status === 'completed').length} of ${ordered.length} concepts strong · ${Math.round(progress * 100)}% overall`}
      actions={<Press variant="ghost" onClick={() => navigate(ROUTES.onboarding)}>New course</Press>}
    >
      <div className={s.layout} data-drawer={selected != null}>
        <ol className={s.track}>
          {ordered.map((c, i) => {
            const eff = effectiveMastery(c);
            const decayed = Math.round(c.mastery - eff);
            // --i drives the entrance stagger and is CLAMPED at 8. Uncapped, a
            // twelve-concept path would still be arriving 540ms after the
            // screen appeared, which makes a longer course feel like a slower
            // app -- the stagger would be reporting length, not structure.
            return (
              <li key={c.id} className={s.node} style={{ '--i': Math.min(i, 8) } as CSSProperties}>
                <button
                  type="button"
                  className={s.nodeBtn}
                  data-status={c.status}
                  aria-current={c.status === 'current' ? 'step' : undefined}
                  aria-pressed={selectedId === c.id}
                  onClick={() => open(c)}
                >
                  <span className={s.nodeDisc}>
                    <Ring
                      value={eff / 100}
                      size={72}
                      thickness={7}
                      tone={
                        c.status === 'completed'
                          ? 'go'
                          : c.status === 'needsReview'
                            ? 'review'
                            : c.status === 'locked'
                              ? 'brand'
                              : 'spark'
                      }
                      label={`${c.name}: ${STATUS_LABEL[c.status]}`}
                    >
                      <StatusIcon status={c.status} />
                    </Ring>
                  </span>
                  <span className={s.nodeText}>
                    <span className={s.nodeName}>{c.name}</span>
                    <span className={s.nodeMeta}>
                      {STATUS_LABEL[c.status]}
                      {hasAttempted(c) && ` · ${Math.round(eff)}%`}
                      {decayed >= 2 && ` · ▼${decayed} from decay`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {selected && (
          <Card className={s.drawer}>
            <div className={s.drawerHead}>
              <div>
                <div className="eyebrow">
                  Concept {selected.order} of {ordered.length}
                </div>
                <h3 className={s.drawerTitle}>{selected.name}</h3>
              </div>
              <Chip
                tone={
                  selected.status === 'completed'
                    ? 'go'
                    : selected.status === 'needsReview'
                      ? 'review'
                      : selected.status === 'locked'
                        ? 'locked'
                        : 'spark'
                }
              >
                {STATUS_LABEL[selected.status]}
              </Chip>
            </div>

            {selected.status === 'locked' ? (
              <p className={s.lockNote}>
                {(() => {
                  const blocker = unlockBlocker(selected);
                  return blocker
                    ? `Unlocks once ${blocker.name} reaches 60%. It is at ${Math.round(effectiveMastery(blocker))}% right now.`
                    : 'Unlocks after the previous concept.';
                })()}
              </p>
            ) : (
              <dl className={s.stats}>
                <div>
                  <dt>Mastery now</dt>
                  <dd>{Math.round(effectiveMastery(selected))}%</dd>
                </div>
                <div>
                  <dt>Stored</dt>
                  <dd>{Math.round(selected.mastery)}%</dd>
                </div>
                <div>
                  <dt>Attempts</dt>
                  <dd>{selected.attempts}</dd>
                </div>
                <div>
                  <dt>Best score</dt>
                  <dd>{selected.bestScore}%</dd>
                </div>
                <div>
                  <dt>Last studied</dt>
                  <dd>{describeAgo(selected.lastStudiedAt)}</dd>
                </div>
                <div>
                  <dt>Next review</dt>
                  <dd>{describeDue(selected.review.dueOn, today)}</dd>
                </div>
              </dl>
            )}

            {selected.misconceptions.length > 0 && (
              <div className={s.misc}>
                <div className="eyebrow">Logged misconceptions</div>
                <div className={s.chips}>
                  {selected.misconceptions.map((m) => (
                    <Chip key={m.text} tone={m.resolvedAt ? 'go' : 'review'}>
                      {m.text} {m.count > 1 ? `×${m.count}` : ''}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {app.settings.showSrsInternals && hasAttempted(selected) && (
              <p className={s.srs}>
                interval {selected.review.intervalDays}d · ease {selected.review.ease.toFixed(2)} · reps{' '}
                {selected.review.reps} · lapses {selected.review.lapses}
              </p>
            )}

            <div className={s.drawerActions}>
              <Press
                block
                disabled={selected.status === 'locked'}
                onClick={() =>
                  navigate(
                    sessionHref(selected.id, selected.status === 'needsReview' ? 'review' : 'lesson'),
                  )
                }
              >
                {selected.status === 'needsReview'
                  ? 'Review this'
                  : hasAttempted(selected)
                    ? 'Practice again'
                    : 'Start lesson'}
              </Press>
              <Press variant="ghost" block onClick={() => navigate(ROUTES.path)}>
                Close
              </Press>
            </div>
          </Card>
        )}
        {/*
          THE END OF A COURSE IS NO LONGER A DEAD END.

          Every concept done used to mean `selectNextLocked` returning null, the
          results screen falling through to "Back to Today", and nothing
          anywhere offering a way forward. The curriculum was fixed at seven at
          generation time and there was no endpoint that could have produced an
          eighth.

          Deliberately placed here rather than on the results screen: this is
          where the learner can see the whole path they just finished, which is
          the context in which "keep going" is a decision rather than a prompt.
        */}
        {course.concepts.length > 0 && (
          <Card className={s.extend}>
            <div className={s.extendText}>
              <strong>
                {allDone ? 'You have finished this path.' : 'Want to go further?'}
              </strong>
              <p>
                {allDone
                  ? `All ${course.concepts.length} concepts are done. Adding more picks up where this left off — nothing you have already learned is reset or replaced.`
                  : `${course.concepts.length} concepts so far. You can add more at any point; they are appended after the ones you have, and your progress is untouched.`}
              </p>
              {extendState === 'failed' && extendError && (
                <p className={s.extendError} role="status">
                  {extendError}
                </p>
              )}
            </div>
            <Press
              variant={allDone ? 'brand' : 'ghost'}
              disabled={extendState === 'pending'}
              onClick={extend}
            >
              {extendState === 'pending' ? 'Designing…' : 'Add 5 more concepts'}
            </Press>
          </Card>
        )}
      </div>
    </Screen>
  );
}
