"""
Shared Redis connection for idempotency, short-lived response replay caches,
and WebSocket Pub/Sub dispatch.

When ``REDIS_URL`` is unset, callers fall back to in-process stores (single-worker only).
Use ``redis://...`` in production so all workers share the same key space.

On each access we ``PING`` the existing client; if the connection dropped, we discard
the client and reconnect so a transient Redis blip does not permanently disable Redis.

Two clients are provided:
- ``get_redis_client()``       — synchronous redis.Redis (for idempotency, job_queue)
- ``get_async_redis_client()`` — asynchronous redis.asyncio.Redis (for WebSocket Pub/Sub)
"""


import logging
import threading
from typing import Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_client_lock = threading.Lock()
_client: Optional[object] = None  # redis.Redis when available

# Async client — created on first call, never replaced unless explicitly reset
_async_client: Optional[object] = None
_async_client_lock = threading.Lock()


def get_redis_client():
    """
    Lazy singleton synchronous Redis client. Returns None if REDIS_URL is empty.
    Validates the connection with PING and transparently reconnects after failures.
    """
    global _client
    url = (get_settings().redis_url or "").strip()
    if not url:
        return None

    with _client_lock:
        if _client is not None:
            try:
                _client.ping()
                return _client
            except Exception as e:
                logger.warning(
                    "Redis ping failed; discarding client and reconnecting: %s",
                    e,
                    exc_info=False,
                )
                try:
                    _client.close()
                except Exception:
                    pass
                _client = None

        try:
            import redis as redis_lib

            r = redis_lib.Redis.from_url(url, decode_responses=True)
            r.ping()
            _client = r
            logger.info("Redis connected for idempotency / ephemeral replay cache")
        except Exception as e:
            logger.warning(
                "Redis unavailable; idempotency falls back to process-local: %s",
                e,
                exc_info=False,
            )
            _client = None

    return _client


def get_async_redis_client():
    """
    Lazy singleton async Redis client (redis.asyncio).
    Returns None if REDIS_URL is empty or if redis-py is not available.
    Used primarily for WebSocket Pub/Sub across multiple workers.

    NOTE: The returned client is a redis.asyncio.Redis instance and must be
    used with ``await`` in async contexts.
    """
    global _async_client
    url = (get_settings().redis_url or "").strip()
    if not url:
        return None

    with _async_client_lock:
        if _async_client is not None:
            return _async_client

        try:
            import redis.asyncio as aioredis

            r = aioredis.Redis.from_url(url, decode_responses=True)
            _async_client = r
            logger.info("Async Redis client created for WebSocket Pub/Sub")
        except Exception as e:
            logger.warning(
                "Async Redis client unavailable; WebSocket will use in-memory only: %s",
                e,
                exc_info=False,
            )
            _async_client = None

    return _async_client


def reset_redis_client_for_tests() -> None:
    """Close and clear sync singleton (tests only)."""
    global _client
    with _client_lock:
        if _client is not None:
            try:
                _client.close()
            except Exception:
                pass
        _client = None


def reset_async_redis_client_for_tests() -> None:
    """Clear async singleton reference (tests only). Does not await close."""
    global _async_client
    with _async_client_lock:
        _async_client = None
