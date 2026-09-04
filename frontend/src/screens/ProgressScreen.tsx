import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Screen } from './Screen';
import { Press } from '../components/Press/Press';
import { Card } from '../components/Card/Card';
import { Chip } from '../components/Chip/Chip';
import { Pica } from '../components/Pica/Pica';
import { useAppState } from '../state/AppStateContext';
import {
  selectActiveCourse,
  selectForecastLine,
  selectLevel,
  selectRecordConcept,
  selectToday,
} from '../state/selectors';
import { effectiveMastery, hasAttempted } from '../domain/mastery';
import { addDays, describeAgo, formatDayShort, formatDuration } from '../domain/time';
import type { DayKey } from '../types/domain';
import type { LoggedMisconception } from '../types/domain';
import { ROUTES } from '../router/routes';
import { sessionHref } from '../router/session';
import { downloadFile } from '../lib/download';
import s from './ProgressScreen.module.css';

const XP_DAYS = 14;
const ACCURACY_SESSIONS = 12;

/**
 * Hand-rolled charts, on purpose.
 *
 * These are three bar charts and a sparkline over at most twenty points. A
 * charting library would cost more gzip than the entire rest of this screen
 * and would bring its own visual language, which is the exact thing this build
 * is trying not to look like. Everything below is plain SVG or flex boxes with
 * a width percentage.
 */

function XpChart({
  days,
  goal,
}: {
  days: { key: DayKey; xp: number; goalMet: boolean }[];
  goal: number;
}) {
  // Scale to the tallest bar OR the goal, whichever is higher, so the goal line
  // is always on the chart. Scaling to the data alone would put the goal line
  // off the top on a quiet fortnight and silently drop the comparison.
  const max = Math.max(goal, ...days.map((d) => d.xp), 1);
  const goalPct = (goal / max) * 100;

  return (
    <div className={s.chart}>
      <div className={s.bars} role="img" aria-label={`XP per day over the last ${days.length} days`}>
        <span className={s.goalLine} style={{ bottom: `${goalPct}%` }} aria-hidden="true">
          <span className={s.goalLabel}>goal {goal}</span>
        </span>
        {days.map((d) => (
          <span key={d.key} className={s.barCol} title={`${formatDayShort(d.key)} · ${d.xp} XP`}>
            <span
              className={s.bar}
              data-met={d.goalMet}
              data-zero={d.xp === 0}
              style={{ height: `${(d.xp / max) * 100}%` }}
            />
            {/* Day-of-month straight off the DayKey. Splitting a localized
                "Sep 12" on whitespace picks the wrong half in every locale that
                writes the day first. */}
            <span className={s.barTick}>{Number(d.key.slice(-2))}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 280;
  const H = 60;
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / 100) * H).toFixed(1)}`);

  return (
    <svg
      className={s.spark}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Accuracy across the last ${values.length} sessions, most recent last`}
    >
      {/* 70% is the line between "keep going" and "we'll bring this back", so
          it is the only reference worth drawing. */}
      <line className={s.sparkRef} x1="0" y1={H - 0.7 * H} x2={W} y2={H - 0.7 * H} />
      <polyline className={s.sparkLine} points={pts.join(' ')} />
      {values.map((v, i) => (
        <circle
          key={i}
          className={s.sparkDot}
          data-low={v < 70}
          cx={i * step}
          cy={H - (v / 100) * H}
          r={3}
        />
      ))}
    </svg>
  );
}

