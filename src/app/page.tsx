"use client"

import { useUsername } from "@/hooks/use-username"
import { useMutation } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"

// Destruction-time presets (label -> seconds). Max is 2 hours.
const TTL_PRESETS = [
  { label: "10 min", seconds: 10 * 60 },
  { label: "30 min", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "2 hours", seconds: 120 * 60 },
]
const MAX_MINUTES = 120

const Page = () => {
  return (
    <Suspense>
      <Lobby />
    </Suspense>
  )
}

export default Page

function Lobby() {
  const { username } = useUsername()
  const router = useRouter()

  const searchParams = useSearchParams()
  const wasDestroyed = searchParams.get("destroyed") === "true"
  const error = searchParams.get("error")

  // Selected destruction time. `custom` holds minutes when the user types their own.
  const [seconds, setSeconds] = useState(TTL_PRESETS[0].seconds)
  const [customMin, setCustomMin] = useState("")
  const [password, setPassword] = useState("")
  const [authError, setAuthError] = useState<string | null>(null)

  const { mutate: createRoom, isPending } = useMutation({
    mutationFn: async ({ ttl, password }: { ttl: number; password: string }) => {
      setAuthError(null)
      const res = await fetch("/api/room/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttl, password }),
      })
      if (res.status === 401) {
        setAuthError("Incorrect password.")
        return
      }
      if (res.ok) {
        const data = (await res.json()) as { roomId: string }
        router.push(`/room/${data.roomId}`)
      } else {
        setAuthError("Could not create room. Try again.")
      }
    },
  })

  const applyCustom = (value: string) => {
    setCustomMin(value)
    const mins = Math.min(Math.max(parseInt(value || "0", 10), 1), MAX_MINUTES)
    if (Number.isFinite(mins) && mins > 0) setSeconds(mins * 60)
  }

  // Join an existing room by its 6-digit code (no URL needed).
  const [joinCode, setJoinCode] = useState("")
  const [joinError, setJoinError] = useState<string | null>(null)

  const { mutate: joinByCode, isPending: joining } = useMutation({
    mutationFn: async (code: string) => {
      setJoinError(null)
      const res = await fetch(`/api/room/resolve?code=${encodeURIComponent(code)}`)
      if (res.ok) {
        const data = (await res.json()) as { roomId: string }
        router.push(`/room/${data.roomId}`)
      } else if (res.status === 404) {
        setJoinError("No room with that code (it may have expired).")
      } else {
        setJoinError("Enter a valid 6-digit code.")
      }
    },
  })

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        {wasDestroyed && (
          <div className="bg-red-950/50 border border-red-900 p-4 text-center">
            <p className="text-red-500 text-sm font-bold">ROOM DESTROYED</p>
            <p className="text-zinc-500 text-xs mt-1">
              All messages were permanently deleted.
            </p>
          </div>
        )}
        {error === "room-not-found" && (
          <div className="bg-red-950/50 border border-red-900 p-4 text-center">
            <p className="text-red-500 text-sm font-bold">ROOM NOT FOUND</p>
            <p className="text-zinc-500 text-xs mt-1">
              This room may have expired or never existed.
            </p>
          </div>
        )}
        {error === "room-full" && (
          <div className="bg-red-950/50 border border-red-900 p-4 text-center">
            <p className="text-red-500 text-sm font-bold">ROOM FULL</p>
            <p className="text-zinc-500 text-xs mt-1">
              This room is at maximum capacity.
            </p>
          </div>
        )}

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-green-500">
            {">"}private_chat
          </h1>
          <p className="text-zinc-500 text-sm">
            A private, self-destructing chat room.
          </p>
        </div>

        <div className="border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="flex items-center text-zinc-500">
                Your Identity
              </label>

              <div className="flex items-center gap-3">
                <div className="flex-1 bg-zinc-950 border border-zinc-800 p-3 text-sm text-zinc-400 font-mono">
                  {username}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center text-zinc-500">
                Self-Destruct After
              </label>

              <div className="grid grid-cols-4 gap-2">
                {TTL_PRESETS.map((p) => (
                  <button
                    key={p.seconds}
                    onClick={() => {
                      setSeconds(p.seconds)
                      setCustomMin("")
                    }}
                    className={`p-2 text-xs font-bold border transition-colors ${
                      seconds === p.seconds && customMin === ""
                        ? "border-green-600 bg-green-950/40 text-green-400"
                        : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={MAX_MINUTES}
                  value={customMin}
                  onChange={(e) => applyCustom(e.target.value)}
                  placeholder="Custom minutes"
                  className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-zinc-700 focus:outline-none p-3 text-sm text-zinc-300 font-mono placeholder:text-zinc-700"
                />
                <span className="text-xs text-zinc-600">max {MAX_MINUTES}m</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center text-zinc-500">
                Creator Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && password) createRoom({ ttl: seconds, password })
                }}
                placeholder="Required to create a room"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-700 focus:outline-none p-3 text-sm text-zinc-300 font-mono placeholder:text-zinc-700"
              />
              {authError && (
                <p className="text-red-500 text-xs font-bold">{authError}</p>
              )}
            </div>

            <button
              onClick={() => createRoom({ ttl: seconds, password })}
              disabled={isPending || !password}
              className="w-full bg-zinc-100 text-black p-3 text-sm font-bold hover:bg-zinc-50 hover:text-black transition-colors mt-2 cursor-pointer disabled:opacity-50"
            >
              CREATE SECURE ROOM
            </button>
          </div>
        </div>

        {/* Join an existing room by code */}
        <div className="border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
          <div className="space-y-3">
            <label className="flex items-center text-zinc-500">
              Join a Room
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={joinCode}
                onChange={(e) => {
                  setJoinError(null)
                  setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && joinCode.length === 6) joinByCode(joinCode)
                }}
                placeholder="6-digit code"
                className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-zinc-700 focus:outline-none p-3 text-lg tracking-[0.4em] text-center text-zinc-100 font-mono placeholder:text-zinc-700 placeholder:tracking-normal placeholder:text-sm"
              />
              <button
                onClick={() => joinByCode(joinCode)}
                disabled={joining || joinCode.length !== 6}
                className="bg-green-700 hover:bg-green-600 text-white px-5 py-3 text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                JOIN
              </button>
            </div>
            {joinError && (
              <p className="text-red-500 text-xs font-bold">{joinError}</p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
