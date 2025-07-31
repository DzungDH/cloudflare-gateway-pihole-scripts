# Cloudflare Gateway Pi-hole Worker

A Cloudflare Worker implementation of Pi-hole-like DNS filtering using Cloudflare Gateway. This worker automatically manages domain blocklists and gateway rules in Cloudflare Zero Trust.

## Features

- 🔄 Automatic updates via cron triggers (runs at 3 AM every Monday)
- 📋 Support for domain lists and hosts files
- ⚡ Efficient list processing with automatic deduplication and validation
- 🔐 Secure secret management
- 📱 Telegram notifications for status updates
- 💾 State management using Durable Objects
- 🗄️ List caching with Workers KV

## Setup

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

3. Configure your secrets:
```bash
# Required
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID

# Optional (for Telegram notifications)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

4. Create a KV namespace:
```bash
npx wrangler kv:namespace create FILTER_KV
# Update the id in wrangler.jsonc with the returned namespace_id
```

5. Deploy the worker:
```bash
npx wrangler deploy
```

## Configuration

### Environment Variables

- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token with Zero Trust permissions
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
- `CLOUDFLARE_LIST_ITEM_LIMIT`: Maximum number of domains (default: 300,000)
- `BLOCK_PAGE_ENABLED`: Enable showing block page (default: "1")
- `TELEGRAM_BOT_TOKEN`: Telegram Bot API token for notifications
- `TELEGRAM_CHAT_ID`: Telegram chat ID to receive notifications

### Block/Allow Lists

Upload your lists to Workers KV:

```bash
# Blocklist URLs (one per line)
npx wrangler kv:key put --binding=FILTER_KV "blocklist_urls" "https://example.com/blocklist1.txt\nhttps://example.com/blocklist2.txt"

# Allowlist URLs (one per line)
npx wrangler kv:key put --binding=FILTER_KV "allowlist_urls" "https://example.com/allowlist1.txt\nhttps://example.com/allowlist2.txt"
```

## API Endpoints

- `GET /status`: Get current filter update status
- `POST /update`: Manually trigger filter update

## Development

```bash
# Start local development
npm run dev

# Type checking
npm run types

# Deploy
npm run deploy
```

## Architecture

The worker uses:
- Durable Objects for state management
- Workers KV for list caching
- Cron triggers for scheduled updates
- Telegram Bot API for notifications

## Security

- All secrets are managed via Wrangler secrets
- API calls use proper authentication
- Rate limiting handling built-in
- Input validation for all external data

## License

MIT
