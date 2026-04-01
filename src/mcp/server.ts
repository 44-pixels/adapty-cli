import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js' // eslint-disable-line import/no-unresolved
import {z} from 'zod'

import {AnalyticsClient} from '../lib/analytics-client.js'
import {ApiClient} from '../lib/api-client.js'
import {resolveToken} from '../lib/auth.js'
import {readConfig, writeConfig} from '../lib/config.js'
import {ApiError, AuthRequiredError, NetworkError} from '../lib/errors.js'

interface ServerOptions {
  configDir?: string
  version: string
}

async function createClient(configDir?: string): Promise<ApiClient> {
  const token = await resolveToken(configDir)
  if (!token) throw new AuthRequiredError()
  return new ApiClient({token, userAgent: 'adapty-cli/mcp'})
}

async function createAnalyticsClient(apiClient: ApiClient, appId: string): Promise<AnalyticsClient> {
  const app = await apiClient.get<{secret_key: string}>(`/apps/${appId}`)
  return new AnalyticsClient({apiKey: app.secret_key})
}

function formatError(error: unknown): string {
  if (error instanceof AuthRequiredError) {
    return 'Not authenticated. Use the auth_login tool to authenticate, or set the ADAPTY_TOKEN environment variable.'
  }

  if (error instanceof ApiError) {
    return error.toHuman()
  }

  if (error instanceof NetworkError) {
    return error.toHuman()
  }

  return error instanceof Error ? error.message : String(error)
}

function toolResult(data: unknown): {content: [{text: string, type: 'text'}]} {
  return {content: [{text: JSON.stringify(data, null, 2), type: 'text'}]}
}

function toolError(message: string): {content: [{text: string, type: 'text'}], isError: true} {
  return {content: [{text: message, type: 'text'}], isError: true}
}

// Shared filter fields used by all analytics tools
const analyticsFilterSchema = {
  country: z.string().optional().describe('Filter by 2-letter country codes (comma-separated)'),
  date: z.array(z.string()).describe('Date range: [start, end] in YYYY-MM-DD format'),
  format: z.enum(['json', 'csv']).optional().describe('Export format (default: json)'),
  period_unit: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional().describe('Time interval for aggregation (default: month)'),
  store: z.string().optional().describe('Filter by stores (comma-separated, e.g. app_store,play_store)'),
  store_product_id: z.string().optional().describe('Filter by store product IDs (comma-separated)'),
}

function buildFilters(params: {country?: string; date: string[]; store?: string; store_product_id?: string}): Record<string, unknown> {
  const filters: Record<string, unknown> = {date: params.date}
  if (params.country) filters.country = params.country.split(',').map((c) => c.trim())
  if (params.store) filters.store = params.store.split(',').map((s) => s.trim())
  if (params.store_product_id) filters.store_product_id = params.store_product_id.split(',').map((s) => s.trim())
  return filters
}

