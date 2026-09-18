import { redis } from "@/lib/redis"
import { Elysia } from "elysia"
import { nanoid } from "nanoid"
import { AuthError, authMiddleware } from "./auth"
import { z } from "zod"
import { Message, publish } from "@/lib/realtime"
import { ROOM_TTL_SECONDS, clampTtl, keys, purgeRoom, touchRoom } from "@/lib/rooms"

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

      await redis.hset(keys.meta(roomId), {
        connected: JSON.stringify([]),
        createdAt: Date.now(),
      })
      await redis.expire(keys.meta(roomId), ttl)

      return { roomId, ttl }
    },
    {
      body: z.object({
        ttl: z.number().int().optional(),
        password: z.string().max(200).optional(),
      }),
    }
  )
  .use(authMiddleware)
  .get(
    "/ttl",
    async ({ auth }) => {
      const ttl = await redis.ttl(keys.meta(auth.roomId))
      return { ttl: ttl > 0 ? ttl : 0 }
    },
    { query: z.object({ roomId: z.string() }) }
  )
  .delete(
    "/",
    async ({ auth }) => {
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

      // Re-arm the self-destruct timer.
      const remaining = await redis.ttl(keys.meta(roomId))
      await touchRoom(roomId, remaining > 0 ? remaining : ROOM_TTL_SECONDS)

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
  .get(
    "/",
    async ({ auth }) => {
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
