/**
 * MongoDB Database Client
 * 
 * Singleton client for connecting to MongoDB
 */

import { MongoClient, Db, ServerApiVersion } from 'mongodb';
import { logWithContext } from '../observability/instrumentation.js';

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Get or create MongoDB client instance
 * @returns Initialized MongoDB client and database
 * @throws Error if environment variables are missing
 */
export async function getMongoClient(): Promise<{ client: MongoClient; db: Db }> {
    if (client && db) {
        return { client, db };
    }

    const url = process.env.MONGO_URL;
    const dbName = process.env.MONGO_DB_NAME || 'vcon';

    if (!url) {
        throw new Error(
            'Missing MongoDB credentials. Set MONGO_URL environment variable.'
        );
    }

    logWithContext('info', 'Initializing MongoDB client', {
        url_masked: url.replace(/:([^:@]+)@/, ':***@'), // Mask password
        db_name: dbName,
    });

    try {
        client = new MongoClient(url, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: false,
                deprecationErrors: true,
            }
        });

        await client.connect();
        db = client.db(dbName);

        // Verify connection
        await db.command({ ping: 1 });
        logWithContext('info', 'MongoDB connected successfully');

    } catch (error) {
        // Reset singleton state so retry is possible
        client = null;
        db = null;

        logWithContext('error', 'Failed to connect to MongoDB', {
            error_message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }

    return { client, db };
}

/**
 * Close and reset the MongoDB client connection
 */
export async function closeMongoClient(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
        logWithContext('info', 'MongoDB connection closed');
    }
}

/**
 * Test database connectivity
 */
export async function testMongoConnection(): Promise<boolean> {
    try {
        const { db } = await getMongoClient();
        await db.command({ ping: 1 });
        return true;
    } catch (error) {
        console.error('MongoDB connection test failed:', error);
        return false;
    }
}
