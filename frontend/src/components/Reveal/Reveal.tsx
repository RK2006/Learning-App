import type { CSSProperties } from 'react';
import { cx } from '../../lib/cx';
import s from './Reveal.module.css';

export interface RevealProps {
  text: string;
  /** Words per group. Larger reads calmer; 1 reads as a teleprompter. */
  group?: number;
  className?: string;
}

/**
 * How many groups may stagger before the rest arrive together.
 *
 * The delay per step is the --stagger token, so the cap is expressed as an
 * index rather than a duration -- which keeps the one place that knows how long
 * a stagger step lasts in tokens.css, where reduced motion can collapse it.
 */
const MAX_STEPS = 12;

/**
 * Reveals prose in word groups that are ALREADY IN THE DOM.
 *
 * The tempting version of this effect appends characters to the DOM on a timer.
 * Do not: text that has not been typed yet does not exist for a screen reader,
 * for find-in-page, for text selection, or for anyone who wants to skim ahead
 * of the animation. It also makes reading speed a function of an animation
 * constant, which is a strange thing to impose on a learning app.
 *
 * So the whole sentence is rendered immediately and its groups fade in. If the
 * animation never runs -- reduced motion, an old engine, styles still loading --
 * what is on screen is the finished paragraph, which is the correct fallback.
 *
 * Groups rather than single words: staggering every word turns a paragraph into
 * a ripple, and the eye starts tracking the motion instead of reading. Three
 * words is roughly one fixation.
 *
 * The delay is CAPPED. Without it the stagger is a function of length, so a
 * long explanation would still be arriving a full second after a short one had
 * finished -- the effect would read as the app being slower on exactly the
 * lessons that already asked the most of the reader.
 */
export function Reveal({ text, group = 3, className }: RevealProps) {
  const words = text.split(/\s+/).filter(Boolean);
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += group) {
    groups.push(words.slice(i, i + group).join(' '));
  }

  return (
    <span className={cx(s.reveal, className)}>
      {groups.map((chunk, i) => (
        <span
          // Index-keyed on purpose: this list is a rendering of one immutable
          // string, so a group's position IS its identity.
          key={i}
          className={s.group}
          style={{ '--i': Math.min(i, MAX_STEPS) } as CSSProperties}
        >
          {/* The trailing space lives inside the span so copying the paragraph
              produces the paragraph, not one run-on word. */}
          {chunk}
          {i < groups.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}
