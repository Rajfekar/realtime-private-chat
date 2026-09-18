import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { redis } from "@/lib/redis"
import { keys, touchRoom } from "@/lib/rooms"
import { parseConnected } from "@/app/api/[[...slugs]]/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/join?roomId=xxx
 *
 * Grants the caller access to a room. Replaces the old edge-middleware proxy
 * (which never ran because there was no middleware.ts, and which used the
 * Upstash REST client that can't reach a normal Valkey).
 *
 * - Unknown room        -> 404 room-not-found
 * - Already a member    -> 200 ok (idempotent)
 * - Room already has 2  -> 403 room-full
 * - New second member   -> 200 ok, sets the httpOnly x-auth-token cookie
 */
export async function POST(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId")
  if (!roomId) {
    return NextResponse.json({ error: "missing-room-id" }, { status: 400 })
  }

  const exists = await redis.exists(keys.meta(roomId))
  if (!exists) {
    return NextResponse.json({ error: "room-not-found" }, { status: 404 })
  }

  const meta = await redis.hgetall(keys.meta(roomId))
  const connected = parseConnected(meta.connected)
  const code = meta.code || ""
  const existingToken = req.cookies.get("x-auth-token")?.value

  // Already allowed in. The owner is whoever holds the first slot (the creator,
  // who is the first to join right after creating the room).
  if (existingToken && connected.includes(existingToken)) {
    return NextResponse.json({
      ok: true,
      owner: connected[0] === existingToken,
      code,
    })
  }

  // Room at capacity (private 1:1 chat).
  if (connected.length >= 2) {
    return NextResponse.json({ error: "room-full" }, { status: 403 })
  }

  // Admit a new member. First one in owns the room.
  const isOwner = connected.length === 0
  const token = nanoid()
  await redis.hset(keys.meta(roomId), {
    connected: JSON.stringify([...connected, token]),
  })
  await touchRoom(roomId)

  // Mark the cookie secure only when the request actually came over HTTPS, so
  // it works both on the https domain and over plain http via the server IP.
  const isHttps = (req.headers.get("x-forwarded-proto") || "http") === "https"

  const res = NextResponse.json({ ok: true, owner: isOwner, code })
  res.cookies.set("x-auth-token", token, {
    path: "/",
    httpOnly: true,
    secure: isHttps,
    sameSite: "strict",
  })
  return res
}
