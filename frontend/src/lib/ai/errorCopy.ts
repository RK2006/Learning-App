import { AiError } from './contracts';
import type { KnownAiErrorKind } from './contracts';

export interface ErrorCopy {
  title: string;
  body: string;
  /** False when trying again cannot possibly help. */
  retryable: boolean;
}

/**
 * Turning a thrown value into something worth reading.
 *
 * `AiError` has carried a `kind` since Phase 2 and nothing has ever read it --
 * every error path in the app printed `error.message` and hoped. That produced
 * two bad outcomes at once: a network blip showed a stack-ish string with no
 * suggestion to retry, and `unconfigured` (a feature whose endpoint does not
 * exist) showed a "something went wrong" that invited the user to try again
 * forever.
 *
 * The distinction that actually matters to a person is not what went wrong, it
 * is WHETHER TRYING AGAIN COULD HELP -- so that is what `retryable` encodes,
 * and it is what decides whether a Retry button is rendered at all. A retry
 * button on an unimplemented endpoint is a lie with a click target.
 */
const COPY: Record<KnownAiErrorKind, ErrorCopy> = {
  network: {
    title: 'Could not reach the server',
    body: 'The request never arrived. Check your connection — nothing was lost, and your progress is saved locally either way.',
    retryable: true,
  },
  timeout: {
    title: 'That took too long',
    body: 'The model was still thinking when the request gave up. Longer explanations sometimes need a second attempt.',
    retryable: true,
  },
  http: {
    title: 'The server said no',
    body: 'It answered, but with an error rather than a lesson. If this keeps happening the backend log will say why.',
    retryable: true,
  },
  malformed: {
    title: 'The answer came back unreadable',
    body: 'The server responded with something this app could not parse. That is usually a one-off — the same request often works second time.',
    retryable: true,
  },
  aborted: {
    // Surfaced only if something forgets to check signal.aborted first.
    title: 'Cancelled',
    body: 'That request was replaced by a newer one.',
    retryable: false,
  },
  unconfigured: {
    title: 'Not built yet',
    body: 'This part of the app is waiting on a backend endpoint that does not exist. Nothing is broken — the feature simply has nowhere to go.',
    retryable: false,
  },

  /* ---- kinds the backend started emitting once it had a rate limiter and a
     real upstream. Each one exists because the server can actually produce it;
     copy for a state nothing emits would be its own small lie. ---- */

  rate_limited: {
    title: 'Too many requests just now',
    body: 'Generation is capped so one busy session cannot starve everyone else. Give it a minute and the next one will go through — nothing you have done is lost.',
    // True, but not immediately. The session screen has no backoff timer, so
    // the honest thing is to let them retry and let the server say no again,
    // rather than silently disabling the only control on the screen.
    retryable: true,
  },
  model_down: {
    title: 'The model is not answering',
    body: 'The server is fine; the thing it asks for lessons is not. This is usually brief, and nothing was charged for a lesson that never arrived.',
    retryable: true,
  },
  content_refused: {
    title: 'The model would not answer that',
    body: 'It declined to generate material for this request. Asking again word-for-word will get the same refusal — try rephrasing the topic.',
    // Deliberately false. This is exactly the case house rule #1 names: a retry
    // button on something that cannot succeed is a lie with a click target.
    retryable: false,
  },
  invalid: {
    title: 'The server would not accept that',
    body: 'The request was rejected before it reached the model — usually a topic or a count outside what the server allows. Retrying sends the identical request, so change something first.',
    retryable: false,
  },
};

/**
 * The fallback for a kind this build has never heard of.
 *
 * `retryable: false` is the deliberate choice, and it is the whole reason this
 * function exists. An unknown kind means a NEWER server is talking to an OLDER
 * client; we know nothing about whether trying again could help, and house rule
 * #1 bans offering a retry on something that cannot be retried. Refusing to
 * guess costs a user one extra navigation. Guessing wrong puts a button on the
 * screen that is guaranteed to do nothing, forever.
 */
const UNKNOWN: ErrorCopy = {
  title: 'The server reported a problem',
  body: 'It answered with an error this version of the app does not recognise, so there is nothing useful it can tell you about trying again. Reloading is safe — your progress is stored on this device.',
  retryable: false,
};

export function describeAiError(e: unknown): ErrorCopy {
  if (e instanceof AiError) {
    // An own-property check, not `COPY[kind] ?? UNKNOWN`: `kind` is an
    // arbitrary string off the wire, so a payload with kind "constructor" or
    // "toString" would otherwise resolve to a truthy INHERITED property and be
    // spread into the UI as copy. (`Object.hasOwn` would read better but needs
    // an es2022 lib target; this is the same check on the project's current
    // one, and not worth a project-wide compiler change.)
    const known = Object.prototype.hasOwnProperty.call(COPY, e.kind);
    const copy = known ? COPY[e.kind as KnownAiErrorKind] : UNKNOWN;
    if (copy === UNKNOWN) {
      // The server's own message is the only real information we have about an
      // unrecognised kind, so it is shown rather than swallowed.
      return e.message ? { ...copy, body: `${copy.body}\n\n${e.message}` } : copy;
    }
    if (e.kind === 'unconfigured') {
      // The provider's message names the exact route the task needs, and that
      // is the single most useful sentence for whoever picks up the backend
      // work -- so it is kept rather than replaced by friendlier prose.
      return { ...copy, body: `${copy.body}\n\n${e.message}` };
    }
    if (e.kind === 'http' && e.status) {
      return { ...copy, title: `The server said no (${e.status})` };
    }
    return copy;
  }
  return {
    title: 'Something went wrong',
    body: e instanceof Error && e.message ? e.message : 'No further detail was reported.',
    retryable: true,
  };
}