export function createMcpServer(opts: ServerOptions): McpServer {
  const {configDir, version} = opts
  const server = new McpServer(
    {name: 'adapty', version},
    {
      instructions: [
        'Adapty MCP Server — manage mobile subscription infrastructure via the Adapty Developer API.',
        '',
        'AUTHENTICATION: Before calling any tools, ensure you are authenticated.',
        '- If ADAPTY_TOKEN env var is set, it will be used automatically.',
        '- Otherwise, use the auth_login tool to authenticate via browser (OAuth device flow).',
        '- Use auth_status to check current authentication state.',
        '',
        'WORKFLOW: Most tools require an app_id (UUID). Use apps_list first to discover app IDs.',
        '',
        'RESOURCES:',
        '- Apps: list, get, create, update — manage your Adapty applications',
        '- Products: list, get, create, update — subscription and in-app products',
        '- Access Levels: list, get, create, update — premium content access tiers',
        '- Paywalls: list, get, create, update — paywall configurations',
        '- Placements: list, get, create, update — where paywalls appear in your app',
        '- Analytics: revenue, MRR, ARR, cohorts, funnels, LTV, retention, conversions',
      ].join('\n'),
    },
  )

  // ─── AUTH TOOLS ──────────────────────────────────────────────────────

  server.registerTool(
    'auth_login',
    {
      description: 'Authenticate with Adapty via browser-based OAuth device flow. Opens a browser window for authorization. Returns the verification URL and user code — the user must complete authorization in the browser.',
      title: 'Login',
    },
    async () => {
      const config = await readConfig(configDir)
      if (config.access_token && config.user) {
        return toolResult({message: `Already authenticated as ${config.user.email}`, status: 'already_authenticated'})
      }

      const client = new ApiClient({userAgent: 'adapty-cli/mcp'})

      try {
        const device = await client.post<{
          device_code: string
          expires_in: number
          interval_seconds: number
          user_code: string
          verification_uri: string
          verification_uri_complete: string
        }>('/auth/device', {client_id: 'adapty-cli'})

        // Poll for the token
        const interval = Math.max((device.interval_seconds || 5) * 1000, 5000)
        const deadline = Date.now() + device.expires_in * 1000

        const pollForToken = async (): Promise<{email: string; status: string} | {error: string; status: string}> => {
          while (Date.now() < deadline) {
            await new Promise((resolve) => {
              setTimeout(resolve, interval)
            })

            try {
              const result = await client.post<{access_token: string; user: {email: string; name: string}} | {error: string}>('/auth/token', {
                client_id: 'adapty-cli',
                device_code: device.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              })

              if ('access_token' in result) {
                await writeConfig({access_token: result.access_token, user: result.user}, configDir)
                return {email: result.user.email, status: 'authenticated'}
              }
            } catch (error) {
              if (error instanceof ApiError) {
                if (error.errorCode === 'authorization_pending') continue
                if (error.errorCode === 'slow_down') continue
                if (error.errorCode === 'access_denied') return {error: 'Authorization denied by user', status: 'denied'}
                if (error.errorCode === 'expired_token') return {error: 'Code expired', status: 'expired'}
              }
            }
          }

          return {error: 'Code expired', status: 'expired'}
        }

        const result = await pollForToken()
        if ('error' in result) {
          return toolError(result.error)
        }

        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'auth_status',
    {
      description: 'Check current authentication state (local only — does not call the API)',
      title: 'Auth Status',
    },
    async () => {
      const config = await readConfig(configDir)
      if (!config.access_token || !config.user) {
        return toolResult({authenticated: false, message: 'Not authenticated. Use auth_login to authenticate.'})
      }

      return toolResult({
        authenticated: true,
        email: config.user.email,
        token_prefix: config.access_token.slice(0, 8),
      })
    },
  )

  server.registerTool(
    'auth_whoami',
    {
      description: 'Verify authentication and show current user info from the Adapty server',
      title: 'Who Am I',
    },
    async () => {
      try {
        const client = await createClient(configDir)
        const me = await client.get<Record<string, unknown>>('/me')
        return toolResult(me)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'auth_logout',
    {
      annotations: {destructiveHint: true},
      description: 'Remove stored authentication token locally. The token remains valid server-side until expiry.',
      title: 'Logout',
    },
    async () => {
      const config = await readConfig(configDir)
      if (!config.access_token) {
        return toolResult({status: 'not_authenticated'})
      }

      await writeConfig({}, configDir)
      return toolResult({status: 'logged_out'})
    },
  )

  server.registerTool(
    'auth_revoke',
    {
      annotations: {destructiveHint: true},
      description: 'Revoke the current authentication token server-side and remove it locally',
      title: 'Revoke Token',
    },
    async () => {
      try {
        const config = await readConfig(configDir)
        if (!config.access_token) {
          return toolResult({status: 'not_authenticated'})
        }

        const client = await createClient(configDir)
        await client.post('/auth/tokens/revoke', {token: config.access_token})
        await writeConfig({}, configDir)
        return toolResult({status: 'revoked'})
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  // ─── APPS TOOLS ──────────────────────────────────────────────────────

  server.registerTool(
    'apps_list',
    {
      description: 'List all Adapty apps. Returns app IDs needed for other commands.',
      inputSchema: {
        page: z.number().int().min(1).default(1).describe('Page number'),
        page_size: z.number().int().min(1).max(100).default(20).describe('Items per page (max 100)'),
      },
      title: 'List Apps',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get('/apps', {'page[number]': String(args.page), 'page[size]': String(args.page_size)})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'apps_get',
    {
      description: 'Get details for a specific Adapty app including SDK key, secret key, platforms, and bundle IDs',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
      },
      title: 'Get App',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}`)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'apps_create',
    {
      description: 'Create a new Adapty app. Requires a title and at least one platform. Bundle IDs are required for each platform specified.',
      inputSchema: {
        apple_bundle_id: z.string().optional().describe('Apple bundle ID (required if platforms includes "ios")'),
        google_bundle_id: z.string().optional().describe('Google bundle ID (required if platforms includes "android")'),
        platforms: z.array(z.enum(['ios', 'android'])).min(1).describe('Target platforms'),
        title: z.string().describe('App title'),
      },
      title: 'Create App',
    },
    async (args) => {
      try {
        if (args.platforms.includes('ios') && !args.apple_bundle_id) {
          return toolError('apple_bundle_id is required when platforms includes "ios"')
        }

        if (args.platforms.includes('android') && !args.google_bundle_id) {
          return toolError('google_bundle_id is required when platforms includes "android"')
        }

        const client = await createClient(configDir)
        const body: Record<string, unknown> = {platforms: args.platforms, title: args.title}
        if (args.apple_bundle_id) body.apple_bundle_id = args.apple_bundle_id
        if (args.google_bundle_id) body.google_bundle_id = args.google_bundle_id

        const result = await client.post<{id: string}>('/apps', body)

        // Fetch default access level
        let accessLevels: unknown
        try {
          accessLevels = await client.get(`/apps/${result.id}/access-levels`)
        } catch {
          // non-critical
        }

        return toolResult({access_levels: accessLevels, app: result})
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'apps_update',
    {
      description: 'Update an existing Adapty app. At least one field (title, apple_bundle_id, or google_bundle_id) must be provided.',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        apple_bundle_id: z.string().optional().describe('New Apple bundle ID'),
        google_bundle_id: z.string().optional().describe('New Google bundle ID'),
        title: z.string().optional().describe('New app title'),
      },
      title: 'Update App',
    },
    async (args) => {
      try {
        if (!args.title && !args.apple_bundle_id && !args.google_bundle_id) {
          return toolError('At least one of title, apple_bundle_id, or google_bundle_id is required')
        }

        const client = await createClient(configDir)
        const body: Record<string, unknown> = {}
        if (args.title) body.title = args.title
        if (args.apple_bundle_id) body.apple_bundle_id = args.apple_bundle_id
        if (args.google_bundle_id) body.google_bundle_id = args.google_bundle_id

        const result = await client.put(`/apps/${args.app_id}`, body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  // ─── PRODUCTS TOOLS ──────────────────────────────────────────────────

  server.registerTool(
    'products_list',
    {
      description: 'List products for an Adapty app',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        page: z.number().int().min(1).default(1).describe('Page number'),
        page_size: z.number().int().min(1).max(100).default(20).describe('Items per page (max 100)'),
      },
      title: 'List Products',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/products`, {'page[number]': String(args.page), 'page[size]': String(args.page_size)})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'products_get',
    {
      description: 'Get details for a specific product including access level, period, and vendor product mappings',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        product_id: z.string().uuid().describe('Product ID (UUID)'),
      },
      title: 'Get Product',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/products/${args.product_id}`)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'products_create',
    {
      description: 'Create a new product with vendor products per platform. At least one of ios_product_id or android_product_id is required. For Android subscriptions (non-lifetime), android_base_plan_id is also required.',
      inputSchema: {
        access_level_id: z.string().uuid().describe('Access level ID (UUID)'),
        android_base_plan_id: z.string().optional().describe('Android base plan ID (required with android_product_id for subscriptions)'),
        android_product_id: z.string().optional().describe('Android product ID'),
        app_id: z.string().uuid().describe('App ID (UUID)'),
        ios_product_id: z.string().optional().describe('iOS product ID'),
        period: z.enum(['weekly', 'monthly', 'two_months', 'trimonthly', 'semiannual', 'annual', 'lifetime']).describe('Subscription period'),
        title: z.string().describe('Product title'),
      },
      title: 'Create Product',
    },
    async (args) => {
      try {
        if (!args.ios_product_id && !args.android_product_id) {
          return toolError('At least one of ios_product_id or android_product_id is required')
        }

        if (args.android_product_id && !args.android_base_plan_id && args.period !== 'lifetime') {
          return toolError('android_base_plan_id is required with android_product_id for subscriptions')
        }

        const client = await createClient(configDir)
        const body: Record<string, unknown> = {access_level_id: args.access_level_id, period: args.period, title: args.title}
        if (args.ios_product_id) body.ios_product_id = args.ios_product_id
        if (args.android_product_id) body.android_product_id = args.android_product_id
        if (args.android_base_plan_id) body.android_base_plan_id = args.android_base_plan_id

        const result = await client.post(`/apps/${args.app_id}/products`, body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'products_update',
    {
      description: 'Update a product (title and access level)',
      inputSchema: {
        access_level_id: z.string().uuid().describe('New access level ID (UUID)'),
        app_id: z.string().uuid().describe('App ID (UUID)'),
        product_id: z.string().uuid().describe('Product ID (UUID)'),
        title: z.string().describe('New product title'),
      },
      title: 'Update Product',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.put(`/apps/${args.app_id}/products/${args.product_id}`, {
          access_level_id: args.access_level_id,
          title: args.title,
        })
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  // ─── ACCESS LEVELS TOOLS ─────────────────────────────────────────────

  server.registerTool(
    'access_levels_list',
    {
      description: 'List access levels for an Adapty app',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        page: z.number().int().min(1).default(1).describe('Page number'),
        page_size: z.number().int().min(1).max(100).default(20).describe('Items per page (max 100)'),
      },
      title: 'List Access Levels',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/access-levels`, {'page[number]': String(args.page), 'page[size]': String(args.page_size)})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'access_levels_get',
    {
      description: 'Get details for a specific access level',
      inputSchema: {
        access_level_id: z.string().uuid().describe('Access level ID (UUID)'),
        app_id: z.string().uuid().describe('App ID (UUID)'),
      },
      title: 'Get Access Level',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/access-levels/${args.access_level_id}`)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'access_levels_create',
    {
      description: 'Create a custom access level for an app',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        sdk_id: z.string().describe('SDK identifier for the access level'),
        title: z.string().describe('Access level title'),
      },
      title: 'Create Access Level',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.post(`/apps/${args.app_id}/access-levels`, {sdk_id: args.sdk_id, title: args.title})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'access_levels_update',
    {
      description: 'Update an access level title',
      inputSchema: {
        access_level_id: z.string().uuid().describe('Access level ID (UUID)'),
        app_id: z.string().uuid().describe('App ID (UUID)'),
        title: z.string().describe('New access level title'),
      },
      title: 'Update Access Level',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.put(`/apps/${args.app_id}/access-levels/${args.access_level_id}`, {title: args.title})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  // ─── PAYWALLS TOOLS ──────────────────────────────────────────────────

  server.registerTool(
    'paywalls_list',
    {
      description: 'List paywalls for an Adapty app',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        page: z.number().int().min(1).default(1).describe('Page number'),
        page_size: z.number().int().min(1).max(100).default(20).describe('Items per page (max 100)'),
      },
      title: 'List Paywalls',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/paywalls`, {'page[number]': String(args.page), 'page[size]': String(args.page_size)})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'paywalls_get',
    {
      description: 'Get details for a specific paywall including its product list',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        paywall_id: z.string().uuid().describe('Paywall ID (UUID)'),
      },
      title: 'Get Paywall',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/paywalls/${args.paywall_id}`)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'paywalls_create',
    {
      description: 'Create a paywall with a list of products',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        product_ids: z.array(z.string().uuid()).min(1).describe('Product IDs (UUIDs)'),
        title: z.string().describe('Paywall title'),
      },
      title: 'Create Paywall',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.post(`/apps/${args.app_id}/paywalls`, {product_ids: args.product_ids, title: args.title})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'paywalls_update',
    {
      description: 'Update a paywall title and product list',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        paywall_id: z.string().uuid().describe('Paywall ID (UUID)'),
        product_ids: z.array(z.string().uuid()).min(1).describe('Product IDs (UUIDs)'),
        title: z.string().describe('New paywall title'),
      },
      title: 'Update Paywall',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.put(`/apps/${args.app_id}/paywalls/${args.paywall_id}`, {
          product_ids: args.product_ids,
          title: args.title,
        })
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  // ─── PLACEMENTS TOOLS ────────────────────────────────────────────────

  server.registerTool(
    'placements_list',
    {
      description: 'List placements for an Adapty app',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        page: z.number().int().min(1).default(1).describe('Page number'),
        page_size: z.number().int().min(1).max(100).default(20).describe('Items per page (max 100)'),
      },
      title: 'List Placements',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/placements`, {'page[number]': String(args.page), 'page[size]': String(args.page_size)})
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'placements_get',
    {
      description: 'Get details for a specific placement including its paywall',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        placement_id: z.string().uuid().describe('Placement ID (UUID)'),
      },
      title: 'Get Placement',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.get(`/apps/${args.app_id}/placements/${args.placement_id}`)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'placements_create',
    {
      description: 'Create a placement that links a paywall to a location in your app',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        developer_id: z.string().describe('Developer ID for the placement (used in SDK)'),
        paywall_id: z.string().uuid().describe('Paywall ID (UUID)'),
        title: z.string().describe('Placement title'),
      },
      title: 'Create Placement',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.post(`/apps/${args.app_id}/placements`, {
          developer_id: args.developer_id,
          paywall_id: args.paywall_id,
          title: args.title,
        })
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'placements_update',
    {
      description: 'Update a placement',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        developer_id: z.string().describe('Developer ID for the placement'),
        paywall_id: z.string().uuid().describe('Paywall ID (UUID)'),
        placement_id: z.string().uuid().describe('Placement ID (UUID)'),
        title: z.string().describe('New placement title'),
      },
      title: 'Update Placement',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const result = await client.put(`/apps/${args.app_id}/placements/${args.placement_id}`, {
          developer_id: args.developer_id,
          paywall_id: args.paywall_id,
          title: args.title,
        })
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  // ─── ANALYTICS TOOLS ─────────────────────────────────────────────────

  server.registerTool(
    'analytics_data',
    {
      description: 'Fetch analytics chart data for an app. Provides metrics like revenue, MRR, ARR, ARPPU, ARPU, subscriptions, trials, refunds, installs, and more.',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        attribution_source: z.string().optional().describe('Filter by attribution sources (comma-separated)'),
        chart_id: z.enum([
          'revenue', 'mrr', 'arr', 'arppu', 'arpu', 'subscriptions_active', 'subscriptions_new',
          'subscriptions_renewal_cancelled', 'subscriptions_expired', 'trials_active', 'trials_new',
          'trials_renewal_cancelled', 'trials_expired', 'grace_period', 'billing_issue',
          'refund_events', 'refund_money', 'non_subscriptions', 'installs',
        ]).describe('Chart/metric type'),
        date_type: z.enum(['purchase_date', 'profile_install_date']).optional().describe('Date attribution method (default: purchase_date)'),
        segmentation: z.string().optional().describe('Dimension to segment results by'),
        ...analyticsFilterSchema,
      },
      title: 'Analytics Data',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const analyticsClient = await createAnalyticsClient(client, args.app_id)
        const filters = buildFilters(args)
        if (args.attribution_source) {
          (filters as Record<string, unknown>).attribution_source = args.attribution_source.split(',').map((s) => s.trim())
        }

        const body: Record<string, unknown> = {chart_id: args.chart_id, filters}
        if (args.period_unit) body.period_unit = args.period_unit
        if (args.date_type) body.date_type = args.date_type
        if (args.segmentation) body.segmentation = args.segmentation
        if (args.format) body.format = args.format

        const result = await analyticsClient.post('/metrics/analytics', body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'analytics_cohort',
    {
      description: 'Fetch cohort tracking data to analyze how user groups perform over time. Useful for understanding subscriber retention and revenue patterns.',
      inputSchema: {
        accounting_type: z.enum(['revenue', 'proceeds', 'net_revenue']).optional().describe('Revenue calculation method (default: revenue)'),
        app_id: z.string().uuid().describe('App ID (UUID)'),
        period_type: z.enum(['renewals', 'days']).optional().describe('Cohort period type (default: renewals)'),
        prediction_months: z.number().int().optional().describe('Months to predict (3, 6, 9, 12, 18, or 24)'),
        renewal_days: z.string().optional().describe('Days since install for period_type=days (comma-separated integers)'),
        value_field: z.enum(['revenue', 'arppu', 'arpu', 'arpas', 'subscribers', 'subscriptions']).optional().describe('Metric to display (default: revenue)'),
        value_type: z.enum(['absolute', 'relative']).optional().describe('Show absolute or relative values (default: absolute)'),
        ...analyticsFilterSchema,
      },
      title: 'Analytics Cohort',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const analyticsClient = await createAnalyticsClient(client, args.app_id)
        const filters = buildFilters(args)

        const body: Record<string, unknown> = {filters}
        if (args.period_unit) body.period_unit = args.period_unit
        if (args.period_type) body.period_type = args.period_type
        if (args.value_type) body.value_type = args.value_type
        if (args.value_field) body.value_field = args.value_field
        if (args.accounting_type) body.accounting_type = args.accounting_type
        if (args.renewal_days) body.renewal_days = args.renewal_days.split(',').map((d) => Number.parseInt(d.trim(), 10))
        if (args.prediction_months !== undefined) body.prediction_months = args.prediction_months
        if (args.format) body.format = args.format

        const result = await analyticsClient.post('/metrics/cohort', body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'analytics_conversion',
    {
      description: 'Fetch conversion rate metrics between subscription lifecycle stages. Measures transitions like install→trial, trial→paid, or paid→renewal.',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        date_type: z.enum(['purchase_date', 'profile_install_date']).optional().describe('Date attribution method (default: purchase_date)'),
        from_period: z.string().optional().describe('Starting lifecycle stage: omit for install, "0" for trial, "1"+ for renewal'),
        segmentation: z.string().optional().describe('Dimension to segment results by'),
        to_period: z.string().describe('Target lifecycle stage: "0" for trial, "1" for first paid, "2"+ for renewal'),
        ...analyticsFilterSchema,
      },
      title: 'Analytics Conversion',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const analyticsClient = await createAnalyticsClient(client, args.app_id)
        const filters = buildFilters(args)

        const body: Record<string, unknown> = {filters, from_period: args.from_period ?? null, to_period: args.to_period}
        if (args.period_unit) body.period_unit = args.period_unit
        if (args.date_type) body.date_type = args.date_type
        if (args.segmentation) body.segmentation = args.segmentation
        if (args.format) body.format = args.format

        const result = await analyticsClient.post('/metrics/conversion', body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'analytics_funnel',
    {
      description: 'Fetch funnel progression analytics showing conversion through stages: install → paywall view → trial → paid subscription',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        segmentation: z.string().optional().describe('Dimension to segment results by'),
        show_value_as: z.enum(['absolute', 'relative', 'both']).optional().describe('Display values as absolute, relative percentages, or both'),
        ...analyticsFilterSchema,
      },
      title: 'Analytics Funnel',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const analyticsClient = await createAnalyticsClient(client, args.app_id)
        const filters = buildFilters(args)

        const body: Record<string, unknown> = {filters}
        if (args.period_unit) body.period_unit = args.period_unit
        if (args.show_value_as) body.show_value_as = args.show_value_as
        if (args.segmentation) body.segmentation = args.segmentation
        if (args.format) body.format = args.format

        const result = await analyticsClient.post('/metrics/funnel', body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'analytics_ltv',
    {
      description: 'Fetch lifetime value (LTV) metrics showing revenue per subscriber over time',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        period_type: z.enum(['renewals', 'days']).optional().describe('LTV period type (default: renewals)'),
        segmentation: z.string().optional().describe('Dimension to segment results by'),
        ...analyticsFilterSchema,
      },
      title: 'Analytics LTV',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const analyticsClient = await createAnalyticsClient(client, args.app_id)
        const filters = buildFilters(args)

        const body: Record<string, unknown> = {filters}
        if (args.period_unit) body.period_unit = args.period_unit
        if (args.period_type) body.period_type = args.period_type
        if (args.segmentation) body.segmentation = args.segmentation
        if (args.format) body.format = args.format

        const result = await analyticsClient.post('/metrics/ltv', body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  server.registerTool(
    'analytics_retention',
    {
      description: 'Fetch subscription retention analysis metrics showing how well subscribers are retained over renewal periods',
      inputSchema: {
        app_id: z.string().uuid().describe('App ID (UUID)'),
        segmentation: z.string().optional().describe('Dimension to segment results by'),
        use_trial: z.boolean().optional().default(false).describe('Include trial as the first retention step'),
        ...analyticsFilterSchema,
      },
      title: 'Analytics Retention',
    },
    async (args) => {
      try {
        const client = await createClient(configDir)
        const analyticsClient = await createAnalyticsClient(client, args.app_id)
        const filters = buildFilters(args)

        const body: Record<string, unknown> = {filters}
        if (args.period_unit) body.period_unit = args.period_unit
        if (args.segmentation) body.segmentation = args.segmentation
        if (args.use_trial) body.use_trial = args.use_trial
        if (args.format) body.format = args.format

        const result = await analyticsClient.post('/metrics/retention', body)
        return toolResult(result)
      } catch (error) {
        return toolError(formatError(error))
      }
    },
  )

  return server
}