export function ProgressScreen() {
  const app = useAppState();
  const [, navigate] = useLocation();
  const course = selectActiveCourse(app);
  const today = selectToday(app);
  const level = selectLevel(app);
  const forecastLine = selectForecastLine(app, 21);

  const days = useMemo(() => {
    const out: { key: DayKey; xp: number; goalMet: boolean }[] = [];
    for (let i = XP_DAYS - 1; i >= 0; i--) {
      const key = addDays(today, -i);
      const d = app.days[key];
      out.push({ key, xp: d?.xp ?? 0, goalMet: Boolean(d?.goalMet) });
    }
    return out;
  }, [app.days, today]);

  const recent = app.sessions.slice(-ACCURACY_SESSIONS);
  const accuracy = recent.map((r) => r.score);

  /** Misconceptions across every concept, newest first, resolved last. */
  const misconceptions = useMemo(() => {
    const rows: { m: LoggedMisconception; conceptId: string; conceptName: string }[] = [];
    for (const c of course?.concepts ?? []) {
      for (const m of c.misconceptions) rows.push({ m, conceptId: c.id, conceptName: c.name });
    }
    return rows.sort((a, b) => {
      const ar = a.m.resolvedAt == null ? 0 : 1;
      const br = b.m.resolvedAt == null ? 0 : 1;
      return ar !== br ? ar - br : b.m.lastSeen - a.m.lastSeen;
    });
  }, [course]);

  const studied = (course?.concepts ?? []).filter(hasAttempted);
  const totalMinutes = Math.round(app.profile.totalTimeMs / 60000);

  function exportCsv() {
    const header = 'finished_at,concept,mode,score,correct,total,xp,duration_ms';
    const lines = app.sessions.map((r) => {
      const name = selectRecordConcept(app, r)?.name ?? 'Concept';
      // Quote and escape: concept names come from a model and will contain commas.
      const safe = `"${name.replace(/"/g, '""')}"`;
      return [
        r.finishedAt ? new Date(r.finishedAt).toISOString() : '',
        safe,
        r.mode,
        r.score,
        r.correct,
        r.total,
        r.xpAwarded,
        r.durationMs,
      ].join(',');
    });
    // CRLF: spreadsheet apps are far happier with it, and it matches the .ics
    // writer landing in the calendar phase.
    downloadFile(`learnable-sessions-${today}.csv`, [header, ...lines].join('\r\n'), 'text/csv');
  }

  if (!course || app.sessions.length === 0) {
    return (
      <Screen eyebrow="Evidence" title="Progress" subtitle="Trends, retention, and what tripped you up.">
        <Card className={s.empty}>
          <Pica size={110} state="idle" />
          <h3 className={s.emptyTitle}>Nothing to show yet</h3>
          <p className={s.emptyNote}>
            Finish a session and this fills in: mastery per concept, XP against your goal, accuracy
            over time, and every misconception the grader logged.
          </p>
          <Press onClick={() => navigate(ROUTES.today)}>Back to Today</Press>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="Evidence"
      title="Progress"
      subtitle={`${app.sessions.length} sessions · ${formatDuration(app.profile.totalTimeMs)} studied · Level ${level.level} ${level.title}`}
      actions={
        <Press variant="ghost" onClick={exportCsv}>
          Export CSV
        </Press>
      }
    >
      <div className={s.summary}>
        <Card tight className={s.stat}>
          <span className={s.statValue}>{app.profile.totalXp.toLocaleString()}</span>
          <span className={s.statLabel}>total XP</span>
        </Card>
        <Card tight className={s.stat}>
          <span className={s.statValue}>{app.streak.longest}</span>
          <span className={s.statLabel}>longest streak</span>
        </Card>
        <Card tight className={s.stat}>
          <span className={s.statValue}>
            {accuracy.length ? Math.round(accuracy.reduce((a, b) => a + b, 0) / accuracy.length) : 0}%
          </span>
          <span className={s.statLabel}>recent accuracy</span>
        </Card>
        <Card tight className={s.stat}>
          <span className={s.statValue}>{totalMinutes}</span>
          <span className={s.statLabel}>minutes studied</span>
        </Card>
      </div>

      <Card title={`XP over ${XP_DAYS} days`}>
        <XpChart days={days} goal={app.settings.dailyGoalXp} />
      </Card>

      <div className={s.cols}>
        <Card title="Mastery by concept">
          {/* Stored and effective drawn on the SAME track, so the decay is a
              visible gap rather than two numbers the reader has to subtract. */}
          <p className={s.legend}>
            <span className={s.swatchStored} aria-hidden="true" /> stored
            <span className={s.swatchNow} aria-hidden="true" /> after decay
          </p>
          {studied.length === 0 ? (
            <p className={s.muted}>Nothing studied yet.</p>
          ) : (
            <ul className={s.masteryList}>
              {studied.map((c) => {
                const eff = effectiveMastery(c);
                const gap = Math.round(c.mastery - eff);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={s.masteryRow}
                      onClick={() => navigate(`${ROUTES.path}?concept=${c.id}`)}
                    >
                      <span className={s.mName}>{c.name}</span>
                      <span className={s.mTrack} aria-hidden="true">
                        <span className={s.mStored} style={{ width: `${Math.round(c.mastery)}%` }} />
                        <span className={s.mNow} style={{ width: `${Math.round(eff)}%` }} />
                      </span>
                      <span className={s.mNums}>
                        {Math.round(eff)}%{gap >= 2 && <span className={s.mGap}>▼{gap}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {forecastLine && <p className={s.forecast}>{forecastLine}</p>}
        </Card>

        <Card title={`Accuracy · last ${recent.length} sessions`}>
          {accuracy.length < 2 ? (
            <p className={s.muted}>Two sessions needed before a trend means anything.</p>
          ) : (
            <>
              <Sparkline values={accuracy} />
              <p className={s.chartNote}>
                The line at 70% is where the app stops advancing you and schedules a return visit.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card title="Misconception log">
        {misconceptions.length === 0 ? (
          <p className={s.muted}>Nothing logged. Misconceptions appear here when a wrong answer reveals one.</p>
        ) : (
          <ul className={s.miscList}>
            {misconceptions.map(({ m, conceptId, conceptName }) => (
              <li key={`${conceptId}:${m.text}`} data-resolved={m.resolvedAt != null}>
                <span className={s.miscText}>{m.text}</span>
                <span className={s.miscMeta}>
                  <Chip tone={m.resolvedAt ? 'go' : 'review'}>
                    {m.resolvedAt ? 'Resolved' : `Seen ${m.count}×`}
                  </Chip>
                  <button
                    type="button"
                    className={s.miscLink}
                    onClick={() => navigate(`${ROUTES.path}?concept=${conceptId}`)}
                  >
                    {conceptName}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Session history" flush>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Concept</th>
                <th scope="col">Mode</th>
                <th scope="col" className={s.num}>
                  Score
                </th>
                <th scope="col" className={s.num}>
                  Mastery
                </th>
                <th scope="col" className={s.num}>
                  XP
                </th>
                <th scope="col" className={s.num}>
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {[...app.sessions]
                .reverse()
                .slice(0, 25)
                .map((r) => {
                  const id = r.conceptIds[0] ?? '';
                  const name = selectRecordConcept(app, r)?.name ?? 'Concept';
                  const before = Math.round(r.masteryBefore[id] ?? 0);
                  const after = Math.round(r.masteryAfter[id] ?? 0);
                  return (
                    <tr key={r.id}>
                      <td>{describeAgo(r.finishedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className={s.miscLink}
                          onClick={() => navigate(sessionHref(id, 'practice'))}
                        >
                          {name}
                        </button>
                      </td>
                      <td>{r.mode}</td>
                      <td className={s.num} data-low={r.score < 70}>
                        {r.score}%
                      </td>
                      <td className={s.num}>
                        {before} → {after}
                      </td>
                      <td className={s.num}>
                        +{r.xpAwarded}
                        {r.achievementXp > 0 && <span className={s.bonus}>+{r.achievementXp}</span>}
                      </td>
                      <td className={s.num}>{formatDuration(r.durationMs)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>
    </Screen>
  );
}
