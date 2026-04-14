
import { getMongoClient, closeMongoClient } from '../src/db/mongo-client.js';
import { MongoVConQueries } from '../src/db/mongo-queries.js';
import * as fs from 'fs';

async function verifyInit() {
    console.log('Starting MongoDB Initialization Verification...');

    if (!process.env.MONGO_URL) {
        console.error('MONGO_URL not set');
        process.exit(1);
    }

    try {
        const { db } = await getMongoClient();
        const queries = new MongoVConQueries(db);

        console.log('Calling queries.initialize()...');
        await queries.initialize();
        console.log('Initialization complete.');

        console.log('Verifying indexes on "vcons" collection...');
        const indexes = await db.collection('vcons').indexes();
        console.log('Indexes found:', indexes.map(i => i.name));

        const hasUuid = indexes.some(i => i.name === 'uuid_1' || (i.key && i.key.uuid === 1));
        const hasText = indexes.some(i => i.name === 'vcon_text_search' || (i.weights && Object.keys(i.weights).length > 0));

        if (hasUuid && hasText) {
            console.log('PASS: Required indexes present (uuid_1, vcon_text_search)');
            fs.writeFileSync('verification_result.txt', 'SUCCESS: uuid_1 and vcon_text_search found');
        } else {
            console.error('FAIL: Missing required indexes');
            console.error('Has UUID Index:', hasUuid);
            console.error('Has Text Index:', hasText);
            fs.writeFileSync('verification_result.txt', `FAILURE: Valid indexes missing (uuid:${hasUuid}, text:${hasText})`);
            process.exit(1);
        }

    } catch (error) {
        console.error('Verification FAILED:', error);
        fs.writeFileSync('verification_result.txt', `ERROR: ${error}`);
        process.exit(1);
    } finally {
        await closeMongoClient();
    }
}

verifyInit();
