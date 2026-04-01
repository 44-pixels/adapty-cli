import {Args, Command, Flags} from '@oclif/core'

import {AnalyticsClient} from '../../lib/analytics-client.js'
import {createAuthenticatedClient} from '../../lib/client-from-config.js'
import {isValidUuid} from '../../lib/flags.js'
import {printResponse} from '../../lib/output.js'

interface ConversionDataRequest {
  date_type?: string
  filters: MetricsFilters
  format?: string
  from_period: null | string
  period_unit?: string
  segmentation?: string
  to_period: string
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

export default class AnalyticsConversion extends Command {
  static args = {
    app_id: Args.string({description: 'App ID (UUID)', required: true}),
  }
static description = 'Fetch conversion rate metrics'
static enableJsonFlag = true
static examples = [
    '<%= config.bin %> analytics conversion 550e8400-e29b-41d4-a716-446655440000 --date 2024-01-01 2024-01-31 --to-period month',
  ]
static flags = {
    'country': Flags.string({description: 'Comma-separated list of country codes'}),
    'date': Flags.string({description: 'Date range (space-separated: start end)', multiple: true, required: true}),
    'date-type': Flags.string({
      description: 'Date type for grouping',
      options: ['purchase_date', 'profile_install_date'],
    }),
    'format': Flags.string({
      description: 'Response format',
      options: ['json', 'csv'],
    }),
    'from-period': Flags.string({description: 'Source conversion period (nullable)'}),
    'period-unit': Flags.string({
      description: 'Period unit for grouping',
      options: ['day', 'week', 'month', 'quarter', 'year'],
    }),
    'segmentation': Flags.string({description: 'Segmentation dimension'}),
    'store': Flags.string({description: 'Comma-separated list of stores'}),
    'store-product-id': Flags.string({description: 'Comma-separated list of store product IDs'}),
    'to-period': Flags.string({description: 'Target conversion period', required: true}),
  }

  async run(): Promise<unknown> {
    const {args, flags} = await this.parse(AnalyticsConversion)

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

    const requestBody: ConversionDataRequest = {
      filters,
      from_period: flags['from-period'] ?? null,
      to_period: flags['to-period'],
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

    const result = await analyticsClient.post('/metrics/conversion', requestBody)

    printResponse(result as unknown as Record<string, unknown>, this.log.bind(this))

    return result
  }
}
