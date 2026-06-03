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

    // ── Index-addressed child CRUD (state continues from above: 1 party, 1 dialog) ──

    it('should add parties (append) and return new indices', async () => {
        const r1 = await queries.addParty(testUuid, { name: 'Bob' });
        const r2 = await queries.addParty(testUuid, { name: 'Carol' });
        expect(r1.index).toBe(1);
        expect(r2.index).toBe(2);
        const v = await queries.getVCon(testUuid);
        expect(v.parties).toHaveLength(3);
        expect(v.parties[2].name).toBe('Carol');
    });

    it('should replace a party (PUT)', async () => {
        await queries.updateParty(testUuid, 1, { name: 'Bob2', tel: '+15550001' });
        const v = await queries.getVCon(testUuid);
        expect(v.parties[1].name).toBe('Bob2');
        expect(v.parties[1].tel).toBe('+15550001');
    });

    it('should remove a party as an index-preserving placeholder (no renumber)', async () => {
        await queries.removeParty(testUuid, 1);
        const v = await queries.getVCon(testUuid);
        expect(v.parties).toHaveLength(3);          // slot preserved
        expect(v.parties[1].name).toBeFalsy();      // emptied (Mongo stores literal {})
        expect(v.parties[2].name).toBe('Carol');    // index 2 untouched
    });

    it('should remove a party as {name:"anonymous"} when anonymize=true', async () => {
        await queries.removeParty(testUuid, 2, { anonymize: true });
        const v = await queries.getVCon(testUuid);
        expect(v.parties[2].name).toBe('anonymous');
    });

    it('should replace the dialog (PUT)', async () => {
        await queries.updateDialog(testUuid, 0, { type: 'text', body: 'edited', encoding: 'none' });
        const v = await queries.getVCon(testUuid);
        expect(v.dialog![0].body).toBe('edited');
    });

    it('should remove the dialog as a content-stripped placeholder keeping type', async () => {
        await queries.removeDialog(testUuid, 0);
        const v = await queries.getVCon(testUuid);
        expect(v.dialog).toHaveLength(1);            // slot preserved
        expect(v.dialog![0].type).toBeDefined();
        expect(v.dialog![0].body).toBeFalsy();
    });

    it('should compact analysis on remove (referential leaf)', async () => {
        await queries.addAnalysis(testUuid, { type: 'summary', vendor: 'V0', body: 'first', encoding: 'none' });
        await queries.addAnalysis(testUuid, { type: 'sentiment', vendor: 'V1', body: 'second', encoding: 'none' });
        await queries.removeAnalysis(testUuid, 0);
        const v = await queries.getVCon(testUuid);
        expect(v.analysis).toHaveLength(1);
        expect(v.analysis![0].vendor).toBe('V1');    // V0 removed, V1 shifted to index 0
    });

    it('should replace and compact attachments', async () => {
        await queries.addAttachment(testUuid, { purpose: 'doc', body: 'a', encoding: 'none' });
        await queries.addAttachment(testUuid, { purpose: 'image', body: 'b', encoding: 'none' });
        await queries.updateAttachment(testUuid, 0, { purpose: 'doc-v2', body: 'a2', encoding: 'none' });
        let v = await queries.getVCon(testUuid);
        expect(v.attachments![0].purpose).toBe('doc-v2');
        await queries.removeAttachment(testUuid, 0);
        v = await queries.getVCon(testUuid);
        expect(v.attachments).toHaveLength(1);
        expect(v.attachments![0].purpose).toBe('image');
    });

    it('should reject an out-of-range index', async () => {
        await expect(queries.updateParty(testUuid, 99, { name: 'X' })).rejects.toThrow();
    });
});
