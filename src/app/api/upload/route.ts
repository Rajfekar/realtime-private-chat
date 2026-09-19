import { NextRequest, NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { redis } from "@/lib/redis"
import { Message, publish } from "@/lib/realtime"
import {
  MAX_FILE_BYTES,
  isDefaultRoom,
  keys,
  requireMember,
  rollDefaultIfDue,
  roomChatTtl,
  touchRoom,
} from "@/lib/rooms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/upload?roomId=xxx   (multipart/form-data: field "file")
 *
 * Stores a small file (image / PDF, <= MAX_FILE_BYTES) directly in Valkey as raw
 * bytes with the same TTL as the room, so it self-destructs with everything else.
 * Adds a chat message that references the file and broadcasts it in realtime.
 */
export async function POST(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId") ?? undefined
  const sender = req.nextUrl.searchParams.get("sender") || "anonymous"
  const token = req.cookies.get("x-auth-token")?.value

  try {
    await requireMember(roomId, token)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const room = roomId as string

  if (isDefaultRoom(room)) await rollDefaultIfDue()

  if (!(await redis.exists(keys.meta(room)))) {
    return NextResponse.json({ error: "room-not-found" }, { status: 404 })
  }

  const form = await req.formData()
  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no-file" }, { status: 400 })
  }

  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "file-too-large", maxBytes: MAX_FILE_BYTES },
      { status: 413 }
    )
  }

  // Any file type is allowed.
  const fileId = nanoid()
  const buffer = Buffer.from(await file.arrayBuffer())
  const ttl = await roomChatTtl(room)

  // Store raw bytes + metadata, and remember the id for TTL refresh / purge.
  await redis.set(keys.fileBlob(room, fileId), buffer, "EX", ttl)
  await redis.hset(keys.fileMeta(room, fileId), {
    name: file.name,
    type: file.type,
    size: String(file.size),
  })
  await redis.expire(keys.fileMeta(room, fileId), ttl)
  await redis.sadd(keys.files(room), fileId)

  const message: Message = {
    id: nanoid(),
    sender,
    text: "",
    timestamp: Date.now(),
    roomId: room,
    file: { fileId, name: file.name, type: file.type, size: file.size },
  }

  await redis.rpush(keys.messages(room), JSON.stringify({ ...message, token }))
  await publish(room, { event: "message", data: message })
  await touchRoom(room, ttl)

  return NextResponse.json({ ok: true, file: message.file })
}
