import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js' // eslint-disable-line import/no-unresolved
import {Command} from '@oclif/core'

import {createMcpServer} from '../../mcp/server.js'

export default class McpServe extends Command {
  static description = 'Start the Adapty MCP server (stdio transport). Use this with Claude Code, Cursor, or any MCP-compatible client.'
  static examples = [
    '<%= config.bin %> mcp serve',
    'Add to Claude Code: npx -y github:44-pixels/adapty-cli adapty mcp serve',
  ]

  async run(): Promise<void> {
    await this.parse(McpServe)

    const server = createMcpServer({
      configDir: this.config.configDir,
      version: this.config.version,
    })

    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}
