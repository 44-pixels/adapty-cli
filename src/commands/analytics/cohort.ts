import {Args, Command, Flags} from '@oclif/core'

import {AnalyticsClient} from '../../lib/analytics-client.js'
import {createAuthenticatedClient} from '../../lib/client-from-config.js'
import {isValidUuid} from '../../lib/flags.js'
import {printResponse} from '../../lib/output.js'

interface CohortDataRequest {
  accounting_type?: string
  filters: MetricsFilters
  format?: string
  period_type?: string
  period_unit?: string
  prediction_months?: number
  renewal_days?: number[]
  value_field?: string
  value_type?: string
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

export default class AnalyticsCohort extends Command {
  static args = {
    app_id: Args.string({description: 'App ID (UUID)', required: true}),
  }
static description = 'Fetch cohort tracking data to analyze user groups over time'
static enableJsonFlag = true
static examples = [
    '<%= config.bin %> analytics cohort APP_ID --date 2024-01-01 --date 2024-01-31 --period-unit month',
    '<%= config.bin %> analytics cohort APP_ID --date 2024-01-01 --date 2024-03-31 --period-type days --renewal-days 1,7,30',
  ]
static flags = {
    'accounting-type': Flags.string({
      description: 'Accounting method for revenue calculation (default: revenue)',
      options: ['revenue', 'proceeds', 'net_revenue'],
    }),
    'country': Flags.string({description: 'Filter by 2-letter country codes (comma-separated)'}),
    'date': Flags.string({description: 'Date for the analytics period (use two --date flags for a range: --date START --date END)', multiple: true, required: true}),
    'format': Flags.string({
      description: 'Export file format (default: json)',
      options: ['json', 'csv'],
    }),
    'period-type': Flags.string({
      description: 'Analyze cohorts by subscription renewals or by calendar days (default: renewals)',
      options: ['renewals', 'days'],
    }),
    'period-unit': Flags.string({
      description: 'Time interval for aggregating data (default: month)',
      options: ['day', 'week', 'month', 'quarter', 'year'],
    }),
    'prediction-months': Flags.integer({
      description: 'Number of months to predict into the future: 3, 6, 9, 12, 18, or 24 (default: 12)',
    }),
    'renewal-days': Flags.string({description: 'Days since install to use as cohort periods when period-type=days (comma-separated integers)'}),
    'store': Flags.string({description: 'Filter by app stores (comma-separated, e.g. app_store,play_store)'}),
    'store-product-id': Flags.string({description: 'Filter by store product IDs (comma-separated)'}),
    'value-field': Flags.string({
      description: 'Metric to display in cohort values (default: revenue)',
      options: ['revenue', 'arppu', 'arpu', 'arpas', 'subscribers', 'subscriptions'],
    }),
    'value-type': Flags.string({
      description: 'Show values as absolute numbers or relative percentages (default: absolute)',
      options: ['absolute', 'relative'],
    }),
  }

  async run(): Promise<unknown> {
    const {args, flags} = await this.parse(AnalyticsCohort)

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

    const requestBody: CohortDataRequest = {
      filters,
    }

    if (flags['period-unit']) {
      requestBody.period_unit = flags['period-unit']
    }

    if (flags['period-type']) {
      requestBody.period_type = flags['period-type']
    }

    if (flags['value-type']) {
      requestBody.value_type = flags['value-type']
    }

    if (flags['value-field']) {
      requestBody.value_field = flags['value-field']
    }

    if (flags['accounting-type']) {
      requestBody.accounting_type = flags['accounting-type']
    }

    if (flags['renewal-days']) {
      requestBody.renewal_days = flags['renewal-days'].split(',').map((d) => Number.parseInt(d.trim(), 10))
    }

    if (flags['prediction-months'] !== undefined) {
      requestBody.prediction_months = flags['prediction-months']
    }

    if (flags.format) {
      requestBody.format = flags.format
    }

    const result = await analyticsClient.post('/metrics/cohort', requestBody)

    printResponse(result as unknown as Record<string, unknown>, this.log.bind(this))

    return result
  }
}
