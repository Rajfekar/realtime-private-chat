import { App } from "@/app/api/[[...slugs]]/route"
import { treaty } from "@elysiajs/eden"

export const client = treaty<App>(
  `${process.env.APP_URL || "realtime-private-chat-puce.vercel.app"}`
).api
