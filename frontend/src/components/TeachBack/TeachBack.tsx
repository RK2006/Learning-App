import { useRef, useState } from 'react';
import { Press } from '../Press/Press';
import { Chip } from '../Chip/Chip';
import { ai } from '../../lib/ai';
import { describeAiError } from '../../lib/ai/errorCopy';
import type { TeachBackAnalysis } from '../../lib/ai/contracts';
import s from './TeachBack.module.css';

/**
 * `analyzeTeachBack` finally has a caller.
 *
 * The last of the four contracted tasks that had neither a route nor a screen.
 * Shipping the endpoint without this would have been the pattern the project
 * keeps having to undo: a capability that exists, is paid for, and can never be
 * reached from the product.
 *
 * WHY IT SITS AFTER THE RESULTS AND NOT INSIDE THE SESSION. Teaching something
 * back is the strongest retrieval practice available, and it is also the
 * slowest and most effortful thing you can ask of someone. Putting it in the
 * required path would make every lesson longer for the learners least likely to
 * want it. Putting it after the score, as an offer, means the people who take
 * it are the ones it will work for.
 *
 * NOTHING HERE AFFECTS THE GRADE. The session is already committed by the time
 * this renders: no XP, no mastery change, no SRS update comes out of it. That
 * is stated in the UI rather than left to be discovered, because an input that
 * silently did affect scoring would make the score depend on whether you
 * noticed an optional box.
 */
export function TeachBack({ topic, conceptName }: { topic: string; conceptName: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<TeachBackAnalysis | null>(null);
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function submit() {
    if (!text.trim() || state === 'pending') return;
    setState('pending');
    setError(null);
    const ctrl = new AbortController();
    abort.current?.abort();
    abort.current = ctrl;
    try {
      const out = await ai.analyzeTeachBack(
        { topic, conceptName, explanation: text.trim() },
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      setResult(out);
      setState('idle');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState('failed');
      setError(describeAiError(e).title);
    }
  }

  if (!open) {
    return (
      <div className={s.invite}>
        <Press variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Explain it back in your own words
        </Press>
        <span className={s.note}>Optional — nothing here changes your score.</span>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <label className={s.label} htmlFor="teachback">
        Explain {conceptName} as if to someone who has never heard of it.
      </label>
      <textarea
        id="teachback"
        className={s.box}
        value={text}
        disabled={state === 'pending'}
        placeholder="In your own words…"
        onChange={(e) => setText(e.target.value)}
      />

      {result ? (
        <div className={s.result}>
          <div className={s.coverage}>
            {/* A coverage number is not a grade and does not read as one here:
                no pass mark, no colour change at a threshold, and it is never
                written back to mastery. */}
            <Chip tone={result.coverage >= 70 ? 'go' : 'neutral'}>{result.coverage}% covered</Chip>
          </div>
          {result.understood.length > 0 && (
            <div className={s.group}>
              <span className={s.groupLabel}>You have this</span>
              <ul>
                {result.understood.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {result.incorrect.length > 0 && (
            <div className={s.group} data-tone="stop">
              <span className={s.groupLabel}>Not right</span>
              <ul>
                {result.incorrect.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {result.missing.length > 0 && (
            <div className={s.group}>
              <span className={s.groupLabel}>Not mentioned</span>
              <ul>
                {result.missing.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {result.followUpQuestion && (
            <p className={s.followUp}>
              <strong>Try this:</strong> {result.followUpQuestion}
            </p>
          )}
        </div>
      ) : (
        <div className={s.actions}>
          <Press size="sm" disabled={!text.trim() || state === 'pending'} onClick={submit}>
            {state === 'pending' ? 'Reading…' : 'Check my explanation'}
          </Press>
          <Press size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Not now
          </Press>
        </div>
      )}

      {state === 'failed' && error && (
        <p className={s.error} role="status">
          {error}. Nothing was lost — your session is already saved.
        </p>
      )}
    </div>
  );
}
