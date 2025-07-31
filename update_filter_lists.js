import {
    deleteZeroTrustListsOneByOne,
    getZeroTrustLists,
    createZeroTrustListsOneByOne,
    upsertZeroTrustRule,
    getZeroTrustRules,
    deleteZeroTrustRule
} from "./lib/api.js";
import {
    USER_DEFINED_ALLOWLIST_URLS,
    USER_DEFINED_BLOCKLIST_URLS,
    RECOMMENDED_ALLOWLIST_URLS,
    RECOMMENDED_BLOCKLIST_URLS,
    BLOCK_BASED_ON_SNI,
    LIST_ITEM_LIMIT,
    LIST_ITEM_SIZE
} from "./lib/constants.js";
import { isComment, sendTelegramNotification } from "./lib/utils.js";
import { normalizeDomain } from "./lib/helpers.js";

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
                .filter(Boolean)
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

        blocklist.add(domain);
    }

    if (blocklist.size > LIST_ITEM_LIMIT) {
        console.warn(`Blocklist exceeds limit of ${LIST_ITEM_LIMIT} items. Trimming to limit.`);
        // Limit blocklist
        blocklist = new Set([...blocklist].slice(0, LIST_ITEM_LIMIT));
    }

    // Convert sets to arrays and chunk for Cloudflare's limits
    const domains = [...blocklist];
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
    const wirefilterDNSExpression = lists
        .filter(list => list.name.startsWith("CGPS List"))
        .reduce((expr, list) => `${expr} any(dns.domains[*] in ${list.id}) or `, "")
        .slice(0, -4); // Remove trailing ' or '

    console.log('Creating DNS blocking rule...');
    await upsertZeroTrustRule(wirefilterDNSExpression, "CGPS Filter Lists", ["dns"]);

    if (BLOCK_BASED_ON_SNI) {
        const wirefilterSNIExpression = lists
            .filter(list => list.name.startsWith("CGPS List"))
            .reduce((expr, list) => `${expr} any(net.sni.domains[*] in ${list.id}) or `, "")
            .slice(0, -4);

        console.log('Creating SNI blocking rule...');
        await upsertZeroTrustRule(
            wirefilterSNIExpression,
            "CGPS Filter Lists - SNI Based Filtering",
            ["l4"]
        );
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
