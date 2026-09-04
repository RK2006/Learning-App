import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Press } from '../Press/Press';
import type { PressVariant } from '../Press/Press';
import { useDispatch } from '../../state/AppStateContext';
import { parseImport } from '../../lib/storage/persist';

export interface ImportDataProps {
  variant?: PressVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  /** Called with a human-readable outcome. `bad` distinguishes failure. */
  onDone?: (message: string, bad: boolean) => void;
  /** Where to go after a successful import. */
  onImported?: () => void;
}

/**
 * Restoring a backup, from anywhere it is needed.
 *
 * This is a shared component rather than a copy in each screen because of where
 * the second copy has to live: ONBOARDING.
 *
 * The router sends anyone with `onboarded === false` straight to the first-run
 * flow and will not let them out. That is right for a new user and exactly
 * wrong for a returning one -- clear your site data, or open the app in a fresh
 * browser, and the Profile screen holding the Import button is unreachable. The
 * export feature was therefore a one-way door: the file downloaded, and there
 * was no state the app could be in where it would accept it back.
 *
 * A backup you cannot restore is not a backup.
 */
export function ImportData({
  variant = 'ghost',
  size = 'md',
  block,
  icon,
  children = 'Import data',
  onDone,
  onImported,
}: ImportDataProps) {
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLInputElement>(null);

  function handle(file: File) {
    void file.text().then((text) => {
      const result = parseImport(text);
      if (result.kind === 'error') {
        onDone?.(result.reason, true);
        return;
      }

      const { courses, sessions } = result.data;
      /**
       * Import REPLACES, and says so first.
       *
       * There is no sane merge for this data. Two exports carry the same
       * concept ids with different mastery, different review schedules and
       * overlapping day stats; picking a winner per field would synthesise a
       * history that never happened. Replacement is the honest operation, and
       * the confirmation is what makes it safe.
       */
      const ok = window.confirm(
        'Replace everything currently in this browser with the contents of that file?\n\n' +
          `It contains ${courses.length} course${courses.length === 1 ? '' : 's'} and ` +
          `${sessions.length} session${sessions.length === 1 ? '' : 's'}.\n\n` +
          'Anything already here will be gone.',
      );
      if (!ok) return;

      dispatch({ type: 'HYDRATE', payload: result.data });
      onDone?.(
        `Imported ${courses.length} course${courses.length === 1 ? '' : 's'} and ${sessions.length} sessions.`,
        false,
      );
      onImported?.();
    });
  }

  return (
    <>
      <Press variant={variant} size={size} block={block} icon={icon} onClick={() => inputRef.current?.click()}>
        {children}
      </Press>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="u-visually-hidden"
        aria-label="Choose a Learnable export to import"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so that picking the SAME file twice still fires a change
          // event -- otherwise a failed import cannot be retried with a fix.
          e.target.value = '';
          if (file) handle(file);
        }}
      />
    </>
  );
}
