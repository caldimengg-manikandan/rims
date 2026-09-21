"""
Regression tests for WebSocket Redis Pub/Sub integration (Batch 2, Item 16).
Validates that:
- ConnectionManager publishes to Redis channel on send_personal_message
- Redis listener routes messages to local connections
- Manager falls back to in-memory-only when Redis unavailable
- disconnect() cancels listener task when last connection goes away
"""
import asyncio
import json
import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from app.core.websocket import ConnectionManager, _get_ws_channel


@pytest.mark.asyncio
async def test_ws_channel_name_format():
    """Channel name must follow rims:ws:notifications:{user_id} format."""
    assert _get_ws_channel(42) == "rims:ws:notifications:42"
    assert _get_ws_channel(1) == "rims:ws:notifications:1"


@pytest.mark.asyncio
async def test_send_personal_message_publishes_to_redis():
    """
    send_personal_message must attempt to publish to the Redis channel.
    When Redis is available, the message is published + dispatched locally.
    """
    manager = ConnectionManager()
    user_id = 5

    mock_ws = AsyncMock()
    # Simulate accept
    mock_ws.accept = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.publish = AsyncMock()

    # Patch get_async_redis_client to return our mock
    with patch("app.core.websocket.get_async_redis_client", return_value=mock_redis):
        # Create a task for the redis listener (suppress execution by mocking away)
        with patch.object(manager, "_redis_listener", new=AsyncMock()):
            with patch.object(asyncio, "create_task", return_value=MagicMock(done=lambda: False)):
                await manager.connect(user_id, mock_ws)
                await manager.send_personal_message({"type": "test"}, user_id)

    # Verify Redis publish was called with correct channel
    expected_channel = _get_ws_channel(user_id)
    mock_redis.publish.assert_called_once()
    call_args = mock_redis.publish.call_args
    assert call_args[0][0] == expected_channel
    # Verify message was JSON-serialized
    published = json.loads(call_args[0][1])
    assert published["type"] == "test"


@pytest.mark.asyncio
async def test_send_personal_message_fallback_no_redis():
    """
    When Redis is unavailable, messages must still be dispatched locally.
    No exception should be raised.
    """
    manager = ConnectionManager()
    user_id = 7

    mock_ws = AsyncMock()
    mock_ws.send_json = AsyncMock()

    with patch("app.core.websocket.get_async_redis_client", return_value=None):
        with patch.object(asyncio, "create_task", return_value=MagicMock(done=lambda: False)):
            # Manually inject connection (bypassing connect which starts listener)
            manager.active_connections[user_id] = [mock_ws]
            await manager.send_personal_message({"type": "notification"}, user_id)

    mock_ws.send_json.assert_called_once_with({"type": "notification"})


@pytest.mark.asyncio
async def test_disconnect_removes_connection():
    """disconnect must remove the WebSocket and clean up empty user entries."""
    manager = ConnectionManager()
    user_id = 3

    mock_ws = AsyncMock()
    manager.active_connections[user_id] = [mock_ws]

    manager.disconnect(user_id, mock_ws)

    assert user_id not in manager.active_connections


@pytest.mark.asyncio
async def test_disconnect_cancels_listener_task_when_empty():
    """
    When the last connection for a user disconnects, the listener task must be cancelled.
    """
    manager = ConnectionManager()
    user_id = 9

    mock_ws = AsyncMock()
    manager.active_connections[user_id] = [mock_ws]

    mock_task = MagicMock()
    mock_task.done.return_value = False
    manager._listener_tasks[user_id] = mock_task

    manager.disconnect(user_id, mock_ws)

    mock_task.cancel.assert_called_once()
    assert user_id not in manager._listener_tasks


@pytest.mark.asyncio
async def test_redis_listener_dispatches_to_local_connections():
    """
    The _redis_listener must dispatch messages from Redis channel to local connections.
    """
    manager = ConnectionManager()
    user_id = 11

    mock_ws = AsyncMock()
    mock_ws.send_json = AsyncMock()
    manager.active_connections[user_id] = [mock_ws]

    # Build a fake pubsub that yields one message then stops
    test_message = {"type": "notification", "data": {"id": 42}}
    raw_msg = {"type": "message", "data": json.dumps(test_message)}

    mock_pubsub = AsyncMock()
    mock_pubsub.subscribe = AsyncMock()
    mock_pubsub.unsubscribe = AsyncMock()
    mock_pubsub.aclose = AsyncMock()

    async def fake_listen():
        yield raw_msg
        # Remove connection to break the listener loop
        manager.active_connections.pop(user_id, None)

    mock_pubsub.listen = fake_listen

    mock_redis = AsyncMock()
    mock_redis.pubsub.return_value = mock_pubsub

    with patch("app.core.websocket.get_async_redis_client", return_value=mock_redis):
        await manager._redis_listener(user_id)

    mock_ws.send_json.assert_called_once_with(test_message)
