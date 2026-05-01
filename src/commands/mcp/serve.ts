import {Command, Flags} from '@oclif/core'

import {startHttpServer} from '../../mcp/http.js'
import {createMcpServer} from '../../mcp/server.js'

export default class McpServe extends Command {
  static description = 'Start the Adapty MCP server (streamable HTTP transport). Tokens are resolved per request as: Authorization: Bearer header > ADAPTY_TOKEN env var > token persisted by `adapty auth login`.'
  static examples = [
    '<%= config.bin %> mcp serve',
    '<%= config.bin %> mcp serve --port 8080 --host 0.0.0.0',
  ]
  static flags = {
    host: Flags.string({
      default: '127.0.0.1',
      description: 'Host to bind to',
    }),
    path: Flags.string({
      default: '/mcp',
      description: 'URL path the MCP endpoint listens on',
    }),
    port: Flags.integer({
      default: 3000,
      description: 'Port to listen on',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(McpServe)

    const server = createMcpServer({
      configDir: this.config.configDir,
      version: this.config.version,
    })

    const {url} = await startHttpServer({
      host: flags.host,
      path: flags.path,
      port: flags.port,
      server,
    })

    this.log(`Adapty MCP listening on ${url}`)
    this.log('Auth precedence: Authorization: Bearer header > ADAPTY_TOKEN env > local config (`adapty auth login`).')
  }
}
