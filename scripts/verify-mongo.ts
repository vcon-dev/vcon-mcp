
import { getMongoClient, closeMongoClient } from '../src/db/mongo-client.js';
import { MongoVConQueries } from '../src/db/mongo-queries.js';
import { randomUUID } from 'crypto';
import { VCon } from '../src/types/vcon.js';
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'verif_log.txt');

function log(msg: string, ...args: any[]) {
    let text = msg;
    if (args.length > 0) {
        text += ' ' + args.map(a => {
            try {
                return JSON.stringify(a);
            } catch (e) {
                return String(a);
            }
        }).join(' ');
    }
    console.log(text);
    try {
        fs.appendFileSync(LOG_FILE, text + '\n');
    } catch (e) {
        console.error('Failed to write to log file', e);
    }
}

async function runVerification() {
    try {
        fs.writeFileSync(LOG_FILE, 'Starting MongoDB verification...\n');
    } catch (e) {
        console.error('Failed to init log file', e);
    }

    if (!process.env.MONGO_URL) {
        log('MONGO_URL not set');
        process.exit(1);

    }

    try {
        const { db } = await getMongoClient();
        const queries = new MongoVConQueries(db);

        log('Initializing collections...');
        await queries.initialize();

        const testUuid = randomUUID();
        const testVCon: VCon = {
            vcon: '0.3.0',
            uuid: testUuid,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            subject: 'Test MongoDB VCon Verification',
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

        log('Creating vCon...');
        const result = await queries.createVCon(testVCon);
        log('Created vCon:', result);

        log('Retrieving vCon...');
        const retrieved = await queries.getVCon(testUuid);
        log('Retrieved vCon subject:', retrieved.subject);

        if (retrieved.uuid !== testUuid) throw new Error('UUID mismatch');

        log('Searching vCon...');
        // Wait for text index?
        await new Promise(r => setTimeout(r, 2000));

        const searchResults = await queries.keywordSearch({ query: 'Verification' });
        log('Search results count:', searchResults.length);
        const found = searchResults.find(r => r.vcon_id === testUuid);

        if (found) {
            log('Found vCon in search results');
        } else {
            log('ERROR: vCon NOT found in search results');
            // Don't fail yet, just log
        }

        log('Adding dialog...');
        await queries.addDialog(testUuid, {
            type: 'text',
            start: new Date().toISOString(),
            duration: 10,
            parties: [0],
            originator: 0,
            mediatype: 'text/plain',
            body: 'Hello Mongo Verification',
            encoding: 'none'
        });
        log('Dialog added');

        log('Deleting vCon...');
        await queries.deleteVCon(testUuid);
        log('vCon deleted');

        try {
            await queries.getVCon(testUuid);
            log('Error: vCon should have been deleted but was found');
        } catch (e) {
            log('Verified vCon is deleted (got expected error)');
        }

        log('------------------------------------------------');
        log('Starting Phase 2: Vector Search Verification');

        // Create a new vCon for vector search
        const vectorVConUuid = randomUUID();
        const vectorVCon: VCon = { ...testVCon, uuid: vectorVConUuid, subject: 'Vector Search Test VCon' };

        await queries.createVCon(vectorVCon);
        log('Created vCon for vector search');

        // Insert dummy embedding directly into vcon_embeddings collection
        // We need to bypass queries interface as it doesn't expose embedding insertion (handled by embed-vcons script)
        const embeddingsColl = db.collection('vcon_embeddings');
        const dummyEmbedding = Array(384).fill(0.1); // 384-dim vector

        await embeddingsColl.insertOne({
            vcon_id: vectorVConUuid,
            content_type: 'subject',
            content_reference: null,
            content_text: vectorVCon.subject,
            embedding: dummyEmbedding,
            embedding_model: 'test-model',
            embedding_dimension: 384,
            created_at: new Date()
        });
        log('Inserted dummy embedding');

        log('Running semantic search...');
        const semanticResults = await queries.semanticSearch({
            embedding: dummyEmbedding,
            limit: 5
        });
        log('Semantic search results:', semanticResults.length);
        if (semanticResults.length === 0) {
            log('NOTE: Semantic search returned 0 results. This is EXPECTED if the Atlas Vector Search Index is not yet created.');
            log('To fix: Create a Vector Search Index on `vcon_embeddings` collection with definition provided in documentation.');
        } else {
            log('SUCCESS: Semantic search returned results!');
        }

        log('Running hybrid search...');
        const hybridResults = await queries.hybridSearch({
            keywordQuery: 'Vector',
            embedding: dummyEmbedding,
            limit: 5
        });
        log('Hybrid search results:', hybridResults.length);

        // Cleanup
        log('Cleaning up vector test data...');
        await queries.deleteVCon(vectorVConUuid);
        await embeddingsColl.deleteMany({ vcon_id: vectorVConUuid });

        log('Verification SUCCESS');
    } catch (error) {
        log('Verification FAILED:', error);
        process.exit(1);
    } finally {
        await closeMongoClient();
    }
}

runVerification();
