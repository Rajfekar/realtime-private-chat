import Redis, { type RedisOptions } from "ioredis"

/**
 * Standard RESP client for Valkey / Redis.
 *
 * Local dev  -> the Homebrew Valkey on 127.0.0.1:6379.
 * Production  -> your AWS ElastiCache Valkey (set REDIS_HOST/REDIS_TLS in env).
 *
 * We keep a single shared client for normal commands. Pub/Sub needs its own
 * dedicated connections (a subscribing connection can't run other commands),
 * so `createSubscriber()` hands out fresh ones for the SSE stream.
 */

export const REDIS_PREFIX = process.env.REDIS_PREFIX ?? "pchat:"

function baseOptions(): RedisOptions {
  const opts: RedisOptions = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    // Fail fast in dev instead of hanging if Valkey isn't up yet.
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  }
  if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD
  // ElastiCache with in-transit encryption enabled.
  if (process.env.REDIS_TLS === "1") opts.tls = {}
  return opts
}

// `keyPrefix` is applied automatically to every KEY command (get/set/hset/...),
// so this app's data is isolated on a shared instance. NOTE: ioredis does NOT
// apply keyPrefix to publish/subscribe channels — we prefix those by hand in
// realtime.ts via `channelName()`.
declare global {
  // Reuse the client across Next.js hot reloads in dev.
  // eslint-disable-next-line no-var
  var __pchatRedis: Redis | undefined
}

export const redis =
  global.__pchatRedis ??
  new Redis({ ...baseOptions(), keyPrefix: REDIS_PREFIX })

if (process.env.NODE_ENV !== "production") global.__pchatRedis = redis

redis.on("error", (err) => {
  // Don't crash the dev server on a transient Valkey blip; just log it.
  console.error("[valkey] connection error:", err.message)
})

/** A fresh connection dedicated to SUBSCRIBE (used by the SSE endpoint). */
export function createSubscriber(): Redis {
  return new Redis(baseOptions())
}
