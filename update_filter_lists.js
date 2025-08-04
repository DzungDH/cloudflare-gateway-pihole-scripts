import {
    createZeroTrustListsOneByOne,
    deleteZeroTrustListsOneByOne,
    deleteZeroTrustRule,
    getZeroTrustLists,
    getZeroTrustRules,
    upsertZeroTrustRule
} from "./lib/api.js";
import {
    BLOCK_BASED_ON_SNI,
    LIST_ITEM_LIMIT,
    LIST_ITEM_SIZE,
    RECOMMENDED_ALLOWLIST_URLS,
    RECOMMENDED_BLOCKLIST_URLS,
    USER_DEFINED_ALLOWLIST_URLS,
    USER_DEFINED_BLOCKLIST_URLS
} from "./lib/constants.js";
import { normalizeDomain } from "./lib/helpers.js";
import { extractDomain, isComment, isValidDomain, sendTelegramNotification } from "./lib/utils.js";

/**
 * Validates environment variables required for the script
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
    const required = [
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID'
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (!process.env.ALLOWLIST_URLS && !process.env.BLOCKLIST_URLS) {
        throw new Error('At least one of ALLOWLIST_URLS or BLOCKLIST_URLS must be provided');
    }
}

/**
 * Fetches and processes domains from a single URL
 * @param {string} url The URL to fetch domains from
 * @param {boolean} isAllowlist Whether this is an allowlist URL
 * @returns {Promise<Set<string>>} Set of processed domains
 */
