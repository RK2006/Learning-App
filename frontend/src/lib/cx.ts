/**
 * Join class names, dropping anything falsy.
 *
 * Replaces `clsx` -- CSS Modules make conditional class names noisy, and this is
 * the whole of what we need from that dependency.
 *
 *   cx(s.press, isActive && s.active, size === 'sm' && s.sm)
 */
export type ClassValue = string | number | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  let out = '';
  for (const v of values) {
    if (!v) continue;
    out = out ? `${out} ${v}` : String(v);
  }
  return out;
}
