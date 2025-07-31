import { API_HOST, CLOUDFLARE_RATE_LIMITING_COOLDOWN_TIME, RATE_LIMITING_HTTP_ERROR_CODE } from './constants';

export const requestGateway = async (path: string, options: RequestInit): Promise<any> => {
    const url = `${API_HOST}${path}`;
    let retries = 3;

    while (retries > 0) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                if (response.status === RATE_LIMITING_HTTP_ERROR_CODE) {
                    console.log('Rate limited, waiting...');
                    await new Promise(resolve => setTimeout(resolve, CLOUDFLARE_RATE_LIMITING_COOLDOWN_TIME));
                    retries--;
                    continue;
                }
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            return response.json();
        } catch (error) {
            if (retries === 0) throw error;
            retries--;
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s between retries
        }
    }
};
