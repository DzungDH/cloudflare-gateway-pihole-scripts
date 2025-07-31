import {
    ACCOUNT_ID,
    API_HOST,
    API_TOKEN,
} from "./constants.js";
import { fetchRetry } from "./utils.js";

if (!globalThis.fetch) {
    console.warn(
        "\nIMPORTANT: Your Node.js version doesn't have native fetch support and may not be supported in the future. Please update to v18 or later.\n"
    );
    // Advise what to do if running in GitHub Actions
    if (process.env.GITHUB_WORKSPACE)
        console.warn(
            "Since you're running in GitHub Actions, you should update your Actions workflow configuration to use Node v18 or higher."
        );
    // Import node-fetch since there's no native fetch in this environment
    globalThis.fetch = (await import("node-fetch")).default;
}

/**
 * Fires request to the specified URL.
 * @param {string} url The URL to which the request will be fired.
 * @param {RequestInit} options The options to be passed to `fetch`.
 * @returns {Promise}
 */
/**
 * Makes an authenticated request to Cloudflare API
 * @param {string} url The URL to send the request to
 * @param {RequestInit} options Fetch options
 * @returns {Promise<any>} Parsed JSON response
 * @throws {Error} If authentication is missing or request fails
 */
const request = async (url, options) => {
    // Validate required auth credentials
    if (!API_TOKEN || !ACCOUNT_ID) {
        throw new Error("Missing required credentials: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
    }

    // Prepare authentication headers
    const headers = { Authorization: `Bearer ${API_TOKEN}` };

    try {
        const response = await fetchRetry(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...options?.headers,
                ...headers,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.errors?.[0]?.message ||
                `HTTP ${response.status}: ${JSON.stringify(response)}`
            );
        }

        return data;
    } catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(`Request failed: ${error}`);
    }
};

/**
 * Fires request to the Zero Trust gateway.
 * @param {string} path The path which will be appended to the request URL.
 * @param {RequestInit} options The options to be passed to `fetch`.
 * @returns {Promise}
 */
export const requestGateway = (path, options) =>
    request(`${API_HOST}/accounts/${ACCOUNT_ID}/gateway${path}`, options);

/**
 * Normalizes a domain string by removing common prefixes and patterns
 * @param {string} value The domain string to normalize
 * @param {boolean} isAllowlisting Whether this is an allowlist entry
 * @returns {string|null} Normalized domain or null if invalid
 */
export const normalizeDomain = (value, isAllowlisting) => {
    if (!value || typeof value !== 'string') return null;

    // Remove allowlist prefix if applicable
    let domain = isAllowlisting ? value.replace("@@||", "") : value;

    // Remove common prefixes and suffixes
    domain = domain
        .replace(/(0\.0\.0\.0|127\.0\.0\.1|::1|::)\s+/, "") // Remove IP addresses
        .replace("||", "")
        .replace("^$important", "")
        .replace("*.", "")
        .replace("^", "")
        .trim();

    // Validate domain format
    const isValidDomain = /^[a-zA-Z0-9][a-zA-Z0-9-_.]+[a-zA-Z0-9]$/.test(domain);
    return isValidDomain ? domain.toLowerCase() : null;
};
