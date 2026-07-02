import logging
import asyncio
from typing import Dict, List
from fastapi import WebSocket
from sqlalchemy.orm import Session
from app.domain.models import Notification
from app.core.timezone import get_ist_now

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Maps user_id (int) to a list of active WebSocket connections
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"User {user_id} connected to WebSocket. Total active connections: {len(self.active_connections[user_id])}")

    def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"User {user_id} disconnected from WebSocket.")

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            for connection in list(self.active_connections[user_id]):
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Failed to send WebSocket message to user {user_id}: {e}")
                    # Clean up broken connections
                    self.disconnect(user_id, connection)

    async def broadcast(self, message: dict):
        for user_id, connections in list(self.active_connections.items()):
            for connection in list(connections):
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Failed to broadcast WebSocket message to user {user_id}: {e}")
                    self.disconnect(user_id, connection)

manager = ConnectionManager()

def trigger_realtime_notification(
    db: Session,
    user_id: int,
    notification_type: str,
    title: str,
    message_content: str,
    related_application_id: int = None,
    related_interview_id: int = None
) -> Notification:
    """
    Creates a Notification in the database and dispatches a background task 
    to broadcast it to the client via WebSockets if they are currently online.
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
    # to allow the outer transaction to commit.
    payload = {"type": "notification", "data": notification_data}
    
    try:
        loop = asyncio.get_running_loop()
        if loop.is_running():
            async def delayed_send():
                await asyncio.sleep(0.05)
                await manager.send_personal_message(payload, user_id)
            loop.create_task(delayed_send())
    except RuntimeError:
        # Fallback if no loop is running
        pass

    return notification
