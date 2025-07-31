import { BOT_TOKEN, CHAT_ID, CLOUDFLARE_RATE_LIMITING_COOLDOWN_TIME, RATE_LIMITING_HTTP_ERROR_CODE } from "./constants.js";

if (!globalThis.fetch) {
    globalThis.fetch = (await import("node-fetch")).default;
}

/**
 * Checks if the value is a valid domain name
 * @param {string} value Domain to validate
 * @returns {boolean} True if valid domain
 */
export const isValidDomain = (value) =>
    /^\b((?=[a-z0-9-]{1,63}\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,63}\b$/.test(
        value
    );

/**
* Extracts all subdomains from a domain including itself.
* @param {string} domain The domain to be extracted.
* @returns {string[]}
*/
export const extractDomain = (domain) => {
    const parts = domain.split(".");
    const extractedDomains = [];

    for (let i = 0; i < parts.length; i++) {
        const subdomains = parts.slice(i).join(".");

        extractedDomains.unshift(subdomains);
    }

    return extractedDomains;
};

/**
 * Checks if the value is a comment.
 * @param {string} value The value to be checked.
 */
export const isComment = (value) =>
    value.startsWith("#") ||
    value.startsWith("//") ||
    value.startsWith("!") ||
    value.startsWith("/*") ||
    value.startsWith("*/");

/**
 * Memoizes a function
 * @template T The argument type of the function.
 * @template R The return type of the function.
 * @param {(...fnArgs: T[]) => R} fn The function to be memoized.
 */
export const memoize = (fn) => {
    const cache = new Map();

    return (...args) => {
        const key = args.join("-");

        if (cache.has(key)) return cache.get(key);

        const result = fn(...args);

        cache.set(key, result);
        return result;
    };
};

/**
 * Waits for a period of time
 * @param {number} ms The time to wait in milliseconds.
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a notification message to Telegram
 * @param {string} message The message to send
 * @param {boolean} [isError=false] Whether this is an error message
 */
export async function sendTelegramNotification(message, isError = false) {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.log('Telegram notification skipped - missing configuration');
        return;
    }

    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_notification: !isError
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Failed to send Telegram notification:', error);
    }
}

/**
 * Configuration for fetch retry mechanism
 */
const FETCH_CONFIG = {
    MAX_ATTEMPTS: 5,
    BASE_DELAY: 1000,
    MAX_DELAY: 30000,
    RATE_LIMIT_STATUS: RATE_LIMITING_HTTP_ERROR_CODE,
    RATE_LIMIT_DELAY: CLOUDFLARE_RATE_LIMITING_COOLDOWN_TIME
};

/**
 * Implements exponential backoff delay
 * @param {number} attempt Current attempt number
 * @returns {number} Delay in milliseconds
 */
const getBackoffDelay = (attempt) => {
    const delay = Math.min(
        FETCH_CONFIG.MAX_DELAY,
        FETCH_CONFIG.BASE_DELAY * Math.pow(2, attempt)
    );
    return delay + Math.random() * 1000; // Add jitter
};

/**
 * Fetches a resource with automatic retries and exponential backoff
 * @param {Parameters<typeof fetch>} args Fetch arguments
 * @returns {Promise<Response>} Fetch response
 * @throws {Error} If all retry attempts fail
 */
export const fetchRetry = async (...args) => {
    let attempt = 0;

    while (attempt < FETCH_CONFIG.MAX_ATTEMPTS) {
        try {
            const response = await fetch(...args);

            if (response.ok) {
                return response;
            }

            // Handle rate limiting specifically
            if (response.status === FETCH_CONFIG.RATE_LIMIT_STATUS) {
                console.log(`Rate limited. Waiting ${FETCH_CONFIG.RATE_LIMIT_DELAY / 1000}s...`);
                await wait(FETCH_CONFIG.RATE_LIMIT_DELAY);
                attempt--; // Don't count rate limits against retry attempts
                continue;
            }

            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}:${response.statusText} - ${errorText}`);
        } catch (error) {
            attempt++;

            if (attempt === FETCH_CONFIG.MAX_ATTEMPTS) {
                await sendTelegramNotification(`Failed to fetch after ${attempt} attempts: ${error.message}`, true);
                throw error;
            }

            const delay = getBackoffDelay(attempt);
            console.warn(`Fetch attempt ${attempt} failed: ${error.message}. Retrying in ${delay / 1000}s...`);
            await wait(delay);
        }
    }
};
