import { useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Lock, Trophy, UploadSimple, DownloadSimple, PencilSimple } from '@phosphor-icons/react';
import { Screen } from './Screen';
import { Card } from '../components/Card/Card';
import { Chip } from '../components/Chip/Chip';
import { Press } from '../components/Press/Press';
import { Ring } from '../components/Ring/Ring';
import { Pica } from '../components/Pica/Pica';
import { ImportData } from '../components/ImportData/ImportData';
import { usePresence } from '../lib/usePresence';
import { useFocusTrap } from '../lib/useFocusTrap';
import { useAppState, useDispatch } from '../state/AppStateContext';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from '../domain/achievements';
import type { Achievement } from '../domain/achievements';
import { effectiveMastery } from '../domain/mastery';
import { levelInfo } from '../domain/xp';
import { describeAgo, formatDayLong, dayKey, formatDuration, now } from '../domain/time';
import { exportState } from '../lib/storage/persist';
import { downloadFile } from '../lib/download';
import { ROUTES } from '../router/routes';
import s from './ProfileScreen.module.css';

/** Six flat ink pairings. Cycled by clicking the avatar -- no picker needed for
 *  six options, and a modal for a decoration would be absurd. */
const AVATARS = ['brand', 'go', 'review', 'streak', 'xp', 'spark'] as const;

function AchievementModal({
  achievement,
  unlockedAt,
  onClose,
}: {
  achievement: Achievement | null;
  unlockedAt: number | null;
  onClose: () => void;
}) {
  const { mounted, state, ref } = usePresence<HTMLDivElement>(achievement != null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // `mounted &&`, not just `achievement != null`.
  //
  // usePresence defers the mount by one state update, so on the render where
  // the dialog is requested the node does not exist yet and ref.current is
  // null -- the trap's effect would run once, find nothing, and never re-run,
  // leaving an untrapped dialog that Escape could not close. Exactly the bug
  // LevelUp had in Phase 6; the hook now warns in dev when it happens.
  useFocusTrap(ref, mounted && achievement != null, { onEscape: onClose, initial: closeRef });

  if (!mounted || !achievement) return null;

  return (
    <div
      ref={ref}
      className={s.scrim}
      data-presence={state}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ach-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.modal}>
        <span className={s.modalBadge} data-tier={achievement.tier} data-locked={!unlockedAt}>
          {unlockedAt ? <Trophy size={34} weight="fill" /> : <Lock size={30} weight="fill" />}
        </span>
        <h2 id="ach-title" className={s.modalTitle}>
          {achievement.name}
        </h2>
        <p className={s.modalDesc}>{achievement.description}</p>
        <div className={s.modalMeta}>
          <Chip tone={unlockedAt ? 'spark' : 'neutral'} caps>
            {achievement.tier}
          </Chip>
          <span>+{achievement.xp} XP</span>
        </div>
        <p className={s.modalWhen}>
          {unlockedAt
            ? `Unlocked ${formatDayLong(dayKey(unlockedAt))}`
            : 'Not yet — the description above is the exact condition.'}
        </p>
        <Press ref={closeRef} block onClick={onClose}>
          Close
        </Press>
      </div>
    </div>
  );
}

