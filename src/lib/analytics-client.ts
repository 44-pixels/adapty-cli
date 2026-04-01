import {ApiError, NetworkError, parseApiError} from './errors.js'

const ANALYTICS_API_URL = 'https://api-admin.adapty.io/api/v1/client-api'

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

export interface AnalyticsClientOptions {
  apiKey: string
  baseUrl?: string
  userAgent?: string
}

export class AnalyticsClient {
  private apiKey: string
  private baseUrl: string
  private userAgent: string

  constructor(opts: AnalyticsClientOptions) {
    this.apiKey = opts.apiKey
    this.baseUrl = opts.baseUrl ?? ANALYTICS_API_URL
    this.userAgent = opts.userAgent ?? 'adapty-cli'
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${ensureTrailingSlash(path)}`

    const headers: Record<string, string> = {
      'Authorization': 'Api-Key ' + this.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
    }

    let response: Response
    try {
      response = await fetch(url, {
        body: body ? JSON.stringify(body) : undefined,
        headers,
        method: 'POST',
      })
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : 'Connection failed')
    }

    if (response.status === 204) {
      return undefined as T
    }

    let responseBody: unknown
    try {
      responseBody = await response.json()
    } catch {
      if (!response.ok) {
        throw new ApiError(response.status, `http_${response.status}`, {})
      }

      return undefined as T
    }

    if (!response.ok) {
      const error = parseApiError(response.status, responseBody)
      if (response.status === 401) {
        error.message = 'Invalid API key. Check your app secret key.'
      }

      throw error
    }

    return responseBody as T
  }
}
