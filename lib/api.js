import { BLOCK_PAGE_ENABLED, DEBUG, LIST_ITEM_SIZE } from "./constants.js";
import { requestGateway } from "./helpers.js";

/**
 * Default rule settings
 */
const DEFAULT_RULE_SETTINGS = {
    block_page_enabled: BLOCK_PAGE_ENABLED,
    block_reason: "Blocked by CGPS, check your filter lists if this was a mistake."
};

/**
 * Default rule configuration
 */
const DEFAULT_RULE_CONFIG = {
    description: "Filter lists created by Cloudflare Gateway Pi-hole Scripts. Avoid editing this rule. Changing the name of this rule will break the script.",
    enabled: true,
    action: "block"
};

/**
 * Gets Zero Trust lists.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-lists-list-zero-trust-lists
 * @returns {Promise<Object>}
 */
export const getZeroTrustLists = () =>
    requestGateway("/lists", {
        method: "GET",
    });

/**
 * Creates a Zero Trust list.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-lists-create-zero-trust-list
 * @param {string} name The name of the list.
 * @param {Object[]} items The domains in the list.
 * @param {string} items[].value The domain of an entry.
 * @returns {Promise}
 */
const createZeroTrustList = (name, items) =>
    requestGateway(`/lists`, {
        method: "POST",
        body: JSON.stringify({
            name,
            type: "DOMAIN",
            items,
        }),
    });

/**
 * Creates Zero Trust lists sequentially with progress tracking
 * @param {Array<{value: string}[]>} domainChunks Array of domain chunks to create lists for
 * @returns {Promise<void>}
 */
export const createZeroTrustListsOneByOne = async (items) => {
    let totalListNumber = Math.ceil(items.length / LIST_ITEM_SIZE);

    for (let i = 0, listNumber = 1; i < items.length; i += LIST_ITEM_SIZE) {
        const chunk = items
            .slice(i, i + LIST_ITEM_SIZE)
            .map((item) => ({ value: item }));
        const listName = `CGPS List - Chunk ${listNumber}`;
        try {
            await createZeroTrustList(listName, chunk);
            totalListNumber--;
            listNumber++;
            console.log(`✓ Created "${listName}" (${totalListNumber} remaining)`);
        } catch (err) {
            console.error(`✗ Failed to create "${listName}":`, err);
            throw err;
        }
    }

    console.log('✓ All lists created successfully');
};

/**
 * Deletes a Zero Trust list.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-lists-delete-zero-trust-list
 * @param {number} id The ID of the list.
 * @returns {Promise<any>}
 */
const deleteZeroTrustList = (id) =>
    requestGateway(`/lists/${id}`, { method: "DELETE" });

/**
 * Deletes Zero Trust lists sequentially with progress tracking
 * @param {Array<{id: number, name: string}>} lists Lists to delete
 * @returns {Promise<void>}
 */
export const deleteZeroTrustListsOneByOne = async (lists) => {
    const total = lists.length;
    if (total === 0) return;

    console.log(`Deleting ${total} lists...`);
    let remaining = total;

    for (const { id, name } of lists) {
        try {
            await deleteZeroTrustList(id);
            remaining--;
            console.log(`✓ Deleted "${name}" (${remaining}/${total} remaining)`);
        } catch (error) {
            console.error(`✗ Failed to delete "${name}":`, error.message);
            throw error;
        }
    }

    console.log('✓ All lists deleted successfully');
};

/**
 * Gets Zero Trust rules.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-gateway-rules-list-zero-trust-gateway-rules
 * @returns {Promise<Object>}
 */
export const getZeroTrustRules = () =>
    requestGateway("/rules", { method: "GET" });

/**
 * Upserts a Zero Trust rule.
 * If a rule with the same name exists, will update it. Otherwise create a new rule.
 * @param {string} wirefilterExpression The expression to be used for the rule.
 * @param {string} name The name of the rule.
 * @param {string[]} filters The filters to be used for the rule. Default is ["dns"]. Possible values are ["dns", "http", "l4", "egress"].
 * @returns {Promise<Object>}
 */
export const upsertZeroTrustRule = async (wirefilterExpression, name = "CGPS Filter Lists", filters = ["dns"]) => {
    const { result: existingRules } = await getZeroTrustRules();
    const existingRule = existingRules.find(rule => rule.name === name);
    if (existingRule) {
        if (DEBUG) console.log(`Found "${existingRule.name}" in rules, updating...`);
        return updateZeroTrustRule(existingRule.id, wirefilterExpression, name, filters);
    }
    if (DEBUG) console.log(`No existing rule named "${existingRule.name}", creating...`);
    return createZeroTrustRule(wirefilterExpression, name, filters);
}

/**
 * Builds a Zero Trust rule payload
 * @param {string} wirefilterExpression Filter expression
 * @param {string} name Rule name
 * @param {string[]} filters Rule filters
 * @returns {Object} Rule configuration payload
 */
const buildRulePayload = (wirefilterExpression, name, filters) => ({
    ...DEFAULT_RULE_CONFIG,
    name,
    filters,
    traffic: wirefilterExpression,
    rule_settings: DEFAULT_RULE_SETTINGS
});

/**
 * Creates a new Zero Trust rule
 * @param {string} wirefilterExpression Filter expression
 * @param {string} name Rule name
 * @param {string[]} filters Rule filters (default: ["dns"])
 * @returns {Promise<Object>} Created rule
 */
export const createZeroTrustRule = async (wirefilterExpression, name = "CGPS Filter Lists", filters = ["dns"]) => {
    try {
        const payload = buildRulePayload(wirefilterExpression, name, filters);
        const response = await requestGateway("/rules", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        if (DEBUG) console.log(`✓ Created rule "${name}"`);
        return response;
    } catch (error) {
        console.error(`✗ Failed to create rule "${name}":`, error.message);
        throw error;
    }
};

/**
 * Updates an existing Zero Trust rule
 * @param {number} id Rule ID
 * @param {string} wirefilterExpression Filter expression
 * @param {string} name Rule name
 * @param {string[]} filters Rule filters (default: ["dns"])
 * @returns {Promise<Object>} Updated rule
 */
export const updateZeroTrustRule = async (id, wirefilterExpression, name = "CGPS Filter Lists", filters = ["dns"]) => {
    try {
        const payload = buildRulePayload(wirefilterExpression, name, filters);
        const response = await requestGateway(`/rules/${id}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });

        if (DEBUG) console.log(`✓ Updated rule "${name}"`);
        return response;
    } catch (error) {
        console.error(`✗ Failed to update rule "${name}":`, error.message);
        throw error;
    }
};

/**
 * Deletes a Zero Trust rule.
 *
 * API docs: https://developers.cloudflare.com/api/operations/zero-trust-gateway-rules-delete-zero-trust-gateway-rule
 * @param {number} id The ID of the rule to be deleted.
 * @returns {Promise<Object>}
 */
export const deleteZeroTrustRule = async (id) => {
    try {
        await requestGateway(`/rules/${id}`, {
            method: "DELETE",
        });

        console.log("Deleted rule successfully");
    } catch (err) {
        console.error(`Error occurred while deleting rule - ${err.toString()}`);
        throw err;
    }
};
