import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js' // eslint-disable-line import/no-unresolved
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js' // eslint-disable-line import/no-unresolved
import {createServer, IncomingMessage, ServerResponse} from 'node:http'

import {requestContext} from './server.js'

export interface HttpServerOptions {
  host: string
  // The MCP path prefix. Defaults to /mcp.
  path?: string
  port: number
  server: McpServer
}

const MAX_BODY_BYTES = 4 * 1024 * 1024

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body exceeds 4MB limit'))
        req.destroy()
        return
      }

      chunks.push(chunk)
    })

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }

      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid JSON'))
      }
    })

    req.on('error', reject)
  })
}

function parseBearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  if (!value) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match ? match[1].trim() : undefined
}

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({error: {code: status, message}}))
}

export async function startHttpServer(opts: HttpServerOptions): Promise<{close: () => Promise<void>; url: string}> {
  const path = opts.path ?? '/mcp'

  // Stateless: a fresh transport per request lets us scope the bearer token to
  // exactly the calls made on that connection without any cross-request leakage.
  const httpServer = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : 'Internal server error'
      if (res.headersSent) res.end()
      else sendJsonError(res, 500, message)
    })
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    if (url.pathname === '/healthz') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({status: 'ok'}))
      return
    }

    if (url.pathname !== path) {
      sendJsonError(res, 404, `Unknown path: ${url.pathname}`)
      return
    }

    const token = parseBearer(req.headers.authorization)

    let body: unknown
    if (req.method === 'POST') {
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendJsonError(res, 400, error instanceof Error ? error.message : 'Invalid request body')
        return
      }
    }

    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined})
    res.on('close', () => {
      transport.close().catch(() => { /* swallow close errors */ })
    })

    await opts.server.connect(transport)
    await requestContext.run({token}, async () => {
      await transport.handleRequest(req, res, body)
    })
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  const close = (): Promise<void> => new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

  return {close, url: `http://${opts.host}:${opts.port}${path}`}
}
