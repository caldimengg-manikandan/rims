'use client';

import { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '@/lib/config';
import { toast } from '@/hooks/use-toast';

export function useWebSocket(user: { id: number; role: string } | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectDelay = useRef(2000); // Start with 2s delay

  const connect = async () => {
    if (!user || !isMountedRef.current) return;

    try {
      const apiBase = getApiBaseUrl();
      let wsToken: string | null = null;

      // 1. Fetch short-lived WS authentication ticket using session credentials
      try {
        const headers: Record<string, string> = {}
        if (typeof window !== 'undefined') {
          const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token')
          if (authToken && authToken !== 'cookie_managed') {
            headers['Authorization'] = `Bearer ${authToken}`
          }
        }

        const tokenRes = await fetch(`${apiBase}/api/auth/ws-token`, {
          credentials: 'include',
          headers,
          cache: 'no-store',
        });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          wsToken = tokenData.token || tokenData?.data?.token || null;
        } else if (tokenRes.status === 401) {
          // Unauthenticated: do not connect or spam reconnect
          return;
        }
      } catch (err) {
        // Backend or network error fetching token
      }

      if (!isMountedRef.current || !user || !wsToken) return;

      // 2. Build the WebSocket URL with token query parameter
      const wsBase = apiBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
      const wsUrl = `${wsBase}/ws/notifications?token=${encodeURIComponent(wsToken)}`;


      // Close previous connection if exists
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Reconnecting');
        } catch {
          // Ignore
        }
      }

      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!isMountedRef.current) {
          socket.close(1000, 'Unmounted');
          return;
        }
        setIsConnected(true);
        reconnectDelay.current = 2000; // Reset reconnect delay on successful connection
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

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

        // Do not auto-reconnect on normal manual closure (1000) or when unmounted
        if (event.code === 1000 || !isMountedRef.current || !user) {
          return;
        }

        // Exponential backoff for reconnection (max 30s)
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000);
          connect();
        }, reconnectDelay.current);
      };

      socket.onerror = () => {
        // Suppress unhandled console error object during transient disconnections/handshakes
      };
    } catch {
      // Gracefully handle connection initialization errors
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    if (user) {
      connect();
    } else {
      if (wsRef.current) {
        wsRef.current.close(1000, 'User logged out');
        wsRef.current = null;
      }
      setIsConnected(false);
    }

    return () => {
      isMountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [user?.id, user?.role]);

  return { isConnected };
}

