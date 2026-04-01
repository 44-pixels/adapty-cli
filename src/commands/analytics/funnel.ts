import {Args, Command, Flags} from '@oclif/core'

import {AnalyticsClient} from '../../lib/analytics-client.js'
import {createAuthenticatedClient} from '../../lib/client-from-config.js'
import {isValidUuid} from '../../lib/flags.js'
import {printResponse} from '../../lib/output.js'

interface FunnelDataRequest {
  filters: MetricsFilters
  format?: string
  period_unit?: string
  segmentation?: string
  show_value_as?: string
}

interface MetricsFilters {
  attribution_source?: string[]
  compare_date?: string[]
  country?: string[]
  date: string[]
  duration?: string[]
  store?: string[]
  store_product_id?: string[]
}

export default class AnalyticsFunnel extends Command {
  static args = {
    app_id: Args.string({description: 'App ID (UUID)', required: true}),
  }
static description = 'Fetch funnel progression analytics (install → paywall → trial → paid)'
static enableJsonFlag = true
static examples = [
    '<%= config.bin %> analytics funnel APP_ID --date 2024-01-01 --date 2024-01-31',
    '<%= config.bin %> analytics funnel APP_ID --date 2024-01-01 --date 2024-03-31 --show-value-as both',
  ]
static flags = {
    'country': Flags.string({description: 'Filter by 2-letter country codes (comma-separated)'}),
    'date': Flags.string({description: 'Date for the analytics period (use two --date flags for a range: --date START --date END)', multiple: true, required: true}),
    'format': Flags.string({
      description: 'Export file format (default: json)',
      options: ['json', 'csv'],
    }),
    'period-unit': Flags.string({
      description: 'Time interval for aggregating data (default: month)',
      options: ['day', 'week', 'month', 'quarter', 'year'],
    }),
    'segmentation': Flags.string({description: 'Dimension to segment results by'}),
    'show-value-as': Flags.string({
      description: 'Display funnel values as absolute numbers, relative percentages, or both',
      options: ['absolute', 'relative', 'both'],
    }),
    'store': Flags.string({description: 'Filter by app stores (comma-separated, e.g. app_store,play_store)'}),
    'store-product-id': Flags.string({description: 'Filter by store product IDs (comma-separated)'}),
  }

  async run(): Promise<unknown> {
    const {args, flags} = await this.parse(AnalyticsFunnel)

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

    const requestBody: FunnelDataRequest = {
      filters,
    }

    if (flags['period-unit']) {
      requestBody.period_unit = flags['period-unit']
    }

    if (flags['show-value-as']) {
      requestBody.show_value_as = flags['show-value-as']
    }

    if (flags.segmentation) {
      requestBody.segmentation = flags.segmentation
    }

    if (flags.format) {
      requestBody.format = flags.format
    }

    const result = await analyticsClient.post('/metrics/funnel', requestBody)

    printResponse(result as unknown as Record<string, unknown>, this.log.bind(this))

    return result
  }
}
