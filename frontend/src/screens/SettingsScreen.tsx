import { useState } from 'react';
import { Link } from 'wouter';
import { Screen } from './Screen';
import { Press } from '../components/Press/Press';
import { Card } from '../components/Card/Card';
import { Chip } from '../components/Chip/Chip';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { breakStreak, resetClock, resetProgress, travelDays } from '../state/actions';
import { seedDemo } from '../state/demoData';
import { ai } from '../lib/ai';
import { DAY_MS, formatDayLong, dayKey, now } from '../domain/time';
import { applyMotion, applyTheme, getMotionPref, getThemePref } from '../lib/theme';
import { playCue, setSoundEnabled } from '../lib/sound';
import type { MotionPref, ThemePref } from '../lib/theme';
import { ROUTES } from '../router/routes';
import s from './SettingsScreen.module.css';

const GOALS = [
  { xp: 20, minutes: 5, label: 'Casual' },
  { xp: 30, minutes: 10, label: 'Regular' },
  { xp: 50, minutes: 15, label: 'Serious' },
  { xp: 80, minutes: 20, label: 'Intense' },
];

/** A labelled row. Every control in here writes straight to the store; there is
 *  no local draft state and no Save button, because there is nothing to
 *  validate and a settings screen that can be left half-applied is a bug. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={s.row}>
      <div className={s.rowLabel}>
        <span>{label}</span>
        {hint && <span className={s.hint}>{hint}</span>}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div className={s.segmented} role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={s.segment}
          data-on={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={s.toggle}
      data-on={checked}
      onClick={() => onChange(!checked)}
    >
      <span className={s.knob} aria-hidden="true" />
    </button>
  );
}

export function SettingsScreen() {
  const app = useAppState();
  const dispatch = useDispatch();
  const [theme, setThemeState] = useState<ThemePref>(() => getThemePref());
  const [motion, setMotionState] = useState<MotionPref>(() => getMotionPref());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [eraseText, setEraseText] = useState('');

  const set = (patch: Partial<typeof app.settings>) =>
    dispatch({ type: 'SET_SETTING', payload: patch });

  const offsetDays = Math.round(app.settings.clockOffsetMs / DAY_MS);

  function travel(days: number) {
    dispatch(travelDays(app, days));
    setNote(`Clock moved to ${formatDayLong(dayKey(now() + days * DAY_MS))}.`);
  }

  async function loadDemo() {
    setBusy(true);
    setNote(null);
    try {
      const { state, summary } = await seedDemo(ai, app);
      dispatch({ type: 'LOAD_DEMO', payload: state });
      // Reports what the engines actually produced rather than what the fixture
      // intended -- if those two ever disagree, this is where it shows.
      setNote(
        `Replayed ${summary.sessions} sessions: ${summary.totalXp} XP, ` +
          `streak ${summary.streak} (longest ${summary.longest}), ${summary.due} due for review.`,
      );
    } catch (e) {
      setNote(`Could not build demo data: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      eyebrow="Profile"
      title="Settings"
      subtitle="Learning, stakes, appearance, and the tools that only exist for demos."
      actions={
        <Link href={ROUTES.profile}>
          <Press variant="ghost">Back</Press>
        </Link>
      }
    >
      <Card title="Daily goal">
        <Row label="Target" hint="Tuned so the goal takes two sessions, not one.">
          <Segmented
            name="Daily goal"
            value={app.settings.dailyGoalXp}
            options={GOALS.map((g) => ({ value: g.xp, label: `${g.label} · ${g.xp} XP` }))}
            onChange={(xp) => {
              const g = GOALS.find((x) => x.xp === xp);
              set({ dailyGoalXp: xp, dailyTimeMin: g?.minutes ?? app.settings.dailyTimeMin });
            }}
          />
        </Row>
        {/*
          This control DOES SOMETHING now.

          It was live, persisted, migrated and rendered -- and read by nothing
          anywhere in the app. Changing it from 2 to 5 changed a number in
          localStorage and nothing else, because the lesson request had no field
          for it and the backend's JSON schema pinned questions at exactly 2.
          A control that does nothing is the bug this whole project exists to
          remove, and it was shipping one on its own settings screen.

          It now sets `questionCount` on every lesson request, and the size of
          each additional practice batch.
        */}
        <Row label="Questions per lesson">
          <Segmented
            name="Questions per lesson"
            value={app.settings.questionsPerLesson}
            options={[2, 3, 5, 8, 12].map((n) => ({ value: n, label: String(n) }))}
            onChange={(n) => set({ questionsPerLesson: n })}
          />
        </Row>
        {/* Upper bound is 20 server-side, from a measurement rather than a
            taste: a 20-question lesson takes 19.8s to generate, and the next
            step up crosses the client's abort. More than that is what the
            "More practice" button is for -- another batch, not a bigger one. */}
        <Row label="Concepts in a new path">
          <Segmented
            name="Concepts in a new path"
            value={app.settings.pathLength}
            options={[5, 7, 10, 15, 20].map((n) => ({ value: n, label: String(n) }))}
            onChange={(n) => set({ pathLength: n })}
          />
        </Row>
        <Row label="Difficulty">
          <Segmented
            name="Difficulty"
            value={app.settings.level}
            options={[
              { value: 'easy' as const, label: 'Easy' },
              { value: 'medium' as const, label: 'Medium' },
              { value: 'hard' as const, label: 'Hard' },
            ]}
            onChange={(level) => set({ level })}
          />
        </Row>
      </Card>

      <Card title="Stakes">
        <Row
          label="Challenge mode"
          hint="Hearts, refilled every session. No timers, no purchases — a difficulty setting, not an economy."
        >
          <Toggle
            label="Challenge mode"
            checked={app.settings.challengeMode}
            onChange={(challengeMode) => set({ challengeMode })}
          />
        </Row>
        <Row label="Auto-advance on correct" hint="Skip the feedback pause when you got it right.">
          <Toggle
            label="Auto-advance on correct"
            checked={app.settings.autoAdvanceOnCorrect}
            onChange={(autoAdvanceOnCorrect) => set({ autoAdvanceOnCorrect })}
          />
        </Row>
        <Row
          label="Show scheduling internals"
          hint="Interval, ease and repetition count on every concept."
        >
          <Toggle
            label="Show scheduling internals"
            checked={app.settings.showSrsInternals}
            onChange={(showSrsInternals) => set({ showSrsInternals })}
          />
        </Row>
      </Card>

      <Card title="Appearance">
        <Row label="Theme">
          <Segmented
            name="Theme"
            value={theme}
            options={[
              { value: 'light' as const, label: 'Light' },
              { value: 'dark' as const, label: 'Dark' },
              { value: 'system' as const, label: 'System' },
            ]}
            onChange={(v) => {
              setThemeState(v);
              applyTheme(v);
            }}
          />
        </Row>
        <Row label="Motion" hint="Reduced keeps button presses — they are feedback, not decoration.">
          <Segmented
            name="Motion"
            value={motion}
            options={[
              { value: 'full' as const, label: 'Full' },
              { value: 'reduced' as const, label: 'Reduced' },
              { value: 'system' as const, label: 'System' },
            ]}
            onChange={(v) => {
              setMotionState(v);
              applyMotion(v);
            }}
          />
        </Row>
        <Row label="Sound">
          <Toggle
            label="Sound"
            checked={app.settings.sound}
            onChange={(sound) => {
              set({ sound });
              // Mirrored immediately rather than waiting for the next hydrate,
              // and played once on enable -- turning sound on and hearing
              // nothing is indistinguishable from a toggle that does not work,
              // which is what this one was until now.
              setSoundEnabled(sound);
              if (sound) playCue('correct');
            }}
          />
        </Row>
      </Card>

      <Card
        className={s.demo}
        title="Demo tools"
        action={
          <Chip tone="spark" caps>
            Not real features
          </Chip>
        }
      >
        <p className={s.demoNote}>
          These move the app&rsquo;s clock and rewrite your history. They exist so the retention
          model can be demonstrated in seconds instead of over a fortnight.
        </p>

        <Row
          label="Time travel"
          hint={
            offsetDays === 0
              ? 'Mastery decays and reviews come due against this clock.'
              : `Currently ${offsetDays > 0 ? '+' : ''}${offsetDays} days ahead of real time.`
          }
        >
          <div className={s.buttons}>
            <Press size="sm" variant="ghost" onClick={() => travel(1)}>
              +1 day
            </Press>
            <Press size="sm" variant="ghost" onClick={() => travel(3)}>
              +3 days
            </Press>
            <Press size="sm" variant="ghost" onClick={() => travel(7)}>
              +7 days
            </Press>
            <Press
              size="sm"
              variant="ghost"
              disabled={app.settings.clockOffsetMs === 0}
              onClick={() => {
                dispatch(resetClock(app));
                setNote('Clock returned to real time.');
              }}
            >
              Reset clock
            </Press>
          </div>
        </Row>

        <Row label="History" hint="Replays a fortnight of sessions through the real engines.">
          <div className={s.buttons}>
            <Press size="sm" variant="ghost" disabled={busy} onClick={loadDemo}>
              {busy ? 'Building…' : 'Load demo data'}
            </Press>
            <Press
              size="sm"
              variant="danger"
              onClick={() => {
                dispatch(breakStreak(app));
                setNote('Streak broken.');
              }}
            >
              Break my streak
            </Press>
          </div>
        </Row>

        {note && (
          <p className={s.note} role="status">
            {note}
          </p>
        )}
      </Card>

      <Card title="Your data">
        <Row label="Reset progress" hint="Keeps your courses and settings. Clears everything earned.">
          <Press
            size="sm"
            variant="danger"
            onClick={() => {
              dispatch(resetProgress());
              setNote('Progress cleared. Your courses are still here.');
            }}
          >
            Reset progress
          </Press>
        </Row>
        <Row label="Erase everything" hint={`Type ERASE to enable. This cannot be undone.`}>
          <div className={s.buttons}>
            <input
              className={s.input}
              value={eraseText}
              aria-label="Type ERASE to confirm"
              placeholder="ERASE"
              onChange={(e) => setEraseText(e.target.value)}
            />
            <Press
              size="sm"
              variant="danger"
              disabled={eraseText !== 'ERASE'}
              onClick={() => {
                window.location.href = '/?reset=1';
              }}
            >
              Erase
            </Press>
          </div>
        </Row>
      </Card>
    </Screen>
  );
}
