import { requestGateway } from './helpers';
import { LIST_ITEM_SIZE } from './constants';

/**
 * Creates Zero Trust lists sequentially.
 * @param {string[]} items The domains.
 */
export const createZeroTrustListsOneByOne = async (items: string[]) => {
    let totalListNumber = Math.ceil(items.length / LIST_ITEM_SIZE);

    for (let i = 0, listNumber = 1; i < items.length; i += LIST_ITEM_SIZE) {
        const chunk = items
            .slice(i, i + LIST_ITEM_SIZE)
            .map((item) => ({ value: item }));
        const listName = `CGPS List - Chunk ${listNumber}`;

        await requestGateway(`/lists`, {
            method: 'POST',
            body: JSON.stringify({
                name: listName,
                type: 'DOMAIN',
                items: chunk,
            }),
        });

        totalListNumber--;
        listNumber++;
    }
};
