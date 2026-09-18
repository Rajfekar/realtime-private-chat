import { redis } from "@/lib/redis"
import { parseConnected } from "@/app/api/[[...slugs]]/auth"

export const ROOM_TTL_SECONDS = Number(process.env.ROOM_TTL_SECONDS || 600)
// Hard ceiling on how long a room may live: 2 hours.
export const MAX_TTL_SECONDS = Number(process.env.MAX_TTL_SECONDS || 2 * 60 * 60)
export const MIN_TTL_SECONDS = 60
export const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 10 * 1024 * 1024)

/** Keep a requested lifetime within [MIN_TTL_SECONDS, MAX_TTL_SECONDS]. */
export function clampTtl(seconds: number | undefined): number {
  const n = Math.floor(Number(seconds))
  if (!Number.isFinite(n) || n <= 0) return ROOM_TTL_SECONDS
  return Math.min(Math.max(n, MIN_TTL_SECONDS), MAX_TTL_SECONDS)
}

// Which file types the chat accepts (images + PDF).
export const ALLOWED_FILE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]

export const keys = {
  meta: (roomId: string) => `meta:${roomId}`,
  messages: (roomId: string) => `messages:${roomId}`,
  files: (roomId: string) => `files:${roomId}`,
  fileBlob: (roomId: string, fileId: string) => `fileblob:${roomId}:${fileId}`,
  fileMeta: (roomId: string, fileId: string) => `filemeta:${roomId}:${fileId}`,
}

/** Verify the caller's cookie token belongs to this room. Returns the token. */
export async function requireMember(
  roomId: string | undefined,
  token: string | undefined
): Promise<string> {
  if (!roomId || !token) throw new Error("Unauthorized")
  const connected = parseConnected(await redis.hget(keys.meta(roomId), "connected"))
  if (!connected.includes(token)) throw new Error("Unauthorized")
  return token
}

/**
 * Align every key belonging to a room to the same expiry, so messages and files
 * self-destruct together with the room.
 *
 * By default this preserves the room's CURRENT remaining lifetime (the meta
 * key's TTL, which was set from the creator's chosen destruction time). Passing
 * an explicit `ttl` overrides it. Never silently falls back to a short default
 * while the room still has a live deadline — that would shorten a 2h room to 10m.
 */
export async function touchRoom(roomId: string, ttl?: number) {
  let target = ttl
  if (target === undefined) {
    const current = await redis.ttl(keys.meta(roomId))
    target = current > 0 ? current : ROOM_TTL_SECONDS
  }
  const fileIds = await redis.smembers(keys.files(roomId))
  const pipeline = redis.pipeline()
  pipeline.expire(keys.meta(roomId), target)
  pipeline.expire(keys.messages(roomId), target)
  pipeline.expire(keys.files(roomId), target)
  for (const id of fileIds) {
    pipeline.expire(keys.fileBlob(roomId, id), target)
    pipeline.expire(keys.fileMeta(roomId, id), target)
  }
  await pipeline.exec()
}

/** Permanently delete everything in a room (the "self-destruct"). */
export async function purgeRoom(roomId: string) {
  const fileIds = await redis.smembers(keys.files(roomId))
  const pipeline = redis.pipeline()
  pipeline.del(keys.meta(roomId))
  pipeline.del(keys.messages(roomId))
  pipeline.del(keys.files(roomId))
  for (const id of fileIds) {
    pipeline.del(keys.fileBlob(roomId, id))
    pipeline.del(keys.fileMeta(roomId, id))
  }
  await pipeline.exec()
}
