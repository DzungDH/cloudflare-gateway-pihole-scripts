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

    let data;
    try {
        const response = await fetchRetry(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...options.headers,
                ...headers,
            },
        });

        return await response.json();
    } catch (error) {
        throw new Error(`${(data && 'errors' in data) ? data.errors[0].message : data} - ${error}`);
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
    // Remove allowlist prefix if applicable
    const init = (isAllowlisting) ? value.replace("@@||", "") : value;

    // Remove common prefixes and suffixes
    const normalized = init
        .replace(/(0\.0\.0\.0|127\.0\.0\.1|::1|::)\s+/, "") // Remove IP addresses
        .replace("||", "")
        .replace("^$important", "")
        .replace("*.", "")
        .replace("^", "");

    return normalized;
};
