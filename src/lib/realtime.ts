import { z } from "zod"
import { redis, REDIS_PREFIX } from "@/lib/redis"

/**
 * Realtime layer built on Valkey's native PUB/SUB (no Upstash).
 *
 * - Publishers call `publish(roomId, event)` from any API route.
 * - The SSE endpoint (/api/realtime) subscribes to the room channel and streams
 *   these events to the browser as Server-Sent Events.
 */

export const fileMeta = z.object({
  fileId: z.string(),
  name: z.string().max(255),
  type: z.string().max(255),
  size: z.number().int().nonnegative(),
})

export const message = z.object({
  id: z.string(),
  sender: z.string(),
  text: z.string(),
  timestamp: z.number(),
  roomId: z.string(),
  token: z.string().optional(),
  file: fileMeta.optional(),
})

export type FileMeta = z.infer<typeof fileMeta>
export type Message = z.infer<typeof message>

export type RealtimeEvent =
  | { event: "message"; data: Message }
  | { event: "destroy"; data: { isDestroyed: true } }

/** ioredis keyPrefix does NOT cover pub/sub channels, so prefix them ourselves. */
export function channelName(roomId: string) {
  return `${REDIS_PREFIX}room:${roomId}`
}

export async function publish(roomId: string, event: RealtimeEvent) {
  await redis.publish(channelName(roomId), JSON.stringify(event))
}
