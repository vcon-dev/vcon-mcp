
import { getMongoClient, closeMongoClient } from '../src/db/mongo-client.js';
import { MongoDatabaseInspector } from '../src/db/mongo-inspector.js';
import { MongoDatabaseAnalytics } from '../src/db/mongo-analytics.js';
import { MongoDatabaseSizeAnalyzer } from '../src/db/mongo-size-analyzer.js';
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'verif_analytics_log.txt');

function log(msg: string, ...args: any[]) {
    let text = msg;
    if (args.length > 0) {
        text += ' ' + args.map(a => {
            try {
                return JSON.stringify(a, null, 2);
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
        fs.writeFileSync(LOG_FILE, 'Starting MongoDB Analytics Verification...\n');
    } catch (e) {
        console.error('Failed to init log file', e);
    }

    if (!process.env.MONGO_URL) {
        log('MONGO_URL not set');
        process.exit(1);
    }

    try {
        const { db } = await getMongoClient();

        const inspector = new MongoDatabaseInspector(db);
        const analytics = new MongoDatabaseAnalytics(db);
        const sizeAnalyzer = new MongoDatabaseSizeAnalyzer(db);

        log('------------------------------------------------');
        log('Testing MongoDatabaseInspector');
        log('------------------------------------------------');

        log('Getting Connection Info...');
        const connInfo = await inspector.getConnectionInfo();
        log('Connection Info:', connInfo);

        log('Getting Database Shape...');
        const shape = await inspector.getDatabaseShape({ includeCounts: true });
        log('Database Shape (Collections):', shape.collections.map((c: any) => `${c.name} (${c.document_count} docs)`));

        log('------------------------------------------------');
        log('Testing MongoDatabaseAnalytics');
        log('------------------------------------------------');

        log('Getting Database Analytics (Summary)...');
        const dbAnalyticsRes = await analytics.getDatabaseAnalytics({
            includeGrowthTrends: false,
            includeContentAnalytics: false
        });
        log('Analytics Summary:', dbAnalyticsRes.summary);

        log('Getting Attachment Analytics...');
        const attachmentAnalytics = await analytics.getAttachmentAnalytics();
        log('Attachment Types:', attachmentAnalytics.types);

        log('Getting Tag Analytics...');
        const tagAnalytics = await analytics.getTagAnalytics();
        log('Tag Keys:', tagAnalytics.tag_keys);

        log('------------------------------------------------');
        log('Testing MongoDatabaseSizeAnalyzer');
        log('------------------------------------------------');

        log('Getting Database Size Info...');
        const sizeInfo = await sizeAnalyzer.getDatabaseSizeInfo();
        log('Size Info:', {
            total_vcons: sizeInfo.total_vcons,
            size_category: sizeInfo.size_category,
            total_size_pretty: sizeInfo.total_size_pretty
        });

        log('Getting Smart Search Limits (Basic)...');
        const smartLimits = await sizeAnalyzer.getSmartSearchLimits('basic', 'small');
        log('Smart Limits:', smartLimits);

        log('------------------------------------------------');
        log('Verification SUCCESS');

    } catch (error) {
        log('Verification FAILED:', error);
        process.exit(1);
    } finally {
        await closeMongoClient();
    }
}

runVerification();
