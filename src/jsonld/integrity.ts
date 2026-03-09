
import { createHash } from 'crypto';
import stringify from 'fast-json-stable-stringify';
import { VCon } from '../types/vcon.js';
import { EnrichedVCon } from './enrichment.js';

/**
 * Calculates a SHA-256 hash of the vCon content.
 * Uses fast-json-stable-stringify to ensure deterministic serialization.
 * Excludes the @integrity field from the hash calculation.
 * 
 * @param vcon The vCon to hash
 * @returns SHA-256 hash in hex format
 */
export function calculateHash(vcon: VCon | EnrichedVCon): string {
    // Create a shallow copy to modify
    const vconCopy = { ...vcon } as EnrichedVCon;

    // Remove @integrity field if it exists
    delete vconCopy["@integrity"];

    // Serialize deterministically
    const serialized = stringify(vconCopy);

    // Compute SHA-256 hash
    return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Adds an @integrity field to the vCon containing its SHA-256 hash.
 * 
 * @param vcon The vCon to sign
 * @returns EnrichedVCon with @integrity field
 */
export function signVCon(vcon: VCon | EnrichedVCon): EnrichedVCon {
    const hash = calculateHash(vcon);
    return {
        ...vcon,
        "@integrity": `sha256-${hash}`
    };
}

/**
 * Verifies the integrity of a vCon by recalculating the hash
 * and comparing it with the @integrity field.
 * 
 * @param vcon The vCon to verify
 * @returns true if integrity is valid, false otherwise
 */
export function verifyIntegrity(vcon: EnrichedVCon): boolean {
    if (!vcon["@integrity"]) {
        return false;
    }

    const providedHash = vcon["@integrity"];

    // Support incomplete/flexible prefixes if needed, but for now enforce sha256- prefix
    if (!providedHash.startsWith('sha256-')) {
        return false; // Unsupported algo
    }

    const calculatedHash = `sha256-${calculateHash(vcon)}`;

    return providedHash === calculatedHash;
}
