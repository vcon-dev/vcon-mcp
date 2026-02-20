import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getMongoClient, closeMongoClient } from '../src/db/mongo-client.js';
import { MongoVConQueries } from '../src/db/mongo-queries.js';
import { randomUUID } from 'crypto';
import { VCon } from '../src/types/vcon.js';

// Only run if MONGO_URL is set
const runTest = process.env.MONGO_URL ? describe : describe.skip;

runTest('MongoDB VCon CRUD', () => {
    let queries: MongoVConQueries;
    const testUuid = randomUUID();
    const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        subject: 'Test MongoDB VCon',
        parties: [
            {
                name: 'Alice',
                tel: '+1234567890',
                uuid: randomUUID()
            }
        ],
        dialog: [],
        analysis: [],
        attachments: []
    };

    beforeAll(async () => {
        const { db } = await getMongoClient();
        queries = new MongoVConQueries(db);
        await queries.initialize();
    });

    afterAll(async () => {
        // Clean up
        if (queries) {
            try {
                await queries.deleteVCon(testUuid);
            } catch (e) {
                console.error('Cleanup failed', e);
            }
        }
        await closeMongoClient();
    });

    it('should create a vCon', async () => {
        const result = await queries.createVCon(testVCon);
        expect(result.uuid).toBe(testUuid);
    });

    it('should retrieve the created vCon', async () => {
        const retrieved = await queries.getVCon(testUuid);
        expect(retrieved.uuid).toBe(testUuid);
        expect(retrieved.subject).toBe(testVCon.subject);
        expect(retrieved.parties).toHaveLength(1);
        expect(retrieved.parties[0].name).toBe('Alice');
    });

    it('should find vCon by keyword search', async () => {
        // Wait briefly for text index to update? (MongoDB text indexes depend on commit interval)
        // Default is 60s? or immediate? Usually near-realtime but not atomic.
        // We'll try.

        // Simple retry loop for search
        let found = false;
        for (let i = 0; i < 5; i++) {
            const results = await queries.keywordSearch({ query: 'MongoDB' });
            if (results.some(r => r.vcon_id === testUuid)) {
                found = true;
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        expect(found).toBe(true);
    });

    it('should add a dialog', async () => {
        const dialog = {
            type: 'text' as const,
            start: new Date().toISOString(),
            duration: 10,
            parties: [0],
            originator: 0,
            mediatype: 'text/plain',
            body: 'Hello Mongo',
            encoding: 'none' as const
        };

        await queries.addDialog(testUuid, dialog);

        const updated = await queries.getVCon(testUuid);
        expect(updated.dialog).toHaveLength(1);
        expect(updated.dialog![0].body).toBe('Hello Mongo');
    });

    it('should get search count', async () => {
        const count = await queries.keywordSearchCount({ query: 'MongoDB' });
        expect(count).toBeGreaterThan(0);
    });
});
