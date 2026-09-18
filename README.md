# private-chat

A private, self-destructing 1:1 chat room with small-file sharing, built on
**Valkey** (RESP) for storage + realtime.

## Why Valkey (not MySQL)

Everything here is ephemeral and time-boxed, which is exactly what an in-memory
store with native TTL and pub/sub is for:

- **Auto-clear** — every key is set with `EXPIRE`, so a room and all its
  messages/files vanish on their own at the destruction time. No cron cleanup.
- **Realtime** — Valkey `PUBLISH`/`SUBSCRIBE` streams new messages to browsers
  over Server-Sent Events. No polling, no extra broker.
- **Speed** — in-memory, sub-millisecond.

MySQL would be the wrong fit: no auto-expiry, no pub/sub, disk-persisted (the
opposite of "self-destructing").

> Originally scaffolded on Upstash (`@upstash/redis` REST + `@upstash/realtime`),
> which only talk to Upstash's cloud. Rewritten to `ioredis` + native pub/sub so
> it runs on any standard Valkey/Redis — your local one and your AWS ElastiCache.

## Features

- Private rooms capped at 2 participants (token cookie, enforced in `/api/join`).
- Text chat, realtime via SSE.
- Small file sharing — **images + PDF, up to 10 MB** — stored in Valkey with the
  same TTL as the room (`/api/upload`, `/api/file`).
- **Selectable self-destruct time at creation, up to 2 hours** (presets + custom
  minutes). The whole room self-destructs together, or instantly via DESTROY NOW.

## Local development

Needs a local Valkey (or Redis). On macOS:

```bash
brew install valkey
brew services start valkey      # starts on 127.0.0.1:6379
```

Then:

```bash
npm install
npm run dev                     # http://localhost:3000 (this repo runs it on 3005 via the parent launch.json)
```

Config lives in `.env.local` (see keys below).

## Production — reuse the existing ElastiCache Valkey

The Laravel app already runs an ElastiCache Valkey (`doctoradmission-valkey`).
This app can share it (low chat volume) — all its keys/channels are namespaced
with `REDIS_PREFIX` (`pchat:`) so they never collide with presence/queue/cache.

Important: that Valkey is **VPC-private** (reachable only from the app EC2
security group on 6379). So:

- Run this Next.js app **on the app EC2 / same VPC**, then set:

  ```
  REDIS_HOST=<doctoradmission-valkey primary endpoint>
  REDIS_PORT=6379
  # REDIS_TLS=1   # only if you enable in-transit encryption on the cluster
  ```

- You **cannot** reach that Valkey directly from a laptop. For local testing use
  a local Valkey (above), or an SSH tunnel through the EC2.

## Environment variables (`.env.local`)

| Key | Purpose | Default |
|-----|---------|---------|
| `REDIS_HOST` / `REDIS_PORT` | Valkey connection | `127.0.0.1` / `6379` |
| `REDIS_PASSWORD` | optional auth | — |
| `REDIS_TLS` | `1` for ElastiCache in-transit encryption | off |
| `REDIS_PREFIX` | key/channel namespace | `pchat:` |
| `ROOM_TTL_SECONDS` | default room lifetime | `600` |
| `MAX_TTL_SECONDS` | ceiling for the picker | `7200` (2h) |
| `MAX_FILE_BYTES` | per-file size cap | `10485760` (10 MB) |
| `APP_URL` | base URL for server-side calls | `http://localhost:3005` |

## Architecture

- `src/lib/redis.ts` — shared `ioredis` client (auto key-prefixed) + subscriber factory.
- `src/lib/realtime.ts` — message schema, `publish()` over Valkey pub/sub.
- `src/lib/rooms.ts` — keys, TTL refresh (`touchRoom`), purge, file limits, `clampTtl`.
- `src/app/api/realtime/route.ts` — SSE endpoint (subscribes to the room channel).
- `src/app/api/[[...slugs]]/route.ts` — Elysia API: room create/ttl/destroy, text messages.
- `src/app/api/join/route.ts` — room access + token cookie (replaces the old edge middleware).
- `src/app/api/upload/route.ts`, `src/app/api/file/route.ts` — file store/serve.
- `src/lib/realtime-client.ts` — `useRealtime` hook over `EventSource`.
