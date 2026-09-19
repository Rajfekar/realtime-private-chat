import { redis } from "@/lib/redis"
import { Elysia } from "elysia"
import { nanoid } from "nanoid"
import { AuthError, authMiddleware } from "./auth"
import { z } from "zod"
import { Message, publish } from "@/lib/realtime"
import {
  DEFAULT_CLEAR_SECONDS,
  DEFAULT_ROOM_CODE,
  clampCapacity,
  clampTtl,
  ensureDefaultRoom,
  isDefaultRoom,
  keys,
  purgeChat,
  purgeRoom,
  reserveCode,
  rollDefaultIfDue,
  touchRoom,
} from "@/lib/rooms"

// ioredis (raw TCP) requires the Node.js runtime, not Edge.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const rooms = new Elysia({ prefix: "/room" })
  .post(
    "/create",
    async ({ body, set }) => {
      // Only your group can create rooms. Fail closed if no password is configured.
      const expected = process.env.CREATE_PASSWORD || ""
      if (!expected || body?.password !== expected) {
        set.status = 401
        return { error: "invalid-password" }
      }

      const roomId = nanoid()
      const ttl = clampTtl(body?.ttl)
      const capacity = clampCapacity(body?.capacity)

      const code = await reserveCode(roomId, ttl)
      if (!code) {
        set.status = 500
        return { error: "code-generation-failed" }
      }

      await redis.hset(keys.meta(roomId), {
        connected: JSON.stringify([]),
        createdAt: Date.now(),
        code,
        capacity,
      })
      await redis.expire(keys.meta(roomId), ttl)

      return { roomId, code, ttl, capacity }
    },
    {
      body: z.object({
        ttl: z.number().int().optional(),
        capacity: z.number().int().optional(),
        password: z.string().max(200).optional(),
      }),
    }
  )
  // Resolve a 4-digit share code to its room (public — how joiners enter).
  .get(
    "/resolve",
    async ({ query, set }) => {
      const code = (query.code || "").trim()
      if (!/^\d{4}$/.test(code)) {
        set.status = 400
        return { error: "bad-code" }
      }
      // The always-on room is created on demand.
      if (code === DEFAULT_ROOM_CODE) await ensureDefaultRoom()
      const roomId = await redis.get(keys.code(code))
      if (!roomId) {
        set.status = 404
        return { error: "not-found" }
      }
      return { roomId }
    },
    { query: z.object({ code: z.string() }) }
  )
  .use(authMiddleware)
  .get(
    "/ttl",
    async ({ auth }) => {
      if (isDefaultRoom(auth.roomId)) {
        const { clearAt } = await rollDefaultIfDue()
        const secs = Math.ceil((clearAt - Date.now()) / 1000)
        return { ttl: secs > 0 ? secs : 0 }
      }
      const ttl = await redis.ttl(keys.meta(auth.roomId))
      return { ttl: ttl > 0 ? ttl : 0 }
    },
    { query: z.object({ roomId: z.string() }) }
  )
  .delete(
    "/",
    async ({ auth, set }) => {
      // The always-on room is never deleted — "destroy" just clears its chat.
      if (isDefaultRoom(auth.roomId)) {
        await purgeChat(auth.roomId)
        await redis.hset(keys.meta(auth.roomId), {
          clearAt: Date.now() + DEFAULT_CLEAR_SECONDS * 1000,
        })
        await publish(auth.roomId, { event: "update" })
        return { ok: true, cleared: true }
      }
      // Normal rooms: only the owner (first/creator slot) may destroy them.
      if (auth.connected[0] !== auth.token) {
        set.status = 403
        return { error: "not-owner" }
      }
      await publish(auth.roomId, { event: "destroy", data: { isDestroyed: true } })
      await purgeRoom(auth.roomId)
      return { ok: true }
    },
    { query: z.object({ roomId: z.string() }) }
  )

const messages = new Elysia({ prefix: "/messages" })
  .use(authMiddleware)
  .post(
    "/",
    async ({ body, auth }) => {
      const { sender, text } = body
      const { roomId } = auth

      // For the always-on room, clear first if its window elapsed.
      if (isDefaultRoom(roomId)) await rollDefaultIfDue()

      const roomExists = await redis.exists(keys.meta(roomId))
      if (!roomExists) throw new Error("Room does not exist")

      const message: Message = {
        id: nanoid(),
        sender,
        text,
        timestamp: Date.now(),
        roomId,
      }

      // Persist to history (with the owner token) then broadcast (without it).
      await redis.rpush(
        keys.messages(roomId),
        JSON.stringify({ ...message, token: auth.token })
      )
      await publish(roomId, { event: "message", data: message })

      // Keep chat keys aligned to the room deadline (or the default room's window).
      await touchRoom(roomId)

      return { ok: true }
    },
    {
      query: z.object({ roomId: z.string() }),
      body: z.object({
        sender: z.string().max(100),
        text: z.string().max(1000),
      }),
    }
  )
  .delete(
    "/",
    async ({ query, auth, set }) => {
      const { roomId } = auth
      const raw = await redis.lrange(keys.messages(roomId), 0, -1)

      // Find the exact stored entry for this message id.
      let storedStr: string | null = null
      let msg: Message | null = null
      for (const s of raw) {
        try {
          const m = JSON.parse(s) as Message
          if (m.id === query.messageId) {
            storedStr = s
            msg = m
            break
          }
        } catch {}
      }

      if (!storedStr || !msg) {
        set.status = 404
        return { error: "not-found" }
      }
      // Only the author can delete their own message.
      if (msg.token !== auth.token) {
        set.status = 403
        return { error: "not-owner" }
      }

      await redis.lrem(keys.messages(roomId), 1, storedStr)

      // If it was a file message, drop the stored file too.
      if (msg.file?.fileId) {
        const fid = msg.file.fileId
        await Promise.all([
          redis.del(keys.fileBlob(roomId, fid)),
          redis.del(keys.fileMeta(roomId, fid)),
          redis.srem(keys.files(roomId), fid),
        ])
      }

      await publish(roomId, { event: "update" })
      return { ok: true }
    },
    {
      query: z.object({ roomId: z.string(), messageId: z.string() }),
    }
  )
  .get(
    "/",
    async ({ auth }) => {
      if (isDefaultRoom(auth.roomId)) await rollDefaultIfDue()
      const raw = await redis.lrange(keys.messages(auth.roomId), 0, -1)
      const messages = raw
        .map((s) => {
          try {
            return JSON.parse(s) as Message
          } catch {
            return null
          }
        })
        .filter((m): m is Message => m !== null)
        .map((m) => ({
          ...m,
          // Only reveal the token to its owner (used for "YOU" styling).
          token: m.token === auth.token ? auth.token : undefined,
        }))

      return { messages }
    },
    { query: z.object({ roomId: z.string() }) }
  )

const app = new Elysia({ prefix: "/api" })
  .error({ AuthError })
  .onError(({ code, error, set }) => {
    if (code === "AuthError" || (error instanceof Error && error.name === "AuthError")) {
      set.status = 401
      return { error: "Unauthorized" }
    }
  })
  .use(rooms)
  .use(messages)

export const GET = app.fetch
export const POST = app.fetch
export const DELETE = app.fetch

export type App = typeof app
