"""One error type, one place that decides what the client sees.

The frontend does not read HTTP status codes to decide what to say -- it reads
`AiError.kind` (lib/ai/contracts.ts) and looks up copy, including whether a
Retry button is honest. So every failure here has to carry a `kind` string the
client recognises, and the status code is the secondary signal rather than the
primary one.

Ordering note, because it is a real trap: the client's `describeAiError` was a
closed lookup over six kinds with no fallback, and the app had no error boundary
anywhere, so a server emitting a seventh kind produced a WHITE SCREEN on the
session error path. The client was made default-safe first and that shipped
before any of the kinds below were ever emitted. Do not add a kind here without
checking `errorCopy.ts` can survive not knowing it.
"""

from __future__ import annotations


class LlmError(Exception):
    """A failure with a client-facing classification attached.

    `kind` must be a member of `KnownAiErrorKind` in contracts.ts, or the client
    falls back to its unknown-kind copy (which is safe, but says nothing useful).
    """

    def __init__(self, kind: str, message: str, status: int) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.status = status


def unconfigured(detail: str) -> LlmError:
    """No API key.

    503, and it MUST be an error rather than a fallback. The service used to
    answer this case with hardcoded probability lessons and a literal score of
    75 -- so a learner asking for Roman History was taught conditional
    probability and told they scored 75%% no matter what they wrote. Failing
    loudly is the entire point; the client already has typed copy for this.
    """
    return LlmError("unconfigured", detail, 503)


def model_down(detail: str) -> LlmError:
    """Upstream was unreachable, timed out, or returned nothing usable."""
    return LlmError("model_down", detail, 502)


def content_refused(detail: str) -> LlmError:
    """The model declined. Retrying the identical prompt gets the identical no,
    which is why the client renders this one WITHOUT a retry button."""
    return LlmError("content_refused", detail, 422)


def rate_limited(detail: str) -> LlmError:
    return LlmError("rate_limited", detail, 429)


def invalid(detail: str) -> LlmError:
    """The request was rejected before it reached the model."""
    return LlmError("invalid", detail, 422)


def malformed(detail: str) -> LlmError:
    """The model satisfied the JSON schema but not the meaning.

    Distinct from `model_down` on purpose: the service is healthy and answered,
    it just answered with something that would teach the learner wrongly -- a
    `correct_answer` that is not among `options`, say. See validate.py for why
    that check has to exist at all.
    """
    return LlmError("malformed", detail, 502)
