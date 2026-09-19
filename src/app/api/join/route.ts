import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { redis } from "@/lib/redis"
import {
  DEFAULT_CAPACITY,
  isDefaultRoom,
  keys,
  rollDefaultIfDue,
  touchRoom,
} from "@/lib/rooms"
import { parseConnected } from "@/app/api/[[...slugs]]/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/join?roomId=xxx
 *
 * Grants the caller access to a room and sets the httpOnly x-auth-token cookie.
 *
 * - Unknown room            -> 404 room-not-found
 * - Already a member        -> 200 ok (idempotent)
 * - Room at capacity        -> 403 room-full
 * - The always-on room      -> always 200, open to everyone (no capacity limit)
 */
export async function POST(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId")
  if (!roomId) {
    return NextResponse.json({ error: "missing-room-id" }, { status: 400 })
  }

  // The always-on room is created on demand and its chat is rolled if due.
  if (isDefaultRoom(roomId)) await rollDefaultIfDue()

  const exists = await redis.exists(keys.meta(roomId))
  if (!exists) {
    return NextResponse.json({ error: "room-not-found" }, { status: 404 })
  }

  const meta = await redis.hgetall(keys.meta(roomId))
  const connected = parseConnected(meta.connected)
  const code = meta.code || ""
  const capacity = Number(meta.capacity) || DEFAULT_CAPACITY
  const existingToken = req.cookies.get("x-auth-token")?.value

  // Cookie is secure only over HTTPS, so auth works on http (IP) and https (domain).
  const isHttps = (req.headers.get("x-forwarded-proto") || "http") === "https"
  const setCookie = (res: NextResponse, token: string) => {
    res.cookies.set("x-auth-token", token, {
      path: "/",
      httpOnly: true,
      secure: isHttps,
      sameSite: "strict",
    })
    return res
  }

  // The always-on room: open to anyone, no capacity limit, no owner.
  if (isDefaultRoom(roomId)) {
    const body = { ok: true, owner: false, code, isDefault: true }
    if (existingToken) return NextResponse.json(body)
    return setCookie(NextResponse.json(body), nanoid())
  }

  // Already allowed in. Owner = first slot (the creator).
  if (existingToken && connected.includes(existingToken)) {
    return NextResponse.json({
      ok: true,
      owner: connected[0] === existingToken,
      code,
      isDefault: false,
    })
  }

  // Room at capacity.
  if (connected.length >= capacity) {
    return NextResponse.json({ error: "room-full" }, { status: 403 })
  }

  // Admit a new member. First one in owns the room.
  const isOwner = connected.length === 0
  const token = nanoid()
  await redis.hset(keys.meta(roomId), {
    connected: JSON.stringify([...connected, token]),
  })
  await touchRoom(roomId)

  return setCookie(
    NextResponse.json({ ok: true, owner: isOwner, code, isDefault: false }),
    token
  )
}
