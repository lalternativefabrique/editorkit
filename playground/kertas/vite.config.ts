import { spawn } from "node:child_process"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const meta = (html: string, keys: string[]) => {
  for (const key of keys) {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"))?.[0]
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1]
    if (content) return content.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
  }
  return ""
}

/** The playground has no core: its dev server reads a page's Open Graph tags, as the core does in the app. */
function linkPreviews(): Plugin {
  return {
    name: "kertas-link-previews",
    configureServer(server) {
      server.middlewares.use("/__preview", async (req, res) => {
        const target = new URL(req.url ?? "", "http://localhost").searchParams.get("url") ?? ""
        try {
          const url = new URL(target)
          if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("http(s) only")
          const page = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kertas-playground)", Accept: "text/html" }, signal: AbortSignal.timeout(8000) })
          const html = (await page.text()).slice(0, 1_000_000)
          const head = html.split(/<body[\s>]/i)[0]
          const image = meta(head, ["og:image", "og:image:url", "twitter:image"])
          const card = {
            title: meta(head, ["og:title", "twitter:title"]) || head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "",
            description: meta(head, ["og:description", "twitter:description", "description"]),
            image: image ? new URL(image, page.url).href : "",
            site: meta(head, ["og:site_name"]) || new URL(page.url).hostname.replace(/^www\./, ""),
          }
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify(card))
        } catch (error) {
          res.statusCode = 422
          res.end(JSON.stringify({ error: String(error) }))
        }
      })
    },
  }
}

const crates = new URL("../../kertas/crates/", import.meta.url).pathname
const buildWasm = new URL("../../kertas/build-wasm.sh", import.meta.url).pathname

function rebuildWasmOnRustChange(): Plugin {
  let building: Promise<boolean> | null = null
  let again = false
  const build = (): Promise<boolean> =>
    new Promise((resolve) => {
      const child = spawn(buildWasm, { stdio: "inherit" })
      child.on("close", (code) => resolve(code === 0))
    })
  return {
    name: "kertas-rebuild-wasm",
    configureServer(server) {
      server.watcher.add(crates)
      server.watcher.on("change", async (file) => {
        if (!file.startsWith(crates) || !file.endsWith(".rs")) return
        if (building) {
          again = true
          return
        }
        do {
          again = false
          building = build()
          const ok = await building
          building = null
          if (ok) server.ws.send({ type: "full-reload" })
          else server.config.logger.error("kertas.wasm did not build, the page keeps the previous engine")
        } while (again)
      })
    },
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), linkPreviews(), rebuildWasmOnRustChange()],
  server: { port: 5199, host: "127.0.0.1" },
  optimizeDeps: { include: ["pdfjs-dist"] },
})
