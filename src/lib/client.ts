import { App } from "@/app/api/[[...slugs]]/route"
import { treaty } from "@elysiajs/eden"

// On the server, calls need an absolute URL; in the browser a relative one works.
const baseUrl =
  typeof window === "undefined"
    ? process.env.APP_URL || "http://localhost:3000"
    : window.location.origin

export const client = treaty<App>(baseUrl).api
