import { describe, it, expect, vi } from 'vitest';
import { MongoVConQueries } from '../src/db/mongo-queries.js';

describe('MongoVConQueries.searchVCons ordering', () => {
  it('sorts by created_at DESC with uuid DESC tie-break', async () => {
    const cursor: any = {};
    cursor.sort = vi.fn().mockReturnValue(cursor);
    cursor.skip = vi.fn().mockReturnValue(cursor);
    cursor.limit = vi.fn().mockReturnValue(cursor);
    cursor.toArray = vi.fn().mockResolvedValue([{ _id: 'x', uuid: 'u1' }]);
    const collection = { find: vi.fn().mockReturnValue(cursor) };
    const db: any = { collection: vi.fn().mockReturnValue(collection) };

    const queries = new MongoVConQueries(db);
    const rows = await queries.searchVCons({ limit: 5 });

    expect(cursor.sort).toHaveBeenCalledWith({ created_at: -1, uuid: -1 });
    expect(rows).toEqual([{ uuid: 'u1' }]);
  });
});
