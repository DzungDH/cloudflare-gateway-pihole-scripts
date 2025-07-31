# AI Agent Instructions for Cloudflare Gateway Pi-hole Scripts

## Project Structure
This is a DNS filtering solution using Cloudflare Gateway that follows a modular architecture:

1. **Data Flow**:
   ```
   download_lists.js → blocklist.txt/allowlist.txt → cf_list_create.js → cf_gateway_rule_create.js
   ```

2. **Key Files**:
   - `lib/api.js`: Core Cloudflare API integration
   - `lib/constants.js`: Configuration and feature flags
   - `lib/helpers.js`: API request handling, rate limiting

## Critical Implementation Patterns

1. **List Processing**:
   - Lists are chunked into 1000-item segments (`LIST_ITEM_SIZE` in constants.js)
   - Total limit: 300,000 domains (free plan)
   - Example from api.js:
   ```javascript
   export const createZeroTrustListsOneByOne = async (items) => {
     let totalListNumber = Math.ceil(items.length / LIST_ITEM_SIZE);
     // Process in chunks of LIST_ITEM_SIZE
   }
   ```

2. **API Error Handling**:
   - All API calls MUST use `requestGateway()` helper
   - Built-in retry with 2-minute cooldown on rate limits
   - Error codes in constants.js: `RATE_LIMITING_HTTP_ERROR_CODE = 429`

3. **Environment Variables** (see constants.js):
   ```bash
   # Required
   CLOUDFLARE_API_TOKEN=  # Preferred over API key
   CLOUDFLARE_ACCOUNT_ID=

   # Optional Features
   DEBUG=1                # Enhanced logging
   DRY_RUN=1             # Test mode
   BLOCK_BASED_ON_SNI=1  # SNI filtering
   ```

## Common Tasks

1. **Test Changes**:
   ```bash
   npm run dry           # Validates without applying
   ```

2. **Update Production**:
   ```bash
   npm run download      # Fetch latest lists
   npm run cloudflare-delete && npm run cloudflare-create
   ```

3. **Debugging**:
   - Set `DEBUG=1` for detailed API logs
   - Check created lists in Zero Trust dashboard
   - Monitor webhook notifications
