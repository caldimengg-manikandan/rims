import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status
from sqlalchemy.orm import Session
from app.infrastructure.database import get_db
from app.core.auth import verify_token
from app.domain.models import User
from app.core.websocket import manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])

@router.websocket("/notifications")
async def websocket_notifications(
    websocket: WebSocket,
    db: Session = Depends(get_db)
):
    """
    WebSocket endpoint for real-time notifications.
    Client can connect in two ways:
    1. Query Parameter: ws://<host>/calrims/ws/notifications?token=<JWT_TOKEN>
    2. Cookie: ws://<host>/calrims/ws/notifications (cookies access_token/hr_token sent automatically)
    """
    # Try reading token from query parameters first
    token = websocket.query_params.get("token")
    
    # Fallback to cookies if query parameter not provided
    if not token:
        token = websocket.cookies.get("access_token") or websocket.cookies.get("hr_token")

    if not token:
        logger.warning("WebSocket connection attempt rejected: missing authentication token.")
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing token")
        return

    try:
        # Verify JWT Token
        payload = verify_token(token)
        sub = payload.get("sub")
        if not sub:
            logger.warning("WebSocket connection attempt rejected: payload missing 'sub'.")
            await websocket.accept()
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token payload")
            return
        
        user_id = int(sub)
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            logger.warning(f"WebSocket connection attempt rejected: user_id {user_id} not found in database.")
            await websocket.accept()
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="User not found")
            return
            
    except Exception as e:
        logger.error(f"WebSocket authentication error: {e}")
        try:
            await websocket.accept()
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Authentication failed")
        except Exception:
            pass
        return

    # Add the user connection
    await manager.connect(user_id, websocket)

    try:
        # Keep the socket open and listen for heartbeat/messages
        while True:
            # Detect client disconnection by listening for messages
            data = await websocket.receive_text()
            # Simple heartbeat / ping-pong support
            if data == "ping":
                await websocket.send_text("pong")
            else:
                # Echo other data back or handle custom actions
                await websocket.send_json({"type": "echo", "message": data})
                
    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)
    except Exception as e:
        logger.error(f"Unexpected WebSocket error for user {user_id}: {e}")
        manager.disconnect(user_id, websocket)
