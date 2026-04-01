<a href="https://adapty.io/?utm_source=github&utm_medium=referral&utm_campaign=adapty-cli">
    <img src="https://adapty-portal-media-production.s3.amazonaws.com/github/logo-adapty-new.svg">
</a>

# Adapty CLI

[Adapty Developer CLI](https://adapty.io/docs/developer-cli). Manage apps, products, paywalls, placements, access levels, and fetch analytics data from your terminal.

## Installation

```sh
npm install -g adapty
```

Requires Node.js >= 18.

## Authentication

```sh
adapty auth login
```

Opens browser for OAuth device flow. Token is stored in `~/.config/adapty/config.json`.

Override with `ADAPTY_TOKEN` environment variable:

```sh
ADAPTY_TOKEN=your-token adapty apps list
```

Other auth commands:

```sh
adapty auth whoami     # verify token, show user info
adapty auth status     # show local auth state
adapty auth logout     # clear stored token (local only)
adapty auth revoke     # revoke token server-side and clear local
```

## Commands

All resource commands require `--app APP_ID` (UUID). Use `adapty apps list` to find your app ID.

### Apps

```sh
adapty apps list [--page N] [--page-size N]
adapty apps get APP_ID
adapty apps create --title "My App" --platform ios --apple-bundle-id com.example.app
adapty apps update APP_ID [flags]
```

### Products

```sh
adapty products list --app UUID [--page N] [--page-size N]
adapty products get --app UUID PRODUCT_ID
adapty products create --app UUID [flags]
adapty products update --app UUID PRODUCT_ID [flags]
```

### Paywalls

```sh
adapty paywalls list --app UUID [--page N] [--page-size N]
adapty paywalls get --app UUID PAYWALL_ID
adapty paywalls create --app UUID --title "Name" --product-id UUID1 [--product-id UUID2]
adapty paywalls update --app UUID PAYWALL_ID [flags]
```

### Placements

```sh
adapty placements list --app UUID [--page N] [--page-size N]
adapty placements get --app UUID PLACEMENT_ID
adapty placements create --app UUID [flags]
adapty placements update --app UUID PLACEMENT_ID [flags]
```

### Access Levels

```sh
adapty access-levels list --app UUID [--page N] [--page-size N]
adapty access-levels get --app UUID ACCESS_LEVEL_ID
adapty access-levels create --app UUID [flags]
adapty access-levels update --app UUID ACCESS_LEVEL_ID [flags]
```

### Analytics

Fetch analytics data using the Analytics Export API. These commands use `APP_ID` (UUID) as a positional argument and automatically authenticate with the app's secret key.

Date ranges use two `--date` flags: `--date START --date END`.

```sh
# General analytics data (chart types: revenue, mrr, arr, arppu, arpu, installs, etc.)
adapty analytics data APP_ID --chart-id revenue --date 2024-01-01 --date 2024-03-31
adapty analytics data APP_ID --chart-id mrr --date 2024-01-01 --date 2024-03-31 --period-unit week

# Cohort tracking
adapty analytics cohort APP_ID --date 2024-01-01 --date 2024-03-31 --period-unit month
adapty analytics cohort APP_ID --date 2024-01-01 --date 2024-03-31 --period-type days --renewal-days 1,7,30

# Conversion rate metrics (from_period/to_period are lifecycle stage numbers)
adapty analytics conversion APP_ID --date 2024-01-01 --date 2024-03-31 --to-period 0  # install → trial
adapty analytics conversion APP_ID --date 2024-01-01 --date 2024-03-31 --to-period 1  # install → paid
adapty analytics conversion APP_ID --date 2024-01-01 --date 2024-03-31 --from-period 0 --to-period 1  # trial → paid
adapty analytics conversion APP_ID --date 2024-01-01 --date 2024-03-31 --from-period 1 --to-period 2  # paid → 2nd renewal

# Funnel progression (install → paywall → trial → paid)
adapty analytics funnel APP_ID --date 2024-01-01 --date 2024-03-31
adapty analytics funnel APP_ID --date 2024-01-01 --date 2024-03-31 --show-value-as both

# Lifetime value (LTV)
adapty analytics ltv APP_ID --date 2024-01-01 --date 2024-03-31
adapty analytics ltv APP_ID --date 2024-01-01 --date 2024-03-31 --period-type days

# Retention analysis
adapty analytics retention APP_ID --date 2024-01-01 --date 2024-03-31
adapty analytics retention APP_ID --date 2024-01-01 --date 2024-03-31 --use-trial
```

All analytics commands support `--json` for programmatic output, `--format csv` for CSV export, and common filters like `--country`, `--store`, and `--store-product-id`.

### Global Flags

| Flag          | Description                            |
| ------------- | -------------------------------------- |
| `--json`      | Output as JSON                         |
| `--help`      | Show help                              |
| `--page`      | Page number (default: 1)               |
| `--page-size` | Items per page (default: 20, max: 100) |

## Environment Variables

| Variable         | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `ADAPTY_TOKEN`   | Override stored auth token                                                      |
| `ADAPTY_API_URL` | Override API base URL (default: `https://api-admin.adapty.io/api/v1/developer`) |

## Claude Code Skill

Install the Adapty CLI skill for Claude Code:

```sh
npx skills add adaptyteam/adapty-cli --skill adapty-cli
```

## Development

```sh
pnpm install
pnpm build
./bin/run.js apps list
```

## License

MIT
