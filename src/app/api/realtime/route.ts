import { NextRequest } from "next/server"
import { createSubscriber } from "@/lib/redis"
import { channelName } from "@/lib/realtime"

// ioredis needs the Node.js runtime (raw TCP), not the Edge runtime.
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-Sent Events stream for one room.
 *
 * GET /api/realtime?roomId=xxx
 *
 * Opens a dedicated Valkey subscriber, forwards every published event on the
 * room channel to the browser, and tears the connection down when the client
 * disconnects. The roomId is a long random nanoid, so it acts as the secret.
 */
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId")
  if (!roomId) {
    return new Response("Missing roomId", { status: 400 })
  }

  const channel = channelName(roomId)
  const subscriber = createSubscriber()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload))
        } catch {
          // Controller already closed; ignore.
        }
      }

      // Initial comment + retry hint so EventSource reconnects sanely.
      send(`retry: 3000\n\n`)
      send(`: connected\n\n`)

      subscriber.on("message", (_ch, raw) => {
        // Each Valkey message is already a JSON RealtimeEvent.
        send(`data: ${raw}\n\n`)
      })

      // Heartbeat keeps proxies from closing an idle connection.
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25000)

      const cleanup = () => {
        clearInterval(heartbeat)
        subscriber.quit().catch(() => subscriber.disconnect())
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }

      req.signal.addEventListener("abort", cleanup)

      try {
        await subscriber.subscribe(channel)
      } catch (err) {
        console.error("[realtime] subscribe failed:", err)
        cleanup()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