async function fetchDomains(url, isAllowlist = false) {
    try {
        console.log(`Fetching domains from ${url}...`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const text = await response.text();
        const domains = new Set(
            text.split('\n')
                .map(line => line.trim())
                .filter(line => line && !isComment(line))
                .map(line => normalizeDomain(line, isAllowlist))
                .filter(domain => isValidDomain(domain)) // Filter out any null or undefined values
        );

        console.log(`Found ${domains.size} domains in ${url}`);
        return domains;
    } catch (error) {
        console.error(`Failed to fetch ${url}:`, error.message);
        return new Set();
    }
}

/**
 * Fetches and processes domains from multiple URLs
 * @param {string} urls Newline-separated list of URLs
 * @param {boolean} isAllowlist Whether these are allowlist URLs
 * @returns {Promise<Set<string>>} Combined set of unique domains
 */
async function fetchAndProcessUrls(urlList, isAllowlist = false) {
    const domainSets = await Promise.all(
        urlList.map(url => fetchDomains(url, isAllowlist))
    );

    return new Set(
        domainSets.flatMap(set => [...set])
    );
}

async function processLists() {
    // Validate environment and run main function
    validateEnvironment();

    const stats = {
        processed: 0,
        duplicates: 0,
        allowed: 0
    };

    console.log('Starting domain list processing...');

    // Fetch and process lists in parallel
    const [allowlist, rawBlocklist] = await Promise.all([
        fetchAndProcessUrls(USER_DEFINED_ALLOWLIST_URLS || RECOMMENDED_ALLOWLIST_URLS, true),
        fetchAndProcessUrls(USER_DEFINED_BLOCKLIST_URLS || RECOMMENDED_BLOCKLIST_URLS, false)
    ]);

    console.log(`\nFound ${allowlist.size} allowlist domains`);
    console.log(`Processing ${rawBlocklist.size} potential block domains...`);

    // Process blocklist with allowlist filtering
    const blocklist = new Set();
    const domains = [];
    for (const domain of rawBlocklist) {
        stats.processed++;

        if (allowlist.has(domain)) {
            stats.allowed++;
            continue;
        }

        if (blocklist.has(domain)) {
            stats.duplicates++;
            continue;
        }

        let isOk = true;
        for (const item of extractDomain(domain).slice(1)) {
            // Check for any higher level domain matches in the allowlist
            if (allowlist.has(item)) {
                stats.allowed++;
                isOk = false;
                break;
            }

            if (!blocklist.has(item)) continue;

            // The higher-level domain is already blocked
            // so it's not necessary to block this domain
            stats.duplicates++;
            isOk = false;
            break;
        }

        if (isOk) {
            blocklist.add(domain);
            if (domains.length > LIST_ITEM_LIMIT - LIST_ITEM_SIZE) {
                console.warn(`Blocklist exceeds limit of ${LIST_ITEM_LIMIT} items, ignore ${domain}.`);
                // Limit blocklist
                continue;
            }
            domains.push(domain);
        }
    }

    const numberOfLists = Math.ceil(domains.length / LIST_ITEM_SIZE);

    // Log processing results
    console.log('\nProcessing Results:');
    console.log(`✓ Total domains processed: ${stats.processed}`);
    console.log(`✓ Domains in allowlist: ${allowlist.size}`);
    console.log(`✓ Domains allowed (skipped): ${stats.allowed}`);
    console.log(`✓ Duplicate domains: ${stats.duplicates}`);
    console.log(`✓ Final block domains: ${domains.length}`);
    console.log(`✓ Number of lists to create: ${numberOfLists}\n`);

    if (domains.length === 0) {
        console.log('No domains to block. Exiting...');
        return;
    }

    // Delete existing rules and lists
    console.log('Fetching existing rules and lists...');
    const [{ result: existingRules }, { result: existingLists }] = await Promise.all([
        getZeroTrustRules(),
        getZeroTrustLists()
    ]);

    // Delete existing rules first
    const cgpsRules = existingRules?.filter(rule =>
        rule.name === "CGPS Filter Lists" ||
        rule.name === "CGPS Filter Lists - SNI Based Filtering"
    ) || [];

    if (cgpsRules.length) {
        console.log(`Deleting ${cgpsRules.length} existing rules...`);
        for (const rule of cgpsRules) {
            await deleteZeroTrustRule(rule.id);
            console.log(`Deleted rule: ${rule.name}`);
        }
    }

    // Then delete existing lists
    const cgpsLists = existingLists?.filter(({ name }) => name.startsWith("CGPS List")) || [];

    if (cgpsLists.length) {
        console.log(`Deleting ${cgpsLists.length} existing lists...`);
        await deleteZeroTrustListsOneByOne(cgpsLists);
    }

    // Create new lists
    console.log('Creating new block lists...');
    await createZeroTrustListsOneByOne(domains);

    // Create/update rules
    const { result: lists } = await getZeroTrustLists();
    // Create a Wirefilter expression to match DNS queries against all the lists
    const wirefilterDNSExpression = lists.reduce((previous, current) => {
        if (!current.name.startsWith("CGPS List")) return previous;

        return `${previous} any(dns.domains[*] in \$${current.id}) or `;
    }, "");

    console.log('Creating DNS blocking rule...');
    // .slice removes the trailing ' or '
    await upsertZeroTrustRule(wirefilterDNSExpression.slice(0, -4), "CGPS Filter Lists", ["dns"]);

    if (BLOCK_BASED_ON_SNI) {
        const wirefilterSNIExpression = lists.reduce((previous, current) => {
            if (!current.name.startsWith("CGPS List")) return previous;

            return `${previous} any(net.sni.domains[*] in \$${current.id}) or `;
        }, "");

        console.log('Creating SNI blocking rule...');
        // .slice removes the trailing ' or '
        await upsertZeroTrustRule(wirefilterSNIExpression.slice(0, -4), "CGPS Filter Lists - SNI Based Filtering", ["l4"]);
    }

    // Send notification with results
    await sendTelegramNotification(
        `✅ Filter Lists Update Complete\n\n` +
        `📊 Statistics:\n` +
        `• Total Processed: ${stats.processed}\n` +
        `• Allowlisted: ${allowlist.size}\n` +
        `• Blocked: ${domains.length}\n` +
        `• Lists Created: ${numberOfLists}`
    );
}

processLists().catch(async (error) => {
    console.error('Error during list processing:', error);
    await sendTelegramNotification(`❌ Filter Lists Update Failed:\n${error.message}`, true);
    process.exit(1);
});
