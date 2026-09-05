import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Press } from '../Press/Press';
import s from './ErrorBoundary.module.css';

/**
 * The app had none of these. Anywhere.
 *
 * That was survivable only for as long as the backend could never say anything
 * the client had not anticipated. The moment the server gained error kinds of
 * its own, one unrecognised string reaching an unguarded `COPY[kind]` would
 * have rendered `undefined.title` and taken the whole tree down to a white
 * screen -- on the session error path, which is by definition already the
 * moment something has gone wrong.
 *
 * `errorCopy.ts` is the real fix for that specific bug and it shipped first.
 * This is the floor underneath it: whatever else throws during a render, the
 * learner gets a page that says so and a way out, instead of a blank document.
 *
 * Deliberately a class. Error boundaries have no hook equivalent -- there is no
 * `useErrorBoundary` -- so this is one of the two places React still requires
 * `componentDidCatch`, and a library to wrap it would earn nothing.
 */

interface Props {
  children: ReactNode;
  /** Shown instead of the default page. Used by the session takeover, which
   *  owns the viewport and needs its own escape route. */
  fallback?: (e: Error, reset: () => void) => ReactNode;
  /** Changing this resets the boundary. Route identity, usually: a crash on one
   *  screen must not hold every later navigation hostage. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // Without this, the first crash is permanent for the session: the boundary
    // holds its error state, so navigating away re-renders the same fallback on
    // a route that was never broken.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry endpoint exists, and inventing one that silently posts a
    // learner's screen contents somewhere would be its own violation. The
    // console is the honest destination.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className={s.wrap} role="alert">
        <div className={s.inner}>
          <h1 className={s.title}>This screen stopped working</h1>
          {/*
            Says what is actually true and nothing more. It does NOT say
            "we have been notified" -- nobody has been notified, there is no
            reporting anywhere in this app, and a reassurance nobody is acting
            on is exactly the class of comfortable lie this project exists to
            delete.
          */}
          <p className={s.body}>
            Something in the page threw an error the app did not expect, so it stopped rendering
            rather than show you something wrong. Your progress is stored on this device and was
            not affected — nothing has been lost.
          </p>
          <p className={s.detail}>{error.message || String(error)}</p>
          <div className={s.actions}>
            <Press onClick={this.reset}>Try this screen again</Press>
            <Press variant="ghost" onClick={() => { window.location.href = '/today'; }}>
              Go to Today
            </Press>
          </div>
        </div>
      </div>
    );
  }
}
