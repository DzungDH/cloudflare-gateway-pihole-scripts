import { createZeroTrustListsOneByOne } from './api';

interface Env {
    CLOUDFLARE_API_TOKEN: string;
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_LIST_ITEM_LIMIT?: string;
    BLOCK_PAGE_ENABLED?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    FILTER_KV: KVNamespace;
    FILTER_STATE: DurableObjectNamespace;
}

interface FilterState {
    lastUpdate: string;
    status: 'idle' | 'updating' | 'error';
    error?: string;
}

export class FilterStateManager implements DurableObject {
    private state: DurableObjectState;
    private env: Env;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        switch (url.pathname) {
            case '/status':
                return Response.json(await this.state.storage.get('status'));
            case '/update':
                return this.handleUpdate(request);
            default:
                return new Response('Not found', { status: 404 });
        }
    }

    private async handleUpdate(request: Request): Promise<Response> {
        // Set status to updating
        await this.state.storage.put('status', {
            lastUpdate: new Date().toISOString(),
            status: 'updating'
        });

        try {
            // Download lists
            const [allowlist, blocklist] = await Promise.all([
                this.downloadList('allowlist'),
                this.downloadList('blocklist')
            ]);

            // Delete existing rules and lists
            await this.deleteExistingRules();

            // Create new rules and lists
            await this.createNewRules(allowlist, blocklist);

            // Update status
            await this.state.storage.put('status', {
                lastUpdate: new Date().toISOString(),
                status: 'idle'
            });

            // Send notifications
            await this.sendNotifications('Filter lists updated successfully');

            return new Response('Update completed', { status: 200 });
        } catch (error) {
            const errorStatus = {
                lastUpdate: new Date().toISOString(),
                status: 'error',
                error: error.message
            };
            await this.state.storage.put('status', errorStatus);
            await this.sendNotifications(`Error updating filter lists: ${error.message}`);
            return Response.json(errorStatus, { status: 500 });
        }
    }

    private async downloadList(type: 'allowlist' | 'blocklist'): Promise<string[]> {
        const urls = await this.env.FILTER_KV.get(`${type}_urls`);
        if (!urls) {
            return [];
        }

        const responses = await Promise.all(
            urls.split('\n').map(url => fetch(url))
        );

        const lists = await Promise.all(
            responses.map(response => response.text())
        );

        // Process and clean the lists similar to download_lists.js
        const domains = lists
            .flatMap(list => list.split('\n'))
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .filter(line => /^[a-zA-Z0-9][a-zA-Z0-9-_.]+\.[a-zA-Z]{2,}$/.test(line));

        // Store in KV for caching
        await this.env.FILTER_KV.put(`${type}_domains`, JSON.stringify(domains));
        return domains;
    }

    private async deleteExistingRules() {
        // Implementation similar to cf_gateway_rule_delete.js
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/gateway/rules`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        const rules = await response.json();

        // Delete CGPS rules
        await Promise.all(
            rules.result
                .filter(rule => rule.name.startsWith('CGPS'))
                .map(rule => fetch(
                    `https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/gateway/rules/${rule.id}`,
                    {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`
                        }
                    }
                ))
        );
    }

    private async createNewRules(allowlist: string[], blocklist: string[]) {
        // Implementation similar to cf_list_create.js and cf_gateway_rule_create.js
        await createZeroTrustListsOneByOne(blocklist);

        // Create gateway rule
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/gateway/rules`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'CGPS - Block Domains',
                action: 'block',
                enabled: true,
                filters: ['dns'],
                traffic: 'any(dns.domains[*] in $cgps_blocklist)',
                rule_settings: {
                    block_page_enabled: this.env.BLOCK_PAGE_ENABLED === '1'
                }
            })
        });
    }

    private async sendNotifications(message: string) {
        if (this.env.TELEGRAM_BOT_TOKEN && this.env.TELEGRAM_CHAT_ID) {
            await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.env.TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'HTML'
                })
            });
        }
    }

    // Handle cron triggers
    async alarm() {
        await this.fetch(new Request('http://localhost/update', { method: 'POST' }));
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const id = env.FILTER_STATE.idFromName('filter-manager');
        const filterManager = env.FILTER_STATE.get(id);
        return filterManager.fetch(request);
    },

    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        const id = env.FILTER_STATE.idFromName('filter-manager');
        const filterManager = env.FILTER_STATE.get(id);
        await filterManager.fetch(new Request('http://localhost/update', { method: 'POST' }));
    }
}
