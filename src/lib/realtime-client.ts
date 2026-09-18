"use client"

import { useEffect, useRef } from "react"
import type { RealtimeEvent } from "./realtime"

/**
 * Subscribe to a room's realtime stream over Server-Sent Events.
 * Drop-in replacement for the old Upstash `useRealtime` hook.
 */
export function useRealtime({
  roomId,
  onEvent,
  enabled = true,
}: {
  roomId: string
  onEvent: (event: RealtimeEvent) => void
  enabled?: boolean
}) {
  // Keep the latest callback without re-opening the connection each render.
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    if (!enabled || !roomId) return

    const source = new EventSource(
      `/api/realtime?roomId=${encodeURIComponent(roomId)}`
    )

    source.onmessage = (e) => {
      if (!e.data) return
      try {
        const parsed = JSON.parse(e.data) as RealtimeEvent
        handlerRef.current(parsed)
      } catch {
        // Ignore malformed frames / heartbeats.
      }
    }

    source.onerror = () => {
      // EventSource auto-reconnects using the `retry:` hint from the server.
    }

    return () => source.close()
  }, [roomId, enabled])
}
