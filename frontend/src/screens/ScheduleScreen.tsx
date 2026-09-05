import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarBlank, DownloadSimple, Copy, ArrowSquareOut, Check } from '@phosphor-icons/react';
import type { DayKey } from '../types/domain';
import { Screen } from './Screen';
import { Card } from '../components/Card/Card';
import { Chip } from '../components/Chip/Chip';
import { Press } from '../components/Press/Press';
import { StreakFlame } from '../components/StreakFlame/StreakFlame';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { selectActiveCourse } from '../state/selectors';
import { buildCalendar } from '../calendar/ics';
import { dueExportCount, planEvent, reviewEvents, weekdayLabels } from '../calendar/plan';
import { GOOGLE_GAP, NEEDS_AN_ACCOUNT, OUTLOOK_GAP, googleUrl, outlookUrl } from '../calendar/links';
import { downloadFile } from '../lib/download';
import { addDays, dayKey, dayKeyToDate, formatDayLong, now } from '../domain/time';
import { effectiveMastery } from '../domain/mastery';
import s from './ScheduleScreen.module.css';

const DURATIONS = [5, 10, 15, 20, 30, 45];
const REMINDERS = [
  { value: 0, label: 'None' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
];
const HORIZONS = [4, 8, 12, 26];

/* ------------------------------------------------------------ heatmap --- */

const HEATMAP_WEEKS = 12;

/**
 * Twelve weeks of real day stats, as a shape.
 *
 * Intensity is bucketed against the user's own goal rather than against a fixed
 * XP number, so "a full day" means the same thing whether the goal is 20 or 80.
 * A fixed scale would make Casual users look permanently pale and Intense users
 * permanently saturated, which inverts what the chart is for.
 */
function Heatmap({ today, weekStartsOn }: { today: DayKey; weekStartsOn: 0 | 1 }) {
  const app = useAppState();
  const goal = Math.max(1, app.settings.dailyGoalXp);

  const columns = useMemo(() => {
    // Walk back to the start of the week containing today, then back 11 weeks.
    const todayDate = dayKeyToDate(today);
    const shift = (todayDate.getDay() - weekStartsOn + 7) % 7;
    const firstDay = addDays(today, -shift - (HEATMAP_WEEKS - 1) * 7);

    return Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const key = addDays(firstDay, w * 7 + d);
        const stat = app.days[key];
        return {
          key,
          future: key > today,
          xp: stat?.xp ?? 0,
          freeze: stat?.freezeUsed ?? false,
          level: !stat || stat.xp === 0 ? 0 : Math.min(4, Math.ceil((stat.xp / goal) * 3)),
        };
      }),
    );
  }, [app.days, goal, today, weekStartsOn]);

  const labels = weekdayLabels(weekStartsOn);

  return (
    <div className={s.heatWrap}>
      <div className={s.heatDays} aria-hidden="true">
        {labels.map((l) => (
          <span key={l.index}>{l.short[0]}</span>
        ))}
      </div>
      <div className={s.heat} role="img" aria-label={`Activity over the last ${HEATMAP_WEEKS} weeks`}>
        {columns.map((week, i) => (
          <div key={i} className={s.heatWeek}>
            {week.map((cell) => (
              <span
                key={cell.key}
                className={s.heatCell}
                data-level={cell.level}
                data-freeze={cell.freeze || undefined}
                data-future={cell.future || undefined}
                title={
                  cell.future
                    ? formatDayLong(cell.key)
                    : cell.freeze
                      ? `${formatDayLong(cell.key)} — streak freeze used`
                      : `${formatDayLong(cell.key)} — ${cell.xp} XP`
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className={s.heatKey}>
        <span className={s.heatKeyLabel}>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={s.heatCell} data-level={l} aria-hidden="true" />
        ))}
        <span className={s.heatKeyLabel}>More</span>
        <span className={s.heatCell} data-freeze="true" aria-hidden="true" />
        <span className={s.heatKeyLabel}>Freeze</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- month --- */

interface DayCell {
  key: DayKey;
  inMonth: boolean;
  isToday: boolean;
  xp: number;
  sessions: number;
  freeze: boolean;
  due: string[];
  planned: boolean;
}

function MonthGrid({
  monthOffset,
  onPick,
  selected,
}: {
  monthOffset: number;
  onPick: (key: DayKey) => void;
  selected: DayKey | null;
}) {
  const app = useAppState();
  const course = selectActiveCourse(app);
  const today = dayKey(now());
  const weekStartsOn = app.settings.weekStartsOn;

  const { cells, label } = useMemo(() => {
    const anchor = dayKeyToDate(today);
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() + monthOffset);
    const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const firstKey = dayKey(anchor.getTime());
    const lead = (anchor.getDay() - weekStartsOn + 7) % 7;
    const gridStart = addDays(firstKey, -lead);
    const month = anchor.getMonth();

    // Due dates for the active course, grouped, so a cell can say what is on it.
    const due = new Map<DayKey, string[]>();
    for (const c of course?.concepts ?? []) {
      const d = c.review.dueOn;
      if (!d) continue;
      due.set(d, [...(due.get(d) ?? []), c.name]);
    }

    const list: DayCell[] = Array.from({ length: 42 }, (_, i) => {
      const key = addDays(gridStart, i);
      const date = dayKeyToDate(key);
      const stat = app.days[key];
      return {
        key,
        inMonth: date.getMonth() === month,
        isToday: key === today,
        xp: stat?.xp ?? 0,
        sessions: stat?.sessions ?? 0,
        freeze: stat?.freezeUsed ?? false,
        due: due.get(key) ?? [],
        // A planned day is one the study plan names, in the future.
        planned: key >= today && app.schedule.weekdays.includes(date.getDay()),
      };
    });

    return { cells: list, label: monthLabel };
  }, [app.days, app.schedule.weekdays, course, monthOffset, today, weekStartsOn]);

  const labels = weekdayLabels(weekStartsOn);

  return (
    <>
      <div className={s.monthLabel}>{label}</div>
      <div className={s.monthHead} aria-hidden="true">
        {labels.map((l) => (
          <span key={l.index}>{l.short}</span>
        ))}
      </div>
      <div className={s.month} role="grid" aria-label={label}>
        {cells.map((cell) => (
          <button
            key={cell.key}
            type="button"
            role="gridcell"
            className={s.day}
            data-dim={!cell.inMonth || undefined}
            data-today={cell.isToday || undefined}
            data-active={cell.key === selected || undefined}
            aria-label={`${formatDayLong(cell.key)}${cell.xp ? `, ${cell.xp} XP` : ''}${
              cell.due.length ? `, ${cell.due.length} due` : ''
            }`}
            onClick={() => onPick(cell.key)}
          >
            <span className={s.dayNum}>{dayKeyToDate(cell.key).getDate()}</span>
            <span className={s.dayMarks} aria-hidden="true">
              {cell.xp > 0 && <span className={s.markXp} />}
              {cell.freeze && <span className={s.markFreeze}>❄</span>}
              {cell.due.length > 0 && <span className={s.markDue}>{cell.due.length}</span>}
              {cell.planned && cell.xp === 0 && !cell.freeze && <span className={s.markPlanned} />}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- export --- */

type ExportKind = 'ics' | 'google' | 'outlook' | 'outlook-work' | 'copy';

function ExportMenu({ onPick }: { onPick: (kind: ExportKind) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Click-away and Escape. A menu that can only be closed by picking something
  // is a trap, and this one has five items that all navigate or download.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: { kind: ExportKind; label: string; note: string; icon: JSX.Element }[] = [
    {
      kind: 'ics',
      label: 'Download .ics',
      note: 'Everything: the repeat, the reminder, and marked as free rather than busy.',
      icon: <DownloadSimple size={17} weight="bold" />,
    },
    {
      kind: 'google',
      label: 'Google Calendar',
      note: GOOGLE_GAP.note,
      icon: <ArrowSquareOut size={17} weight="bold" />,
    },
    {
      kind: 'outlook',
      label: 'Outlook.com',
      note: OUTLOOK_GAP.note,
      icon: <ArrowSquareOut size={17} weight="bold" />,
    },
    {
      kind: 'outlook-work',
      label: 'Outlook (work or school)',
      note: 'Same as above, against outlook.office.com instead of outlook.live.com.',
      icon: <ArrowSquareOut size={17} weight="bold" />,
    },
    {
      kind: 'copy',
      label: 'Copy .ics text',
      note: 'For pasting into a client that imports raw iCalendar.',
      icon: <Copy size={17} weight="bold" />,
    },
  ];

  return (
    <span className={s.menuWrap} ref={wrapRef}>
      <Press
        variant="ghost"
        icon={<CalendarBlank size={18} weight="fill" />}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        Add to calendar
      </Press>
      {open && (
        <span className={s.menu} role="menu">
          {items.map((it) => (
            <button
              key={it.kind}
              type="button"
              role="menuitem"
              className={s.menuItem}
              onClick={() => {
                onPick(it.kind);
                setOpen(false);
              }}
            >
              <span className={s.menuIcon} aria-hidden="true">
                {it.icon}
              </span>
              <span className={s.menuText}>
                <span className={s.menuLabel}>{it.label}</span>
                {/* The limitation is part of the menu item, not a footnote.
                    Someone choosing Outlook needs to know it drops the repeat
                    BEFORE they choose it. */}
                <span className={s.menuNote}>{it.note}</span>
              </span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------- screen --- */

export function ScheduleScreen() {
  const app = useAppState();
  const dispatch = useDispatch();
  const course = selectActiveCourse(app);
  const { schedule } = app;
  const today = dayKey(now());

  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<DayKey | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState(schedule);
  const dirty =
    draft.timeOfDay !== schedule.timeOfDay ||
    draft.durationMin !== schedule.durationMin ||
    draft.reminderMin !== schedule.reminderMin ||
    draft.weeks !== schedule.weeks ||
    draft.weekdays.join() !== schedule.weekdays.join();

  const dueCount = dueExportCount(course?.concepts ?? [], now());

  function savePlan() {
    dispatch({ type: 'SET_SCHEDULE', payload: { ...draft, savedAt: now() } });
    setNote('Plan saved. Export it to a calendar to actually be reminded.');
  }

  /**
   * Recording the export is the ONLY thing this app can truthfully claim.
   *
   * A download and a deep link both hand off to the browser and never report
   * back, so there is no way to know whether the event reached a calendar.
   * `on_the_books` is therefore worded as "export your study plan", which is
   * the event we can actually observe.
   */
  function recordExport() {
    dispatch({ type: 'SET_SCHEDULE', payload: { exportedAt: now() } });
    dispatch({ type: 'UNLOCK_ACHIEVEMENT', payload: { id: 'on_the_books', at: now() } });
  }

  function onExport(kind: ExportKind) {
    const event = planEvent(schedule, course, now());

    if (kind === 'ics') {
      downloadFile('learnable-study-plan.ics', buildCalendar([event]), 'text/calendar');
      recordExport();
      setNote('Downloaded. Open it once and your calendar takes over from there.');
      return;
    }
    if (kind === 'copy') {
      void navigator.clipboard
        ?.writeText(buildCalendar([event]))
        .then(() => setNote('iCalendar text copied to the clipboard.'))
        .catch(() => setNote('Could not reach the clipboard — use Download .ics instead.'));
      recordExport();
      return;
    }

    const url =
      kind === 'google'
        ? googleUrl(event, app.settings.timeZone)
        : outlookUrl(event, kind === 'outlook-work' ? 'work' : 'personal');
    window.open(url, '_blank', 'noopener,noreferrer');
    recordExport();
    setNote('Opened in a new tab. Check the details before you save it there.');
  }

  function exportReviews() {
    const events = reviewEvents(course?.concepts ?? [], schedule, now());
    if (events.length === 0) {
      setNote('Nothing scheduled yet — reviews appear here once you have studied something.');
      return;
    }
    downloadFile('learnable-reviews.ics', buildCalendar(events), 'text/calendar');
    recordExport();
    setNote(`Exported ${events.length} review ${events.length === 1 ? 'date' : 'dates'} as one file.`);
  }

  const selectedStat = selectedDay ? app.days[selectedDay] : undefined;
  const selectedDue = selectedDay
    ? (course?.concepts ?? []).filter((c) => c.review.dueOn === selectedDay)
    : [];

  return (
    <Screen
      eyebrow="Study plan"
      title="Schedule"
      subtitle="Commit to a time, export it to a real calendar, and see the history as a shape."
      actions={<ExportMenu onPick={onExport} />}
    >
      <div className={s.layout}>
        <Card title="Your plan">
          <div className={s.form}>
            <label className={s.field}>
              <span className={s.fieldLabel}>Time</span>
              <input
                type="time"
                className={s.input}
                value={draft.timeOfDay}
                onChange={(e) => setDraft({ ...draft, timeOfDay: e.target.value })}
              />
            </label>

            <label className={s.field}>
              <span className={s.fieldLabel}>Length</span>
              <select
                className={s.input}
                value={draft.durationMin}
                onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) })}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} minutes
                  </option>
                ))}
              </select>
            </label>

            <label className={s.field}>
              <span className={s.fieldLabel}>Remind me</span>
              <select
                className={s.input}
                value={draft.reminderMin}
                onChange={(e) => setDraft({ ...draft, reminderMin: Number(e.target.value) })}
              >
                {REMINDERS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label === 'None' ? 'No reminder' : `${r.label} before`}
                  </option>
                ))}
              </select>
            </label>

            <label className={s.field}>
              <span className={s.fieldLabel}>Keep it up for</span>
              <select
                className={s.input}
                value={draft.weeks}
                onChange={(e) => setDraft({ ...draft, weeks: Number(e.target.value) })}
              >
                {HORIZONS.map((w) => (
                  <option key={w} value={w}>
                    {w} weeks
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={s.pillsWrap}>
            <span className={s.fieldLabel}>Days</span>
            <div className={s.pills} role="group" aria-label="Study days">
              {weekdayLabels(app.settings.weekStartsOn).map((d) => {
                const on = draft.weekdays.includes(d.index);
                // The last remaining day cannot be switched off: a plan with no
                // days is not a plan, and a silently empty weekday set would
                // export as a one-off event with no indication why.
                const last = on && draft.weekdays.length === 1;
                return (
                  <button
                    key={d.index}
                    type="button"
                    className={s.pill}
                    data-on={on}
                    aria-pressed={on}
                    disabled={last}
                    title={last ? 'Pick at least one day' : undefined}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        weekdays: on
                          ? draft.weekdays.filter((x) => x !== d.index)
                          : [...draft.weekdays, d.index].sort((a, b) => a - b),
                      })
                    }
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={s.planFoot}>
            <span className={s.planSummary}>
              {draft.weekdays.length === 7
                ? 'Every day'
                : `${draft.weekdays.length} days a week`}{' '}
              at {draft.timeOfDay} · {draft.durationMin} min ·{' '}
              {draft.reminderMin > 0 ? `${draft.reminderMin} min reminder` : 'no reminder'}
            </span>
            <Press onClick={savePlan} disabled={!dirty}>
              {dirty ? 'Save plan' : schedule.savedAt ? 'Saved' : 'Save plan'}
            </Press>
          </div>

          {/*
            The honest gap, stated where the decision is made.

            Saving a plan here changes nothing about whether anyone gets
            reminded -- this app cannot run while the tab is closed. The export
            is not a nice-to-have next to the plan, it IS the plan's only
            delivery mechanism, and the copy says so rather than letting someone
            find out by missing a week.
          */}
          <p className={s.planNote}>
            Saving keeps the plan here. It cannot notify you — this app does not run when the tab
            is closed. Export it to a calendar and let that do the reminding.
          </p>
        </Card>

        <Card title="Reviews coming up">
          <p className={s.blockNote}>
            Your review dates come from the scheduler, not from this plan, so they move as your
            recall does. Exporting bundles every upcoming date into one file.
          </p>
          <div className={s.reviewRow}>
            <span className={s.reviewCount}>
              <strong>{dueCount}</strong> {dueCount === 1 ? 'date' : 'dates'} scheduled
            </span>
            <Press variant="ghost" disabled={dueCount === 0} onClick={exportReviews}>
              Add all upcoming reviews
            </Press>
          </div>
          {schedule.exportedAt && (
            <p className={s.exported}>
              <Check size={15} weight="bold" /> Last exported {formatDayLong(dayKey(schedule.exportedAt))}
            </p>
          )}
        </Card>
      </div>

      {note && (
        <div className={s.note} role="status">
          {note}
        </div>
      )}

      <Card
        title="Calendar"
        action={
          <span className={s.monthNav}>
            <button
              type="button"
              className={s.navBtn}
              aria-label="Previous month"
              onClick={() => setMonthOffset((m) => m - 1)}
            >
              ‹
            </button>
            <button type="button" className={s.navToday} onClick={() => setMonthOffset(0)}>
              Today
            </button>
            <button
              type="button"
              className={s.navBtn}
              aria-label="Next month"
              onClick={() => setMonthOffset((m) => m + 1)}
            >
              ›
            </button>
          </span>
        }
      >
        <MonthGrid monthOffset={monthOffset} onPick={setSelectedDay} selected={selectedDay} />

        {selectedDay && (
          <div className={s.dayDetail}>
            <div className={s.dayDetailHead}>
              <strong>{formatDayLong(selectedDay)}</strong>
              <button
                type="button"
                className={s.navBtn}
                aria-label="Close day details"
                onClick={() => setSelectedDay(null)}
              >
                ✕
              </button>
            </div>
            {selectedStat ? (
              <p className={s.dayStat}>
                {selectedStat.xp} XP · {selectedStat.sessions}{' '}
                {selectedStat.sessions === 1 ? 'session' : 'sessions'}
                {selectedStat.goalMet ? ' · goal met' : ''}
                {selectedStat.freezeUsed ? ' · streak freeze used' : ''}
              </p>
            ) : (
              <p className={s.dayStat}>
                {selectedDay > today
                  ? app.schedule.weekdays.includes(dayKeyToDate(selectedDay).getDay())
                    ? `Planned: ${schedule.timeOfDay}, ${schedule.durationMin} min.`
                    : 'No session planned.'
                  : 'Nothing recorded.'}
              </p>
            )}
            {selectedDue.length > 0 && (
              <div className={s.dayDue}>
                {selectedDue.map((c) => (
                  <Chip key={c.id} tone="review">
                    {c.name} · {Math.round(effectiveMastery(c))}%
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        title="The last 12 weeks"
        action={
          <span className={s.streakChip}>
            <StreakFlame size={18} cold={app.streak.current === 0} />
            {app.streak.current} day{app.streak.current === 1 ? '' : 's'} · longest{' '}
            {app.streak.longest}
          </span>
        }
      >
        <Heatmap today={today} weekStartsOn={app.settings.weekStartsOn} />
        {app.streak.freezes > 0 && (
          <p className={s.blockNote}>
            You have {app.streak.freezes} streak {app.streak.freezes === 1 ? 'freeze' : 'freezes'} in
            hand. They are spent automatically, backwards, the next time you return.
          </p>
        )}
      </Card>

      {/*
        Listed rather than hidden.
        An empty space where notifications should be tells the user nothing. A
        named list with the actual reason tells them what the shape of the
        product is and what a backend would buy.
      */}
      <Card title="Coming with accounts">
        <ul className={s.laterList}>
          {NEEDS_AN_ACCOUNT.map((item) => (
            <li key={item.title} className={s.laterItem}>
              <span className={s.laterTitle}>{item.title}</span>
              <span className={s.laterWhy}>{item.why}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  );
}
