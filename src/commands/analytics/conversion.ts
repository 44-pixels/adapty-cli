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
static description = 'Fetch conversion rate metrics between subscription lifecycle stages'
static enableJsonFlag = true
static examples = [
    '<%= config.bin %> analytics conversion APP_ID --date 2024-01-01 --date 2024-01-31 --to-period 0  # install → trial',
    '<%= config.bin %> analytics conversion APP_ID --date 2024-01-01 --date 2024-01-31 --to-period 1  # install → paid',
    '<%= config.bin %> analytics conversion APP_ID --date 2024-01-01 --date 2024-01-31 --from-period 0 --to-period 1  # trial → paid',
    '<%= config.bin %> analytics conversion APP_ID --date 2024-01-01 --date 2024-01-31 --from-period 1 --to-period 2  # paid → 2nd renewal',
  ]
static flags = {
    'country': Flags.string({description: 'Filter by 2-letter country codes (comma-separated)'}),
    'date': Flags.string({description: 'Date for the analytics period (use two --date flags for a range: --date START --date END)', multiple: true, required: true}),
    'date-type': Flags.string({
      description: 'Which date to treat as the user joining date (default: purchase_date)',
      options: ['purchase_date', 'profile_install_date'],
    }),
    'format': Flags.string({
      description: 'Export file format (default: json)',
      options: ['json', 'csv'],
    }),
    'from-period': Flags.string({description: "Starting subscription lifecycle stage number: omit for install, 0 for trial, 1+ for renewal period"}),
    'period-unit': Flags.string({
      description: 'Time interval for aggregating data (default: month)',
      options: ['day', 'week', 'month', 'quarter', 'year'],
    }),
    'segmentation': Flags.string({description: 'Dimension to segment results by'}),
    'store': Flags.string({description: 'Filter by app stores (comma-separated, e.g. app_store,play_store)'}),
    'store-product-id': Flags.string({description: 'Filter by store product IDs (comma-separated)'}),
    'to-period': Flags.string({description: "Target subscription lifecycle stage number: 0 for trial, 1 for first paid, 2+ for renewal period", required: true}),
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
