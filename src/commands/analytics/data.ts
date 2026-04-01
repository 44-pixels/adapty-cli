import {Args, Command, Flags} from '@oclif/core'

import {AnalyticsClient} from '../../lib/analytics-client.js'
import {createAuthenticatedClient} from '../../lib/client-from-config.js'
import {isValidUuid} from '../../lib/flags.js'
import {printResponse} from '../../lib/output.js'

const CHART_IDS = [
  'revenue', 'mrr', 'arr', 'arppu', 'subscriptions_active', 'subscriptions_new',
  'subscriptions_renewal_cancelled', 'subscriptions_expired', 'trials_active',
  'trials_new', 'trials_renewal_cancelled', 'trials_expired', 'grace_period',
  'billing_issue', 'refund_events', 'refund_money', 'non_subscriptions', 'arpu', 'installs',
] as const

interface AnalyticsDataRequest {
  chart_id: string
  date_type?: string
  filters: MetricsFilters
  format?: string
  period_unit?: string
  segmentation?: string
}

interface MetricsFilters {
  attribution_adgroup?: string[]
  attribution_adset?: string[]
  attribution_campaign?: string[]
  attribution_channel?: string[]
  attribution_creative?: string[]
  attribution_source?: string[]
  attribution_status?: string[]
  compare_date?: string[]
  country?: string[]
  date: string[]
  duration?: string[]
  offer_category?: string[]
  offer_id?: string[]
  offer_type?: string[]
  store?: string[]
  store_product_id?: string[]
}

export default class AnalyticsData extends Command {
  static args = {
    app_id: Args.string({description: 'App ID (UUID)', required: true}),
  }
static description = 'Fetch analytics chart data for an app'
static enableJsonFlag = true
static examples = [
    '<%= config.bin %> analytics data APP_ID --chart-id revenue --date 2024-01-01 --date 2024-01-31',
    '<%= config.bin %> analytics data APP_ID --chart-id mrr --date 2024-01-01 --date 2024-03-31 --period-unit week',
  ]
static flags = {
    'attribution-source': Flags.string({description: 'Filter by attribution source integrations (comma-separated)'}),
    'chart-id': Flags.string({
      description: 'Chart type to retrieve (one per request)',
      options: [...CHART_IDS],
      required: true,
    }),
    'country': Flags.string({description: 'Filter by 2-letter country codes (comma-separated)'}),
    'date': Flags.string({description: 'Date for the analytics period (use two --date flags for a range: --date START --date END)', multiple: true, required: true}),
    'date-type': Flags.string({
      description: 'Which date to treat as a user joining date (default: purchase_date)',
      options: ['purchase_date', 'profile_install_date'],
    }),
    'format': Flags.string({
      description: 'Export file format (default: json)',
      options: ['json', 'csv'],
    }),
    'period-unit': Flags.string({
      description: 'Time interval for aggregating data (default: month)',
      options: ['day', 'week', 'month', 'quarter', 'year'],
    }),
    'segmentation': Flags.string({description: 'Dimension to segment results by'}),
    'store': Flags.string({description: 'Filter by app stores (comma-separated, e.g. app_store,play_store)'}),
    'store-product-id': Flags.string({description: 'Filter by store product IDs (comma-separated)'}),
  }

  async run(): Promise<unknown> {
    const {args, flags} = await this.parse(AnalyticsData)

    if (!isValidUuid(args.app_id)) {
      this.error('Invalid app ID format. Run `adapty apps list` to find your app ID.', {exit: 2})
    }

    const client = await createAuthenticatedClient(this.config)
    const appDetails = await client.get<{secret_key: string}>(`/apps/${args.app_id}`)

    const analyticsClient = new AnalyticsClient({
      apiKey: appDetails.secret_key,
    })

    const filters: MetricsFilters = {
      date: flags.date,
    }

    if (flags.country) {
      filters.country = flags.country.split(',').map((c) => c.trim())
    }

    if (flags.store) {
      filters.store = flags.store.split(',').map((s) => s.trim())
    }

    if (flags['store-product-id']) {
      filters.store_product_id = flags['store-product-id'].split(',').map((s) => s.trim())
    }

    if (flags['attribution-source']) {
      filters.attribution_source = flags['attribution-source'].split(',').map((s) => s.trim())
    }

    const requestBody: AnalyticsDataRequest = {
      chart_id: flags['chart-id'],
      filters,
    }

    if (flags['period-unit']) {
      requestBody.period_unit = flags['period-unit']
    }

    if (flags['date-type']) {
      requestBody.date_type = flags['date-type']
    }

    if (flags.segmentation) {
      requestBody.segmentation = flags.segmentation
    }

    if (flags.format) {
      requestBody.format = flags.format
    }

    const result = await analyticsClient.post('/metrics/analytics', requestBody)

    printResponse(result as unknown as Record<string, unknown>, this.log.bind(this))

    return result
  }
}
