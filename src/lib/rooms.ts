import { redis } from "@/lib/redis"
import { publish } from "@/lib/realtime"
import { parseConnected } from "@/app/api/[[...slugs]]/auth"

export const ROOM_TTL_SECONDS = Number(process.env.ROOM_TTL_SECONDS || 600)
// Hard ceiling on how long a room may live: 2 hours.
export const MAX_TTL_SECONDS = Number(process.env.MAX_TTL_SECONDS || 2 * 60 * 60)
export const MIN_TTL_SECONDS = 60
export const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 10 * 1024 * 1024)

// Room capacity (how many people may join one room).
export const DEFAULT_CAPACITY = 2
export const MAX_CAPACITY = Number(process.env.MAX_CAPACITY || 10)

// The always-on room: fixed code, never deleted, chat auto-clears on a rolling window.
export const DEFAULT_ROOM_ID = "default"
export const DEFAULT_ROOM_CODE = process.env.DEFAULT_ROOM_CODE || "5555"
export const DEFAULT_ROOM_CAPACITY = Number(process.env.DEFAULT_ROOM_CAPACITY || 20)
export const DEFAULT_CLEAR_SECONDS = Number(process.env.DEFAULT_CLEAR_SECONDS || 600)

export function isDefaultRoom(roomId: string) {
  return roomId === DEFAULT_ROOM_ID
}

/** Keep a requested lifetime within [MIN_TTL_SECONDS, MAX_TTL_SECONDS]. */
export function clampTtl(seconds: number | undefined): number {
  const n = Math.floor(Number(seconds))
  if (!Number.isFinite(n) || n <= 0) return ROOM_TTL_SECONDS
  return Math.min(Math.max(n, MIN_TTL_SECONDS), MAX_TTL_SECONDS)
}

/** Keep a requested capacity within [1, MAX_CAPACITY]. */
export function clampCapacity(n: number | undefined): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_CAPACITY
  return Math.min(Math.max(v, 1), MAX_CAPACITY)
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
  // 4-digit share code -> roomId
  code: (code: string) => `code:${code}`,
}

/** Verify the caller's cookie token belongs to this room. Returns the token. */
export async function requireMember(
  roomId: string | undefined,
  token: string | undefined
): Promise<string> {
  if (!roomId || !token) throw new Error("Unauthorized")
  // The always-on room is open: any joined token counts as a member.
  if (isDefaultRoom(roomId)) return token
  const connected = parseConnected(await redis.hget(keys.meta(roomId), "connected"))
  if (!connected.includes(token)) throw new Error("Unauthorized")
  return token
}

/** Read a room's capacity (defaults to DEFAULT_CAPACITY). */
export async function getCapacity(roomId: string): Promise<number> {
  const raw = await redis.hget(keys.meta(roomId), "capacity")
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAPACITY
}

/** Seconds of life to give chat keys right now (until the room's deadline). */
export async function roomChatTtl(roomId: string): Promise<number> {
  if (isDefaultRoom(roomId)) {
    const clearAt = Number(await redis.hget(keys.meta(roomId), "clearAt"))
    const secs = Math.ceil((clearAt - Date.now()) / 1000)
    return secs > 0 ? secs : DEFAULT_CLEAR_SECONDS
  }
  const t = await redis.ttl(keys.meta(roomId))
  return t > 0 ? t : ROOM_TTL_SECONDS
}

/**
 * Align the room's chat keys (messages + files) to the room deadline. For normal
 * rooms this also refreshes meta/code to the same deadline; for the always-on
 * default room, meta and code are left to persist forever.
 */
export async function touchRoom(roomId: string, ttl?: number) {
  const target = ttl ?? (await roomChatTtl(roomId))
  const [fileIds, code] = await Promise.all([
    redis.smembers(keys.files(roomId)),
    redis.hget(keys.meta(roomId), "code"),
  ])
  const pipeline = redis.pipeline()
  pipeline.expire(keys.messages(roomId), target)
  pipeline.expire(keys.files(roomId), target)
  for (const id of fileIds) {
    pipeline.expire(keys.fileBlob(roomId, id), target)
    pipeline.expire(keys.fileMeta(roomId, id), target)
  }
  if (!isDefaultRoom(roomId)) {
    pipeline.expire(keys.meta(roomId), target)
    if (code) pipeline.expire(keys.code(code), target)
  }
  await pipeline.exec()
}

/** Delete only a room's chat (messages + files), keeping meta + code. */
export async function purgeChat(roomId: string) {
  const fileIds = await redis.smembers(keys.files(roomId))
  const pipeline = redis.pipeline()
  pipeline.del(keys.messages(roomId))
  pipeline.del(keys.files(roomId))
  for (const id of fileIds) {
    pipeline.del(keys.fileBlob(roomId, id))
    pipeline.del(keys.fileMeta(roomId, id))
  }
  await pipeline.exec()
}

/** Permanently delete everything in a room (the "self-destruct"). */
export async function purgeRoom(roomId: string) {
  const code = await redis.hget(keys.meta(roomId), "code")
  await purgeChat(roomId)
  const pipeline = redis.pipeline()
  pipeline.del(keys.meta(roomId))
  if (code) pipeline.del(keys.code(code))
  await pipeline.exec()
}

/** Generate a unique 4-digit code and reserve it (SET NX) pointing at roomId. */
export async function reserveCode(roomId: string, ttl: number): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000))
    if (code === DEFAULT_ROOM_CODE) continue // reserved for the always-on room
    const ok = await redis.set(keys.code(code), roomId, "EX", ttl, "NX")
    if (ok) return code
  }
  return null
}

/** Create the always-on default room if it doesn't exist (meta + code persist). */
export async function ensureDefaultRoom() {
  const exists = await redis.exists(keys.meta(DEFAULT_ROOM_ID))
  if (exists) return
  await redis.hset(keys.meta(DEFAULT_ROOM_ID), {
    connected: JSON.stringify([]),
    createdAt: Date.now(),
    code: DEFAULT_ROOM_CODE,
    capacity: DEFAULT_ROOM_CAPACITY,
    isDefault: "1",
    clearAt: Date.now() + DEFAULT_CLEAR_SECONDS * 1000,
  })
  // Persist the code mapping with no expiry.
  await redis.set(keys.code(DEFAULT_ROOM_CODE), DEFAULT_ROOM_ID)
}

/**
 * If the default room's rolling window has elapsed, wipe its chat and start a
 * fresh window. Returns { clearAt (ms), cleared }.
 */
export async function rollDefaultIfDue(): Promise<{ clearAt: number; cleared: boolean }> {
  await ensureDefaultRoom()
  const now = Date.now()
  let clearAt = Number(await redis.hget(keys.meta(DEFAULT_ROOM_ID), "clearAt"))
  let cleared = false
  if (!Number.isFinite(clearAt) || now >= clearAt) {
    await purgeChat(DEFAULT_ROOM_ID)
    clearAt = now + DEFAULT_CLEAR_SECONDS * 1000
    await redis.hset(keys.meta(DEFAULT_ROOM_ID), { clearAt })
    // Notify everyone in the room so they play the sweep animation together.
    await publish(DEFAULT_ROOM_ID, { event: "cleared" })
    cleared = true
  }
  return { clearAt, cleared }
}
