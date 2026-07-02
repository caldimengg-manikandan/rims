'use client';

import { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/config';
import { toast } from '@/hooks/use-toast';

export function useWebSocket(user: { id: number; role: string } | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectDelay = useRef(2000); // Start with 2s delay

  const connect = () => {
    if (!user) return;

    // Build the WebSocket URL dynamically based on getApiBaseUrl()
    const apiBase = getApiBaseUrl();
    const wsBase = apiBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const wsUrl = `${wsBase}/ws/notifications`;

    console.log(`[WebSocket] Connecting to ${wsUrl}`);
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('[WebSocket] Connected successfully');
      setIsConnected(true);
      reconnectDelay.current = 2000; // Reset reconnect delay on successful connection
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        console.log('[WebSocket] Message received:', payload);

        if (payload.type === 'notification' && payload.data) {
          const { title, message } = payload.data;
          
          // 1. Show dynamic toast notification
          toast({
            title: title || 'New Notification',
            description: message || '',
            duration: 6000,
          });

          // 2. Trigger global data mutation to refresh notification bell count
          window.dispatchEvent(
            new CustomEvent('rims:data-mutated', {
              detail: { keys: ['/api/notifications'] }
            })
          );
        }
      } catch (err) {
        console.error('[WebSocket] Failed to parse message:', err);
      }
    };

    socket.onclose = (event) => {
      setIsConnected(false);
      wsRef.current = null;
      console.log(`[WebSocket] Connection closed (code: ${event.code}). Attempting reconnect...`);
      
      // Prevent rapid reconnection loops using exponential backoff (max 30s)
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000);
        connect();
      }, reconnectDelay.current);
    };

    socket.onerror = (err) => {
      console.error('[WebSocket] Error occurred:', err);
    };
  };

  useEffect(() => {
    if (user) {
      connect();
    }

    return () => {
      // Clean up connection and timeouts on unmount or user change
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [user]);

  return { isConnected };
}
