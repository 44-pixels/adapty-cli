#!/usr/bin/env node
/* eslint-disable import/no-unresolved */
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'

import {createMcpServer} from '../dist/mcp/server.js'

const server = createMcpServer({version: '0.1.5'})
const transport = new StdioServerTransport()
await server.connect(transport)
