"use client"

import { useUsername } from "@/hooks/use-username"
import { client } from "@/lib/client"
import { Message } from "@/lib/realtime"
import { useRealtime } from "@/lib/realtime-client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import Explosion from "@/components/explosion"
import { playBoom, playTick } from "@/lib/sound"
import { toast } from "sonner"

function formatTimeRemaining(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const RoomPage = () => {
  const params = useParams()
  const roomId = params.roomId as string

  const router = useRouter()

  const { username } = useUsername()
  const [input, setInput] = useState("")
  const [joined, setJoined] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [isDefault, setIsDefault] = useState(false)
  const [code, setCode] = useState("")
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [copyStatus, setCopyStatus] = useState("COPY")
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [exploding, setExploding] = useState(false)
  const blastedRef = useRef(false)

  // Detonate once: play the boom and show the blast overlay. Navigation home
  // happens when the animation finishes (Explosion's onDone).
  const detonate = useCallback(() => {
    if (blastedRef.current) return
    blastedRef.current = true
    playBoom()
    setExploding(true)
  }, [])

  // Stable so the Explosion's finish-timer isn't reset on every re-render.
  const goHome = useCallback(() => {
    router.push("/?destroyed=true")
  }, [router])

  // Join the room (assigns the auth-token cookie, enforces the 2-person cap).
  useEffect(() => {
    let cancelled = false
    const join = async () => {
      const res = await fetch(
        `/api/join?roomId=${encodeURIComponent(roomId)}`,
        { method: "POST" }
      )
      if (cancelled) return
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setJoined(true)
        setIsOwner(!!body.owner)
        setIsDefault(!!body.isDefault)
        setCode(body.code || "")
        return
      }
      router.push(`/?error=${body.error || "room-not-found"}`)
    }
    join()
    return () => {
      cancelled = true
    }
  }, [roomId, router])

  const { data: ttlData, refetch: refetchTtl } = useQuery({
    queryKey: ["ttl", roomId],
    enabled: joined,
    queryFn: async () => {
      const res = await client.room.ttl.get({ query: { roomId } })
      return res.data
    },
  })

  useEffect(() => {
    if (ttlData?.ttl === undefined) return
    setTimeRemaining(ttlData.ttl)
  }, [ttlData?.ttl])

  const { data: messages, refetch } = useQuery({
    queryKey: ["messages", roomId],
    enabled: joined,
    queryFn: async () => {
      const res = await client.messages.get({ query: { roomId } })
      return res.data?.messages || []
    },
  })

  // Ticking clock for the final 10 seconds (higher pitch in the last 3).
  // Skipped for the always-on room (it just clears, it doesn't detonate).
  useEffect(() => {
    if (timeRemaining === null || exploding || isDefault) return
    if (timeRemaining > 0 && timeRemaining <= 10) playTick(timeRemaining <= 3)
  }, [timeRemaining, exploding, isDefault])

  useEffect(() => {
    if (timeRemaining === null || timeRemaining < 0 || exploding) return

    if (timeRemaining === 0) {
      if (isDefault) {
        // Always-on room: wipe the view and pull the fresh window, don't destroy.
        refetchTtl()
        refetch()
        toast("Chat cleared", { icon: "🧹", duration: 2000 })
      } else {
        detonate()
      }
      return
    }

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [timeRemaining, detonate, exploding, isDefault, refetch, refetchTtl])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const { mutate: sendMessage, isPending } = useMutation({
    mutationFn: async ({ text }: { text: string }) => {
      await client.messages.post(
        { sender: username, text },
        { query: { roomId } }
      )
      setInput("")
    },
  })

  const uploadFile = (file: File) => {
    setUploadError(null)
    setUploading(true)
    setUploadPct(0)

    const toastId = toast.loading(`Uploading ${file.name} — 0%`)
    const form = new FormData()
    form.append("file", file)

    const finish = () => {
      setUploading(false)
      setUploadPct(0)
      if (fileRef.current) fileRef.current.value = ""
    }

    // XHR (not fetch) so we get real upload progress events.
    const xhr = new XMLHttpRequest()
    xhr.open(
      "POST",
      `/api/upload?roomId=${encodeURIComponent(roomId)}&sender=${encodeURIComponent(
        username
      )}`
    )

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return
      const pct = Math.round((e.loaded / e.total) * 100)
      setUploadPct(pct)
      toast.loading(`Uploading ${file.name} — ${pct}%`, { id: toastId })
    }

    xhr.onload = () => {
      finish()
      if (xhr.status >= 200 && xhr.status < 300) {
        toast.success(`Sent ${file.name}`, { id: toastId })
        refetch()
      } else {
        let msg = "Upload failed."
        try {
          const body = JSON.parse(xhr.responseText)
          if (body.error === "file-too-large")
            msg = `File too large (max ${formatBytes(body.maxBytes)}).`
          else if (body.error === "unsupported-type")
            msg = "Only images and PDF files are allowed."
        } catch {}
        setUploadError(msg)
        toast.error(msg, { id: toastId })
      }
    }

    xhr.onerror = () => {
      finish()
      const msg = "Upload failed. Check your connection."
      setUploadError(msg)
      toast.error(msg, { id: toastId })
    }

    xhr.send(form)
  }

  useRealtime({
    roomId,
    enabled: joined,
    onEvent: (event) => {
      if (event.event === "message" || event.event === "update") {
        refetch()
        // A manual clear of the always-on room also resets its countdown.
        if (isDefault && event.event === "update") refetchTtl()
      }
      if (event.event === "destroy") detonate()
    },
  })

  const { mutate: deleteMessage } = useMutation({
    mutationFn: async (messageId: string) => {
      await fetch(
        `/api/messages?roomId=${encodeURIComponent(roomId)}&messageId=${encodeURIComponent(
          messageId
        )}`,
        { method: "DELETE" }
      )
      refetch()
    },
  })

  const { mutate: destroyRoom } = useMutation({
    mutationFn: async () => {
      await client.room.delete(null, { query: { roomId } })
    },
    onSuccess: () => {
      if (isDefault) {
        refetch()
        refetchTtl()
        toast("Chat cleared", { icon: "🧹", duration: 2000 })
      } else {
        detonate()
      }
    },
  })

  const copyCode = () => {
    if (!code) return
    navigator.clipboard.writeText(code)
    setCopyStatus("COPIED!")
    setTimeout(() => setCopyStatus("COPY"), 2000)
  }

  return (
    <main className="flex flex-col h-dvh max-h-dvh overflow-hidden">
      {exploding && <Explosion onDone={goHome} />}
      <header className="border-b border-zinc-800 p-3 sm:p-4 flex items-center justify-between gap-2 sm:gap-4 bg-zinc-900/30">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] sm:text-xs text-zinc-500 uppercase">
              Room Code
            </span>
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="font-bold text-green-500 text-base sm:text-lg tracking-[0.2em] tabular-nums">
                {code || "······"}
              </span>
              <button
                onClick={copyCode}
                title="Copy room code"
                disabled={!code}
                className="text-[10px] shrink-0 bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                {copyStatus}
              </button>
            </div>
          </div>

          <div className="h-8 w-px bg-zinc-800 hidden sm:block" />

          <div className="flex flex-col shrink-0">
            <span className="text-[10px] sm:text-xs text-zinc-500 uppercase">
              <span className="hidden sm:inline">
                {isDefault ? "Auto-clear" : "Self-Destruct"}
              </span>
              <span className="sm:hidden">Timer</span>
            </span>
            <span
              className={`text-sm font-bold flex items-center gap-2 ${
                timeRemaining !== null && timeRemaining < 60
                  ? "text-red-500"
                  : "text-amber-500"
              }`}
            >
              {timeRemaining !== null
                ? formatTimeRemaining(timeRemaining)
                : "--:--"}
            </span>
          </div>
        </div>

        {(isDefault || isOwner) && (
          <button
            onClick={() => destroyRoom()}
            title={isDefault ? "Clear all chat now" : "Destroy room now"}
            className="text-xs shrink-0 bg-zinc-800 hover:bg-red-600 px-2.5 sm:px-3 py-1.5 rounded text-zinc-400 hover:text-white font-bold transition-all group flex items-center gap-1.5 sm:gap-2 disabled:opacity-50"
          >
            <span className="group-hover:animate-pulse">{isDefault ? "🧹" : "💣"}</span>
            <span className="hidden sm:inline">
              {isDefault ? "CLEAR CHAT" : "DESTROY NOW"}
            </span>
          </button>
        )}
      </header>

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages?.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-sm font-mono">
              No messages yet, start the conversation.
            </p>
          </div>
        )}

        {messages?.map((msg) => (
          <div key={msg.id} className="flex flex-col items-start">
            <div className="max-w-[80%] group">
              <div className="flex items-baseline gap-3 mb-1">
                <span
                  className={`text-xs font-bold ${
                    msg.sender === username ? "text-green-500" : "text-blue-500"
                  }`}
                >
                  {msg.sender === username ? "YOU" : msg.sender}
                </span>

                <span className="text-[10px] text-zinc-600">
                  {format(msg.timestamp, "HH:mm")}
                </span>

                {/* `token` is only present on the caller's own messages. */}
                {msg.token && (
                  <button
                    onClick={() => {
                      if (confirm("Delete this message?")) deleteMessage(msg.id)
                    }}
                    title="Delete message"
                    className="text-[10px] text-zinc-600 hover:text-red-500 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                  >
                    ✕ delete
                  </button>
                )}
              </div>

              {msg.file ? (
                <FileBubble roomId={roomId} file={msg.file} />
              ) : (
                <p className="text-sm text-zinc-300 leading-relaxed break-all">
                  {msg.text}
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {uploadError && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-950/40 border-t border-red-900">
          {uploadError}
        </div>
      )}

      {uploading && (
        <div className="px-4 pt-2 bg-zinc-900/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wide">
              Uploading…
            </span>
            <span className="text-[10px] text-green-400 font-bold tabular-nums">
              {uploadPct}%
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
            <div
              className="h-full bg-green-500 transition-[width] duration-150 ease-out"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
        <div className="flex gap-3 items-stretch">
          {/* Attach file */}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) uploadFile(f)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!joined || uploading}
            title="Attach image or PDF (max 10 MB)"
            className="bg-zinc-800 text-zinc-400 px-4 text-sm font-bold hover:text-zinc-200 transition-all disabled:opacity-50 cursor-pointer"
          >
            {uploading ? "..." : "📎"}
          </button>

          <div className="flex-1 relative group">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-green-500 animate-pulse">
              {">"}
            </span>
            <input
              autoFocus
              ref={inputRef}
              type="text"
              value={input}
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) {
                  sendMessage({ text: input })
                  inputRef.current?.focus()
                }
              }}
              placeholder="Type message..."
              onChange={(e) => setInput(e.target.value)}
              className="w-full bg-black border border-zinc-800 focus:border-zinc-700 focus:outline-none transition-colors text-zinc-100 placeholder:text-zinc-700 py-3 pl-8 pr-4 text-sm"
            />
          </div>

          <button
            onClick={() => {
              if (input.trim()) sendMessage({ text: input })
              inputRef.current?.focus()
            }}
            disabled={!input.trim() || isPending || !joined}
            className="bg-zinc-800 text-zinc-400 px-6 text-sm font-bold hover:text-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            SEND
          </button>
        </div>
      </div>
    </main>
  )
}

function FileBubble({
  roomId,
  file,
}: {
  roomId: string
  file: NonNullable<Message["file"]>
}) {
  const src = `/api/file?roomId=${encodeURIComponent(roomId)}&fileId=${file.fileId}`
  const isImage = file.type.startsWith("image/")

  return (
    <div className="border border-zinc-800 bg-zinc-950 p-2 rounded max-w-xs">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <a href={src} target="_blank" rel="noreferrer">
          <img
            src={src}
            alt={file.name}
            className="max-h-48 rounded object-contain"
          />
        </a>
      ) : (
        <div className="flex items-center gap-2 text-zinc-300 text-sm">
          <span>📄</span>
          <span className="truncate">{file.name}</span>
        </div>
      )}
      <div className="flex items-center justify-between mt-2 gap-3">
        <span className="text-[10px] text-zinc-600 truncate">
          {formatBytes(file.size)}
        </span>
        <a
          href={`${src}&download=1`}
          className="text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded text-zinc-400 hover:text-zinc-200"
        >
          DOWNLOAD
        </a>
      </div>
    </div>
  )
}

export default RoomPage
