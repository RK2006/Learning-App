import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Ring } from '../components/Ring/Ring';
import { Chip } from '../components/Chip/Chip';
import { Press } from '../components/Press/Press';
import { Pica } from '../components/Pica/Pica';
import { LevelUp } from '../components/LevelUp/LevelUp';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { selectActiveCourse, selectDecideNext, selectGoalMet, selectXpToday } from '../state/selectors';
import { ACHIEVEMENTS_BY_ID } from '../domain/achievements';
import { levelFromXp, levelTitle, xpForLevel } from '../domain/xp';
import { describeDue } from '../domain/time';
import { useCounter } from '../lib/useCounter';
import { flyTo } from '../lib/motion';
import { celebrateFrom, stopCelebrating } from '../lib/celebrate';
import { playCue } from '../lib/sound';
import { ROUTES } from '../router/routes';
import { reviewHref, sessionHref } from '../router/session';
import type { AssessmentResult } from '../types/domain';
import s from './ResultsPanel.module.css';

export interface ResultsPanelProps {
  assessment: AssessmentResult;
  conceptId: string;
  /** Concepts still to come in a multi-concept run, in order. */
  queue?: string[];
  onNavigate: (to: string) => void;
}

/**
 * The payoff, and the branch point.
 *
 * The build this replaces printed "Review X tomorrow before moving on" as inert
 * text and then offered exactly one button, which wiped the entire session.
 * Both halves of the app's own recommendation now have a control under them.
 */
