import { NextRequest, NextResponse } from "next/server"
import { redis } from "@/lib/redis"
import { keys, requireMember } from "@/lib/rooms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/file?roomId=xxx&fileId=yyy[&download=1]
 *
 * Streams a stored file back to a room member. `download=1` forces a Save dialog;
 * otherwise images render inline. Returns 404 once the file's TTL has expired.
 */
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId") ?? undefined
  const fileId = req.nextUrl.searchParams.get("fileId")
  const forceDownload = req.nextUrl.searchParams.get("download") === "1"
  const token = req.cookies.get("x-auth-token")?.value

  try {
    await requireMember(roomId, token)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const room = roomId as string

  if (!fileId) {
    return NextResponse.json({ error: "missing-file-id" }, { status: 400 })
  }

  const buffer = await redis.getBuffer(keys.fileBlob(room, fileId))
  if (!buffer) {
    return NextResponse.json({ error: "not-found-or-expired" }, { status: 404 })
  }

  const meta = await redis.hgetall(keys.fileMeta(room, fileId))
  const name = meta?.name || "file"
  const type = meta?.type || "application/octet-stream"
  const disposition = forceDownload ? "attachment" : "inline"

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(buffer.length),
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(name)}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
