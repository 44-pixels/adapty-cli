#!/usr/bin/env node
import {homedir} from 'node:os'
import {join} from 'node:path'

import {startHttpServer} from '../dist/mcp/http.js'
import {createMcpServer} from '../dist/mcp/server.js'

const port = Number(process.env.ADAPTY_MCP_PORT ?? '3000')
const host = process.env.ADAPTY_MCP_HOST ?? '127.0.0.1'
const path = process.env.ADAPTY_MCP_PATH ?? '/mcp'

const server = createMcpServer({
  configDir: process.env.ADAPTY_CONFIG_DIR ?? join(homedir(), '.config', 'adapty'),
  version: '0.1.5',
})

const {url} = await startHttpServer({host, path, port, server})
process.stderr.write(`Adapty MCP listening on ${url}\n`)
