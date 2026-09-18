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
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
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
      if (res.ok) {
        setJoined(true)
        return
      }
      const body = await res.json().catch(() => ({}))
      router.push(`/?error=${body.error || "room-not-found"}`)
    }
    join()
    return () => {
      cancelled = true
    }
  }, [roomId, router])

  const { data: ttlData } = useQuery({
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

  // Ticking clock for the final 10 seconds (higher pitch in the last 3).
  useEffect(() => {
    if (timeRemaining === null || exploding) return
    if (timeRemaining > 0 && timeRemaining <= 10) playTick(timeRemaining <= 3)
  }, [timeRemaining, exploding])

  useEffect(() => {
    if (timeRemaining === null || timeRemaining < 0 || exploding) return

    if (timeRemaining === 0) {
      detonate()
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
  }, [timeRemaining, detonate, exploding])

  const { data: messages, refetch } = useQuery({
    queryKey: ["messages", roomId],
    enabled: joined,
    queryFn: async () => {
      const res = await client.messages.get({ query: { roomId } })
      return res.data?.messages || []
    },
  })

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

  const uploadFile = async (file: File) => {
    setUploadError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(
        `/api/upload?roomId=${encodeURIComponent(roomId)}&sender=${encodeURIComponent(
          username
        )}`,
        { method: "POST", body: form }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (body.error === "file-too-large")
          setUploadError(`File too large (max ${formatBytes(body.maxBytes)}).`)
        else if (body.error === "unsupported-type")
          setUploadError("Only images and PDF files are allowed.")
        else setUploadError("Upload failed.")
        return
      }
      refetch()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  useRealtime({
    roomId,
    enabled: joined,
    onEvent: (event) => {
      if (event.event === "message") refetch()
      if (event.event === "destroy") detonate()
    },
  })

  const { mutate: destroyRoom } = useMutation({
    mutationFn: async () => {
      await client.room.delete(null, { query: { roomId } })
    },
    onSuccess: () => detonate(),
  })

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopyStatus("COPIED!")
    setTimeout(() => setCopyStatus("COPY"), 2000)
  }

  const shareRoom = async () => {
    const url = window.location.href
    const text = `Join my private, self-destructing chat: ${url}`
    // Native share sheet (mobile) lists WhatsApp, Telegram, etc.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Private Chat", text, url })
        return
      } catch {
        // user cancelled or share failed — fall through to WhatsApp web
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank")
  }

  return (
    <main className="flex flex-col h-screen max-h-screen overflow-hidden">
      {exploding && <Explosion onDone={goHome} />}
      <header className="border-b border-zinc-800 p-4 flex items-center justify-between bg-zinc-900/30">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-xs text-zinc-500 uppercase">Room ID</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-green-500 truncate">
                {roomId.slice(0, 10) + "..."}
              </span>
              <button
                onClick={copyLink}
                className="text-[10px] bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {copyStatus}
              </button>
              <button
                onClick={shareRoom}
                className="text-[10px] bg-green-800/70 hover:bg-green-700 px-2 py-0.5 rounded text-green-100 transition-colors flex items-center gap-1"
              >
                🔗 SHARE
              </button>
            </div>
          </div>

          <div className="h-8 w-px bg-zinc-800" />

          <div className="flex flex-col">
            <span className="text-xs text-zinc-500 uppercase">
              Self-Destruct
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

        <button
          onClick={() => destroyRoom()}
          className="text-xs bg-zinc-800 hover:bg-red-600 px-3 py-1.5 rounded text-zinc-400 hover:text-white font-bold transition-all group flex items-center gap-2 disabled:opacity-50"
        >
          <span className="group-hover:animate-pulse">💣</span>
          DESTROY NOW
        </button>
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