export function ProfileScreen() {
  const app = useAppState();
  const dispatch = useDispatch();
  const [, navigate] = useLocation();
  const [showLocked, setShowLocked] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  const level = levelInfo(app.profile.totalXp);
  const unlockedCount = Object.keys(app.achievements).length;
  const visible = showLocked ? ACHIEVEMENTS : ACHIEVEMENTS.filter((a) => app.achievements[a.id]);

  const active = app.courses.filter((c) => c.archivedAt == null);
  const archived = app.courses.filter((c) => c.archivedAt != null);

  function cycleAvatar() {
    dispatch({
      type: 'SET_PROFILE',
      payload: { avatarPreset: (app.profile.avatarPreset + 1) % AVATARS.length },
    });
  }

  function onExport() {
    downloadFile(
      `learnable-export-${dayKey(now())}.json`,
      exportState(app),
      'application/json',
    );
    setNote({ text: 'Exported. That file is everything this app knows about you.' });
  }

  const openAchievement = openId ? (ACHIEVEMENTS_BY_ID[openId] ?? null) : null;

  return (
    <Screen
      eyebrow="You"
      title="Profile"
      subtitle="Level, achievements, courses, and the controls for your own data."
      actions={
        <Link href={ROUTES.settings}>
          <Press variant="ghost">Settings</Press>
        </Link>
      }
    >
      {/* ------------------------------------------------------ identity --- */}
      <Card>
        <div className={s.identity}>
          <button
            type="button"
            className={s.avatar}
            data-ink={AVATARS[app.profile.avatarPreset % AVATARS.length]}
            aria-label="Change your avatar colour"
            onClick={cycleAvatar}
          >
            <Pica size={62} state="idle" />
          </button>

          <div className={s.identityText}>
            {editingName ? (
              <input
                className={s.nameInput}
                autoFocus
                defaultValue={app.profile.displayName}
                aria-label="Your display name"
                maxLength={32}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) dispatch({ type: 'SET_PROFILE', payload: { displayName: v } });
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
            ) : (
              <button
                type="button"
                className={s.name}
                // aria-label rather than a visually-hidden span: a hidden span
                // is CONCATENATED into the accessible name, so the button
                // announced itself as "Chris Edit your name".
                aria-label={`Edit your name, currently ${app.profile.displayName}`}
                onClick={() => setEditingName(true)}
              >
                {app.profile.displayName}
                <PencilSimple size={15} weight="bold" aria-hidden="true" />
              </button>
            )}
            <div className={s.levelTitle}>
              {level.title} · Level {level.level}
            </div>
            <div className={s.identityStats}>
              <span>{app.profile.totalXp.toLocaleString()} XP</span>
              <span>{app.sessions.length} sessions</span>
              <span>{formatDuration(app.profile.totalTimeMs)} studied</span>
              <span>Joined {describeAgo(app.profile.createdAt)}</span>
            </div>
          </div>

          <div className={s.levelRing}>
            <Ring value={level.progress} grow size={96} thickness={10} tone="xp">
              <span className={s.levelNum}>{level.level}</span>
            </Ring>
            <span className={s.levelNext}>
              {level.intoLevel} / {level.forNextLevel} to Level {level.level + 1}
            </span>
          </div>
        </div>
      </Card>

      {/* -------------------------------------------------- achievements --- */}
      <Card
        title="Achievements"
        action={
          <span className={s.achHead}>
            <span className={s.achCount}>
              {unlockedCount} of {ACHIEVEMENTS.length}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showLocked}
              className={s.linkToggle}
              onClick={() => setShowLocked((v) => !v)}
            >
              {showLocked ? 'Hide locked' : 'Show locked'}
            </button>
          </span>
        }
      >
        {visible.length === 0 ? (
          <p className={s.empty}>Nothing unlocked yet. Turn on “Show locked” to see what is there.</p>
        ) : (
          <ul className={s.achGrid}>
            {visible.map((a) => {
              const got = app.achievements[a.id];
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={s.achTile}
                    data-locked={!got || undefined}
                    data-tier={a.tier}
                    onClick={() => setOpenId(a.id)}
                  >
                    <span className={s.achIcon} aria-hidden="true">
                      {got ? <Trophy size={21} weight="fill" /> : <Lock size={17} weight="fill" />}
                    </span>
                    <span className={s.achText}>
                      <span className={s.achName}>{a.name}</span>
                      {/*
                        A locked tile shows its EXACT condition, not "???".
                        Hiding the requirement turns the list into a slot
                        machine; showing it turns it into a set of goals, which
                        is the only reason to have achievements in a learning
                        app at all.
                      */}
                      <span className={s.achDesc}>{a.description}</span>
                    </span>
                    <span className={s.achXp}>+{a.xp}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------------- courses --- */}
      <Card title="Courses">
        {active.length === 0 && archived.length === 0 ? (
          <p className={s.empty}>No courses yet.</p>
        ) : (
          <ul className={s.courseList}>
            {[...active, ...archived].map((c) => {
              const studied = c.concepts.filter((k) => k.attempts > 0).length;
              const avg =
                c.concepts.length === 0
                  ? 0
                  : c.concepts.reduce((sum, k) => sum + effectiveMastery(k), 0) / c.concepts.length;
              const isArchived = c.archivedAt != null;
              return (
                <li key={c.id} className={s.courseRow} data-archived={isArchived || undefined}>
                  <span className={s.courseMain}>
                    <span className={s.courseName}>
                      {c.topic}
                      {c.id === app.activeCourseId && !isArchived && (
                        <Chip tone="brand" caps>
                          Active
                        </Chip>
                      )}
                      {isArchived && <Chip caps>Archived</Chip>}
                    </span>
                    <span className={s.courseMeta}>
                      {studied} of {c.concepts.length} started · {Math.round(avg)}% average
                    </span>
                    <span className={s.courseBar} aria-hidden="true">
                      <span className={s.courseFill} style={{ width: `${Math.round(avg)}%` }} />
                    </span>
                  </span>
                  <span className={s.courseActions}>
                    <Press
                      size="sm"
                      variant={c.id === app.activeCourseId ? 'ghost' : 'brand'}
                      onClick={() => {
                        dispatch({ type: 'SELECT_COURSE', payload: { courseId: c.id } });
                        if (isArchived) {
                          dispatch({ type: 'ARCHIVE_COURSE', payload: { courseId: c.id, at: null } });
                        }
                        navigate(ROUTES.path);
                      }}
                    >
                      {isArchived ? 'Restore' : 'Open'}
                    </Press>
                    {!isArchived && (
                      <Press
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          dispatch({ type: 'ARCHIVE_COURSE', payload: { courseId: c.id, at: now() } })
                        }
                      >
                        Archive
                      </Press>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className={s.courseFoot}>
          <Press variant="ghost" onClick={() => navigate(ROUTES.onboarding)}>
            New course
          </Press>
        </div>
      </Card>

      {/* ---------------------------------------------------------- data --- */}
      <Card title="Your data">
        <p className={s.dataNote}>
          Everything lives in this browser. Nothing has ever been uploaded, which also means
          nothing is backed up — clearing site data clears your progress.
        </p>
        <div className={s.dataRow}>
          <Press variant="ghost" icon={<DownloadSimple size={17} weight="bold" />} onClick={onExport}>
            Export my data
          </Press>
          <ImportData
            icon={<UploadSimple size={17} weight="bold" />}
            onDone={(text, bad) => setNote({ text, bad })}
            onImported={() => navigate(ROUTES.today)}
          />
        </div>
        {note && (
          <p className={s.dataResult} data-bad={note.bad || undefined} role="status">
            {note.text}
          </p>
        )}
        {/*
          The destructive controls live in Settings, and are LINKED rather than
          duplicated. Reset and erase already have their confirmation flow there
          -- including the type-ERASE gate -- and putting a second copy here
          would mean two code paths for the one action in the app that cannot be
          undone.
        */}
        <p className={s.dataNote}>
          Resetting your progress or erasing everything lives in{' '}
          <Link href={ROUTES.settings} className={s.inlineLink}>
            Settings
          </Link>
          , with the confirmation it deserves.
        </p>
      </Card>

      <AchievementModal
        achievement={openAchievement}
        unlockedAt={openId ? (app.achievements[openId]?.unlockedAt ?? null) : null}
        onClose={() => setOpenId(null)}
      />
    </Screen>
  );
}
