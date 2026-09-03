import { useEffect, useRef } from 'react';
import { Ring } from '../Ring/Ring';
import { Press } from '../Press/Press';
import { Pica } from '../Pica/Pica';
import { usePresence } from '../../lib/usePresence';
import { useFocusTrap } from '../../lib/useFocusTrap';
import { celebrate, stopCelebrating } from '../../lib/celebrate';
import { playCue } from '../../lib/sound';
import s from './LevelUp.module.css';

export interface LevelUpProps {
  open: boolean;
  level: number;
  title: string;
  /** Total XP needed to reach this level -- shown so the number means something. */
  atXp: number;
  onClose: () => void;
}

/**
 * The level-up takeover.
 *
 * Deliberately modal and deliberately dismissed by hand. Everything else this
 * app shows after a session is information the user can skim past; this is the
 * one moment that is purely a reward, and a reward that fades out on a timer
 * while someone is still reading their feedback has been thrown away.
 *
 * It is also the only screen in the build where an overshoot easing is allowed
 * on the container itself rather than on a detail, because here the container
 * IS the payoff.
 */
export function LevelUp({ open, level, title, atXp, onClose }: LevelUpProps) {
  const { mounted, state, ref } = usePresence<HTMLDivElement>(open, { exitToken: '--d-3' });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Focus in, focus contained, focus restored, Escape out. Replaces the
  // hand-rolled focus + keydown pair this used to carry, which handled two of
  // those four and let Tab walk straight out to the results screen behind.
  useFocusTrap(ref, open && mounted, { onEscape: onClose, initial: buttonRef });

  useEffect(() => {
    if (!open) return;
    celebrate('levelUp');
    playCue('levelUp');
    return () => stopCelebrating();
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      ref={ref}
      className={s.scrim}
      data-presence={state}
      role="dialog"
      aria-modal="true"
      aria-labelledby="levelup-title"
    >
      <div className={s.card}>
        <div className={s.ringWrap}>
          {/*
            A full ring, grown from empty. The number inside is the level just
            reached, not a percentage -- the ring here is a seal, not a gauge.
          */}
          <Ring value={1} grow size={132} thickness={12} tone="xp">
            <span className={s.level}>{level}</span>
          </Ring>
          <Pica state="cheer" size={78} className={s.pica} replay={level} />
        </div>

        <h2 id="levelup-title" className={s.heading}>
          Level {level}
        </h2>
        <p className={s.title}>{title}</p>
        <p className={s.sub}>{atXp.toLocaleString()} XP total</p>

        <Press ref={buttonRef} size="lg" block onClick={onClose}>
          Nice
        </Press>
      </div>
    </div>
  );
}
