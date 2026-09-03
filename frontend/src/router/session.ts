import type { SessionMode } from '../types/domain';

/**
 * Multi-concept sessions live in the URL, not in the store.
 *
 * A review session over three concepts is three lesson runs in a row. Holding
 * that in state would mean a refresh mid-queue either loses your place or
 * resurrects a queue you already abandoned; putting it in the query string
 * makes the whole run deep-linkable and resumable for free, and abandoning it
 * is exactly as free as abandoning a single lesson -- which is what lets the
 * mastery stake mean something.
 *
 *   /session/c2?mode=review&queue=c5,c7
 *                            ^ still to come, in order
 */
export interface SessionTarget {
  conceptId: string;
  mode: SessionMode;
  queue: string[];
}

export function sessionHref(conceptId: string, mode: SessionMode, queue: string[] = []): string {
  const params = new URLSearchParams({ mode });
  if (queue.length > 0) params.set('queue', queue.join(','));
  return `/session/${conceptId}?${params.toString()}`;
}

/** Start a run over an ordered list of concepts. The head is the session; the
 *  tail rides along. */
export function reviewHref(conceptIds: string[], mode: SessionMode = 'review'): string {
  const [first, ...rest] = conceptIds;
  if (!first) return '/review';
  return sessionHref(first, mode, rest);
}

export function parseQueue(search: string): string[] {
  const raw = new URLSearchParams(search).get('queue');
  if (!raw) return [];
  return raw.split(',').filter(Boolean);
}

export function parseMode(search: string): SessionMode {
  const m = new URLSearchParams(search).get('mode');
  return m === 'review' || m === 'practice' || m === 'unitReview' ? m : 'lesson';
}
