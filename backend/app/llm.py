"""The model client: one call path, one error taxonomy, one cache.

WHAT IS GONE FROM HERE, AND WHY IT MATTERS MOST.

Every method in the previous llm_service.py opened with `if self.client is None:`
and returned hardcoded probability material -- a seven-concept Bayes path with
invented mastery numbers, a full conditional-probability lesson, and an
assessment of `{"score": 75, "correct": true, "misconceptions": ["Confuses
P(A|B) with P(B|A)"]}`.

With no API key, a learner who asked for Roman History was taught conditional
probability and told they scored 75% no matter what they wrote.

That is worse than anything the frontend overhaul removed. Those were fake
numbers; this was fake TEACHING and a fake GRADE, delivered with total
confidence. There is now exactly one no-key branch in this file, in __init__,
and it raises. The client already has typed copy for `unconfigured`.

The rule, stated once: nothing in this module may produce subject matter. Not on
the no-key path, not on any error path, not as a fallback, not as a "sensible
default". If the model cannot be reached, the app says so.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from app.errors import content_refused, malformed, model_down, unconfigured

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - openai is a hard dep in practice
    OpenAI = None  # type: ignore[assignment]

MODEL = os.getenv("LEARNABLE_MODEL", "gpt-4o-mini")

# Measured: a 20-question lesson takes 19.8s, so 40s is real headroom over the
# slowest legal request. The client aborts at 45s, just above this, so neither
# side is ever waiting on a request the other has already given up on.
REQUEST_TIMEOUT_S = float(os.getenv("LEARNABLE_TIMEOUT", "40"))

# ZERO, deliberately, and this was found by measurement rather than reasoning.
#
# The SDK retries twice by default, INCLUDING on timeout. An end-to-end run
# caught a /questions call taking 49.5 seconds against a 45s per-attempt
# timeout -- which is only possible if a first attempt timed out and a second
# silently ran. The learner's client had already aborted at 45s, so they waited
# the full time, saw an error, and were billed for a generation that completed
# into a closed connection.
#
# Retrying is the wrong trade for this service specifically. Every loading state
# here is deliberately unmeasurable -- PressLoader says "there is no progress bar
# here and there never will be, because we do not know the progress" -- so a
# silent retry is indistinguishable from a hang, and it doubles the worst case
# invisibly. Failing at a predictable bound and letting the person decide is the
# honest version, and `errorCopy.ts` already gives `model_down` a retry button
# that says what it is.
MAX_RETRIES = int(os.getenv("LEARNABLE_MAX_RETRIES", "0"))

CACHE_MAX = 256
CACHE_TTL_S = 60 * 60 * 6


class _Cache:
    """A small in-process LRU over generated CONTENT.

    Safe only because this service is stateless and content-only. A cache entry
    is "the lesson for this concept, at this level, for this budget, with these
    misconceptions" -- it holds no learner progress, so two people studying the
    same thing legitimately get the same material, exactly as two people opening
    the same textbook do.

    THE CACHE KEY IS THE WHOLE DESIGN. It is built from every input that changes
    the output, and the one that must never be forgotten is the misconception
    set together with `is_review`: a re-teach exists precisely to differ from
    the first attempt, so a key that ignored those would serve the very lesson
    the learner already failed to understand. Every request field goes into the
    hash, which makes that correct by construction rather than by vigilance.

    Practice batches get this for free: each batch sends the prompts already
    seen, so a different seen-list is a different key and a genuinely new
    generation. "Unlimited, non-repeating" and "cached" are not in tension.
    """

    def __init__(self) -> None:
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Any | None:
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                self.misses += 1
                return None
            stored_at, value = hit
            if time.time() - stored_at > CACHE_TTL_S:
                self._data.pop(key, None)
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            # A deep copy via round-trip: callers mutate what they get back
            # (validate.py rewrites ids in place), and handing out the cached
            # object itself would let one request corrupt every later hit.
            return json.loads(json.dumps(value))

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = (time.time(), json.loads(json.dumps(value)))
            self._data.move_to_end(key)
            while len(self._data) > CACHE_MAX:
                self._data.popitem(last=False)

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"entries": len(self._data), "hits": self.hits, "misses": self.misses}


def cache_key(task: str, payload: dict[str, Any]) -> str:
    blob = json.dumps({"task": task, "model": MODEL, "payload": payload},
                      sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class LlmClient:
    def __init__(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        self.client = (
            OpenAI(api_key=api_key, timeout=REQUEST_TIMEOUT_S, max_retries=MAX_RETRIES)
            if api_key and OpenAI is not None
            else None
        )
        self.cache = _Cache()
        # Token accounting, so "what does unlimited cost" stops being a guess.
        # Process-lifetime only, and /health reports it as such.
        self._usage_lock = threading.Lock()
        self.tokens_in = 0
        self.tokens_out = 0
        self.calls = 0

    @property
    def configured(self) -> bool:
        return self.client is not None

    def generate(self, task: str, prompt: str, schema_name: str,
                 schema: dict[str, Any], key_payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """One JSON generation. The only path to the model in this service."""
        if self.client is None:
            raise unconfigured(
                "The server has no OPENAI_API_KEY, so it cannot generate anything. "
                "Every word of content in this app comes from a model; there is no "
                "offline material to fall back to, and inventing some would mean "
                "teaching you something nobody wrote."
            )

        key = cache_key(task, key_payload) if key_payload is not None else None
        if key:
            cached = self.cache.get(key)
            if cached is not None:
                return cached

        try:
            response = self.client.responses.create(
                model=MODEL,
                input=[{"role": "user", "content": prompt}],
                text={"format": {"type": "json_schema", "name": schema_name,
                                 "schema": schema, "strict": True}},
            )
        except Exception as exc:
            raise _classify(exc) from exc

        usage = getattr(response, "usage", None)
        if usage is not None:
            with self._usage_lock:
                self.calls += 1
                self.tokens_in += getattr(usage, "input_tokens", 0) or 0
                self.tokens_out += getattr(usage, "output_tokens", 0) or 0

        # A refusal satisfies no schema, so it arrives as an empty or absent
        # output rather than as an exception. Reporting it as `model_down` would
        # put a Retry button on something that will refuse identically forever.
        status = getattr(response, "status", None)
        if status == "incomplete":
            reason = getattr(getattr(response, "incomplete_details", None), "reason", None)
            if reason == "content_filter":
                raise content_refused(
                    "The model declined to generate material for this request."
                )
            raise model_down(f"The model stopped before finishing ({reason or 'unknown reason'}).")

        text = getattr(response, "output_text", None)
        if not text:
            if _looks_refused(response):
                raise content_refused("The model declined to generate material for this request.")
            raise model_down("The model returned an empty response.")

        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise malformed("The model returned text that is not valid JSON.") from exc
        if not isinstance(data, dict):
            raise malformed("The model returned a JSON value that is not an object.")

        if key:
            self.cache.put(key, data)
        return data

    def usage(self) -> dict[str, Any]:
        with self._usage_lock:
            # gpt-4o-mini list price. Reported as an estimate because it is one:
            # it is computed from a hardcoded rate, not from anything billed.
            cost = self.tokens_in / 1e6 * 0.150 + self.tokens_out / 1e6 * 0.600
            return {
                "calls": self.calls,
                "tokens_in": self.tokens_in,
                "tokens_out": self.tokens_out,
                "estimated_cost_usd": round(cost, 4),
            }


def _looks_refused(response: Any) -> bool:
    try:
        for item in getattr(response, "output", None) or []:
            for part in getattr(item, "content", None) or []:
                if getattr(part, "type", "") == "refusal":
                    return True
    except Exception:
        return False
    return False


def _classify(exc: Exception) -> Exception:
    """Map an SDK exception onto a kind the client has copy for.

    Matching on class NAME rather than importing the exception types: the import
    path for these has moved between SDK majors, and a service that crashes on
    an ImportError while trying to describe an error is worse than one that
    reads a string. The message is included either way, so a miss degrades to a
    correct-status generic rather than to silence.
    """
    name = type(exc).__name__
    detail = str(exc)[:300]

    if "RateLimit" in name:
        from app.errors import rate_limited
        return rate_limited(f"The model provider is rate limiting this key. {detail}")
    if "Authentication" in name or "PermissionDenied" in name:
        # Not `unconfigured`: a key IS configured, it is just not accepted. The
        # client's unconfigured copy says "waiting on a backend endpoint", which
        # would be actively misleading here.
        return model_down(f"The model rejected this server's credentials. {detail}")
    if "BadRequest" in name and "content_policy" in detail.lower():
        return content_refused(f"The request was refused on content grounds. {detail}")
    if "APITimeout" in name or "Timeout" in name:
        return model_down(f"The model did not answer within {REQUEST_TIMEOUT_S:.0f}s. {detail}")
    if "Connection" in name:
        return model_down(f"Could not reach the model provider. {detail}")
    return model_down(f"{name}: {detail}")
