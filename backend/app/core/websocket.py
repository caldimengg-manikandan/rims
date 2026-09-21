"""
WebSocket connection manager with Redis Pub/Sub support.

Multi-worker architecture:
- Each worker maintains a local dict of active WebSocket connections.
- On connect: worker subscribes to the per-user Redis channel (rims:ws:notifications:{user_id}).
- On send_personal_message: message is published to Redis channel AND dispatched locally.
  - If the connection is on the same worker: the local dispatch fires immediately.
  - If the connection is on a different worker: the Redis listener on that worker delivers it.
- Falls back to in-memory-only when Redis is unavailable (single-worker scenarios).
"""
import json
import logging
import asyncio
from typing import Dict, List, Optional
from fastapi import WebSocket
from sqlalchemy.orm import Session
from app.domain.models import Notification
from app.core.timezone import get_ist_now

logger = logging.getLogger(__name__)


def _get_ws_channel(user_id: int) -> str:
    return f"rims:ws:notifications:{user_id}"


class ConnectionManager:
    def __init__(self):
        # Maps user_id (int) to a list of active WebSocket connections on THIS worker
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # Maps user_id to the background listener task for Redis subscription
        self._listener_tasks: Dict[int, asyncio.Task] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(
            "User %s connected to WebSocket. Active connections: %d",
            user_id,
            len(self.active_connections[user_id]),
        )
        # Start Redis Pub/Sub listener for this user if not already running
        if user_id not in self._listener_tasks or self._listener_tasks[user_id].done():
            task = asyncio.create_task(self._redis_listener(user_id))
            self._listener_tasks[user_id] = task

    def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
            except ValueError:
                pass
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                # Cancel the Redis listener when the last connection for this user is gone
                task = self._listener_tasks.pop(user_id, None)
                if task and not task.done():
                    task.cancel()
        logger.info("User %s disconnected from WebSocket.", user_id)

    async def send_personal_message(self, message: dict, user_id: int):
        """
        Publish to Redis so all workers can deliver to the user, and
        simultaneously dispatch directly if the connection is on this worker.
        """
        # Try Redis first (cross-worker delivery)
        await self._publish_to_redis(user_id, message)

        # Also dispatch locally (avoids one round-trip when connection is on this worker)
        await self._dispatch_local(user_id, message)

    async def broadcast(self, message: dict):
        """Broadcast to all locally connected users. For cross-worker broadcast, use a tenant channel."""
        for user_id, connections in list(self.active_connections.items()):
            for connection in list(connections):
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error("Failed to broadcast WebSocket message to user %s: %s", user_id, e)
                    self.disconnect(user_id, connection)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _dispatch_local(self, user_id: int, message: dict):
        """Send message to all connections for user_id on this worker."""
        if user_id not in self.active_connections:
            return
        for connection in list(self.active_connections[user_id]):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error("Failed to send WebSocket message to user %s: %s", user_id, e)
                self.disconnect(user_id, connection)

    async def _publish_to_redis(self, user_id: int, message: dict):
        """Publish message to Redis Pub/Sub channel. No-op if Redis unavailable."""
        from app.core.redis_store import get_async_redis_client
        r = get_async_redis_client()
        if r is None:
            return
        try:
            channel = _get_ws_channel(user_id)
            await r.publish(channel, json.dumps(message))
        except Exception as e:
            logger.warning("Redis publish failed for user %s: %s", user_id, e)

    async def _redis_listener(self, user_id: int):
        """
        Background async task that subscribes to the per-user Redis channel and
        delivers incoming messages to all active connections for that user on this worker.
        Exits cleanly when the user has no more connections or on cancellation.
        """
        from app.core.redis_store import get_async_redis_client
        r = get_async_redis_client()
        if r is None:
            return  # Redis not configured — no listener needed

        channel = _get_ws_channel(user_id)
        try:
            pubsub = r.pubsub()
            await pubsub.subscribe(channel)
            logger.debug("Redis Pub/Sub listener started for user %s on channel %s", user_id, channel)

            async for raw_msg in pubsub.listen():
                if raw_msg and raw_msg.get("type") == "message":
                    try:
                        message = json.loads(raw_msg["data"])
                        await self._dispatch_local(user_id, message)
                    except (json.JSONDecodeError, Exception) as e:
                        logger.warning("Invalid Redis Pub/Sub payload for user %s: %s", user_id, e)

                # Stop if user has no more active connections on this worker
                if user_id not in self.active_connections:
                    break

        except asyncio.CancelledError:
            pass  # Task cancelled on disconnect — expected
        except Exception as e:
            logger.warning("Redis Pub/Sub listener error for user %s: %s", user_id, e)
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()
            except Exception:
                pass
            logger.debug("Redis Pub/Sub listener stopped for user %s", user_id)


manager = ConnectionManager()


def trigger_realtime_notification(
    db: Session,
    user_id: int,
    notification_type: str,
    title: str,
    message_content: str,
    related_application_id: int = None,
    related_interview_id: int = None,
    tenant_id=None,   # UUID | None — stamped for RLS isolation
) -> Notification:
    """
    Creates a Notification in the database and dispatches a background task
    to broadcast it to the client via WebSockets (Redis Pub/Sub if available,
    in-memory fallback otherwise).
    Can be safely called from both sync and async FastAPI endpoints.
    """
    notification = Notification(
        user_id=user_id,
        notification_type=notification_type,
        title=title,
        message=message_content,
        is_read=False,
        related_application_id=related_application_id,
        related_interview_id=related_interview_id,
        tenant_id=tenant_id,
        created_at=get_ist_now()
    )
    db.add(notification)
    db.flush()

    # Convert to serializable dict
    notification_data = {
        "id": notification.id,
        "notification_type": notification.notification_type,
        "title": notification.title,
        "message": notification.message,
        "is_read": notification.is_read,
        "related_application_id": notification.related_application_id,
        "related_interview_id": notification.related_interview_id,
        "created_at": notification.created_at.isoformat() if notification.created_at else None
    }

    # Dispatch to WebSocket connection manager in the background with a slight delay
    # to allow the outer transaction to commit before the message is read by the client.
    payload = {"type": "notification", "data": notification_data}

    try:
        loop = asyncio.get_running_loop()
        if loop.is_running():
            async def delayed_send():
                await asyncio.sleep(0.05)
                await manager.send_personal_message(payload, user_id)
            loop.create_task(delayed_send())
    except RuntimeError:
        # Fallback if no event loop is running
        pass

    return notification
