import { useState } from 'react';
import { useAppState, useDispatch } from '../../state/AppStateContext';
import { readLatestBackup } from '../../lib/storage/persist';
import { downloadFile } from '../../lib/download';
import { usePresence } from '../../lib/usePresence';
import { wallClock } from '../../domain/time';
import type { Toast } from '../../types/state';
import s from './Toasts.module.css';

/**
 * The missing half of the toast system.
 *
 * The reducer has had PUSH_TOAST and DISMISS_TOAST since Phase 3, and three
 * places pushed to it: quarantined save data, a full quota, and storage being
 * unavailable entirely. Nothing ever rendered the queue, so all three were
 * silently discarded -- a user in Safari Private Browsing lost every session
 * with no indication that anything was wrong, which is precisely the failure
 * the messages were written for.
 *
 * Deliberately NOT auto-dismissing. Every message this app raises is about
 * losing data; a warning that disappears on its own before it is read is the
 * same as no warning.
 */
export function Toasts() {
  const { toasts } = useAppState();
  const dispatch = useDispatch();

  if (toasts.length === 0) return null;

  return (
    <div className={s.stack} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastRow
          key={t.id}
          toast={t}
          onGone={() => dispatch({ type: 'DISMISS_TOAST', payload: { id: t.id } })}
        />
      ))}
    </div>
  );
}

function downloadBackup() {
  const text = readLatestBackup();
  if (!text) return;
  downloadFile(`learnable-backup-${wallClock()}.json`, text, 'application/json');
}

/**
 * Dismissal is LOCAL first, then dispatched.
 *
 * Dispatching straight from the close button removes the toast from the store,
 * React unmounts the node in that same commit, and there is nothing left to
 * animate -- the message vanishes mid-sentence. Holding the decision in local
 * state lets the exit play against a node that still exists, and the store is
 * only told once it has finished. usePresence is what makes "once it has
 * finished" reliable in the cases where the animation never runs at all.
 */
function ToastRow({ toast, onGone }: { toast: Toast; onGone: () => void }) {
  const [open, setOpen] = useState(true);
  const { mounted, state, ref } = usePresence<HTMLDivElement>(open, { onExited: onGone });

  if (!mounted) return null;

  return (
    <div ref={ref} className={s.toast} data-tone={toast.tone} data-presence={state} role="status">
      <span className={s.text}>{toast.text}</span>
      <span className={s.actions}>
        {toast.actionKind === 'downloadBackup' && (
          <button type="button" className={s.action} onClick={downloadBackup}>
            {toast.actionLabel ?? 'Download backup'}
          </button>
        )}
        <button
          type="button"
          className={s.dismiss}
          aria-label="Dismiss notification"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </span>
    </div>
  );
}