export function ResultsPanel({ assessment, conceptId, queue = [], onNavigate }: ResultsPanelProps) {
  const app = useAppState();
  const dispatch = useDispatch();
  const course = selectActiveCourse(app);
  const concept = course?.concepts.find((c) => c.id === conceptId) ?? null;
  const record = app.sessions[app.sessions.length - 1] ?? null;

  /**
   * A queue in flight outranks the decide-next rules.
   *
   * Those rules answer "what should this person do next?", which is the right
   * question at the end of a lesson and the wrong one two concepts into a
   * review run they explicitly started. Interrupting a run to recommend a run
   * is how an app ends up arguing with itself.
   */
  const nextInQueue = queue[0] ?? null;
  const nextConcept = nextInQueue ? (course?.concepts.find((c) => c.id === nextInQueue) ?? null) : null;

  const before = record?.masteryBefore[conceptId] ?? 0;
  const after = record?.masteryAfter[conceptId] ?? 0;
  const delta = Math.round(after - before);

  const decide = selectDecideNext(app, assessment.score, conceptId);
  const xpToday = selectXpToday(app);
  const goalMet = selectGoalMet(app);

  /**
   * Unseen achievements, captured ONCE on mount and acknowledged immediately.
   *
   * Without the acknowledge, `!seen` never becomes false and every results
   * screen forever re-announces the same unlocks -- including ones the demo
   * seeder awarded, which the user never earned in front of us. Capturing into
   * a ref first means the list does not vanish from under the user on the
   * re-render the acknowledgement causes.
   */
  const freshRef = useRef<string[] | null>(null);
  if (freshRef.current === null) {
    freshRef.current = Object.entries(app.achievements)
      .filter(([, a]) => !a.seen)
      .map(([id]) => id);
  }
  const freshIds = freshRef.current;
  const fresh = freshIds.map((id) => ACHIEVEMENTS_BY_ID[id]).filter(Boolean);

  useEffect(() => {
    if (freshIds.length > 0) dispatch({ type: 'ACK_ACHIEVEMENTS', payload: { ids: freshIds } });
  }, [freshIds, dispatch]);

  /* ------------------------------------------------------- the reward --- */

  /**
   * Did this session cross a level boundary?
   *
   * Derived rather than stored. The commit has already added the XP by the time
   * this panel mounts, so the level BEFORE is the level the remaining total
   * would have been -- session XP and achievement bonuses both subtracted,
   * because both count toward the level even though only the first counts
   * toward the daily goal.
   *
   * Captured in a ref on mount for the same reason `fresh` is: acknowledging
   * achievements re-renders this component, and a level-up that recomputed
   * itself to false on the second render would close its own overlay.
   */
  const rewardRef = useRef<{ leveledUp: boolean; level: number; goalJustMet: boolean } | null>(null);
  if (rewardRef.current === null) {
    const gained = (record?.xpAwarded ?? 0) + (record?.achievementXp ?? 0);
    const after = levelFromXp(app.profile.totalXp);
    const before = levelFromXp(Math.max(0, app.profile.totalXp - gained));
    rewardRef.current = {
      leveledUp: after > before,
      level: after,
      // Only session XP counts toward the goal, so that is what is subtracted
      // to find where the day stood a moment ago.
      goalJustMet:
        xpToday >= app.settings.dailyGoalXp &&
        xpToday - (record?.xpAwarded ?? 0) < app.settings.dailyGoalXp,
    };
  }
  const reward = rewardRef.current;

  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const scoreRef = useCounter<HTMLSpanElement>(assessment.score, { from: 0 });
  const xpTotalRef = useCounter<HTMLSpanElement>(record?.xpAwarded ?? 0, {
    from: 0,
    format: (n) => `+${Math.round(n)} XP`,
  });
  const heroRef = useRef<HTMLDivElement>(null);
  const totalRowRef = useRef<HTMLLIElement>(null);
  const chitRefs = useRef<(HTMLSpanElement | null)[]>([]);

  /**
   * The reveal, in order: chits fly, then we celebrate, then we interrupt.
   *
   * Sequencing matters more than the individual animations here. Firing
   * confetti while the XP lines are still arriving buries them; opening the
   * level-up overlay at the same moment hides the mastery change entirely,
   * which is the one number on this screen the user most needs to see.
   *
   * The flight delays are staggered so the chits feed the total rather than
   * hitting it at once, and the counter is still climbing while they land.
   */
  useEffect(() => {
    let alive = true;

    playCue('complete');

    void Promise.all(
      chitRefs.current.map((el, i) => flyTo(el, totalRowRef.current, { delay: 120 + i * 90 })),
    ).then(() => {
      if (!alive) return;
      if (reward.leveledUp) {
        setLevelUpOpen(true);
        // The overlay fires its own, larger burst -- two at once is noise.
        return;
      }
      if (assessment.score === 100) celebrateFrom('perfect', heroRef.current);
      else if (reward.goalJustMet) celebrateFrom('goal', heroRef.current);
    });

    return () => {
      alive = false;
      // Leaving mid-celebration must not leave particles raining on the next
      // screen. flyTo's clones remove themselves on their own animation.
      stopCelebrating();
    };
  }, [reward, assessment.score]);

  return (
    <div className={s.panel}>
      <LevelUp
        open={levelUpOpen}
        level={reward.level}
        title={levelTitle(reward.level)}
        atXp={xpForLevel(reward.level)}
        onClose={() => setLevelUpOpen(false)}
      />
      <div className={s.hero} ref={heroRef}>
        <Ring
          value={assessment.score / 100}
          grow
          size={128}
          thickness={12}
          tone={assessment.correct ? 'go' : 'stop'}
        >
          {/* React renders the final number; useCounter overwrites it in a
              layout effect and counts up to it. What a screen reader and a
              copy-paste get is the score, not whatever frame we are on. */}
          <span ref={scoreRef}>{assessment.score}</span>
        </Ring>
        <Pica state={assessment.correct ? 'cheer' : 'oof'} size={96} />
      </div>

      <p className={s.feedback}>{assessment.feedback}</p>

      {record && record.xpLines.length > 0 && (
        <div className={s.block}>
          <div className="eyebrow">XP earned</div>
          <ul className={s.xpList}>
            {record.xpLines.map((l, i) => (
              <li key={l.label} className={s.xpLine} style={{ '--i': i } as CSSProperties}>
                <span>{l.label}</span>
                <span
                  className={s.xpVal}
                  data-neg={l.value < 0}
                  ref={(el) => {
                    // Penalties do not fly. A hint deduction arriving at the
                    // total with the same flourish as a bonus reads as a
                    // reward, which is the opposite of what it is.
                    chitRefs.current[i] = l.value > 0 ? el : null;
                  }}
                >
                  {l.value > 0 ? '+' : ''}
                  {l.value}
                </span>
              </li>
            ))}
            <li className={s.xpTotal} ref={totalRowRef}>
              <span>Total</span>
              <span ref={xpTotalRef}>+{record.xpAwarded} XP</span>
            </li>
          </ul>
        </div>
      )}

      {concept && (
        <div className={s.block}>
          <div className="eyebrow">Mastery</div>
          <div className={s.masteryRow}>
            <span className={s.conceptName}>{concept.name}</span>
            <span className={s.masteryNums}>
              {Math.round(before)}% <span className={s.arrow}>→</span> {Math.round(after)}%
              <span className={s.delta} data-neg={delta < 0}>
                {delta >= 0 ? '+' : ''}
                {delta}
              </span>
            </span>
          </div>
          <div className={s.bar}>
            {/*
              The bar travels from `before` to `after`, including BACKWARD.

              A session that went badly pulls the EMA down, and watching the bar
              retreat is the entire stake this app offers in place of hearts.
              Rendering only the final value -- which is what this did -- threw
              that away: a drop from 69% to 58% looked identical to having
              always been at 58%.
            */}
            <span
              className={s.barFill}
              data-dir={delta < 0 ? 'down' : 'up'}
              style={
                {
                  '--from': `${Math.round(before)}%`,
                  '--to': `${Math.round(after)}%`,
                } as CSSProperties
              }
            />
          </div>
          <div className={s.nextReview}>Next review: {describeDue(concept.review.dueOn)}</div>
        </div>
      )}

      {assessment.misconceptions.length > 0 && (
        <div className={s.block}>
          <div className="eyebrow">What to work on</div>
          <div className={s.chips}>
            {assessment.misconceptions.map((m) => (
              <Chip key={m} tone="review">
                {m}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className={s.block}>
        <div className="eyebrow">Daily goal</div>
        <div className={s.goalRow}>
          <Ring value={xpToday / Math.max(1, app.settings.dailyGoalXp)} size={36} thickness={5} tone="go" />
          <span>
            {xpToday} / {app.settings.dailyGoalXp} XP today
            {goalMet ? ' — goal complete' : ` — ${app.settings.dailyGoalXp - xpToday} to go`}
          </span>
        </div>
      </div>

      {fresh.length > 0 && (
        <div className={s.block}>
          <div className="eyebrow">Unlocked</div>
          <div className={s.chips}>
            {fresh.map((a) => (
              <Chip key={a!.id} tone="spark">
                {a!.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {decide.banner && <div className={s.banner}>{decide.banner}</div>}

      <div className={s.actions}>
        {nextConcept ? (
          <>
            <Press
              size="lg"
              block
              variant="review"
              onClick={() => onNavigate(reviewHref(queue))}
            >
              Next review: {nextConcept.name}
            </Press>
            <Press variant="ghost" block onClick={() => onNavigate(ROUTES.review)}>
              {queue.length === 1 ? '1 left · stop here' : `${queue.length} left · stop here`}
            </Press>
          </>
        ) : (
          <>
            <Press
              size="lg"
              block
              onClick={() => {
                if (decide.primaryKind === 'retry' && decide.conceptId) {
                  onNavigate(sessionHref(decide.conceptId, 'practice'));
                } else if (decide.primaryKind === 'advance' && decide.conceptId) {
                  onNavigate(sessionHref(decide.conceptId, 'lesson'));
                } else if (decide.primaryKind === 'review') {
                  onNavigate(ROUTES.review);
                } else {
                  onNavigate(ROUTES.today);
                }
              }}
            >
              {decide.primaryLabel}
            </Press>
            <Press variant="ghost" block onClick={() => onNavigate(ROUTES.path)}>
              See my path
            </Press>
          </>
        )}
      </div>
    </div>
  );
}
