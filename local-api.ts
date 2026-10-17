import type { Plugin } from 'vite'
import { Readable } from 'node:stream'
/** Execute the existing Pages Function locally; no Cloudflare login or second process. */
export function localApi(): Plugin {
  return {
    name: 'quorum-local-api',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const controller = new AbortController()
        res.on('close', () => controller.abort())
        try {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 2_000_000) {
              res.statusCode = 413
              res.end()
              return
            }
            chunks.push(chunk)
          }
          const module = await server.ssrLoadModule('/functions/api/chat.ts')
          const request = new Request('http://localhost/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.concat(chunks).toString(),
            signal: controller.signal,
          })
          const response: Response = await module.onRequestPost({ request })
          res.writeHead(response.status, Object.fromEntries(response.headers))
          if (response.body) {
            const stream = Readable.fromWeb(
              response.body as Parameters<typeof Readable.fromWeb>[0],
            )
            stream.on('error', () => {
              controller.abort()
              if (!res.writableEnded) res.end()
            })
            stream.pipe(res)
          } else res.end()
        } catch {
          if (!res.headersSent) res.statusCode = 500
          res.end('Local proxy request failed.')
        }
      })
    },
  }
}
