
import { randomUUID } from 'crypto';
import { VCon, Analysis } from '../src/types/vcon.js';
import {
    toJsonLd,
    enrichAnalysis,
    signVCon,
    verifyIntegrity
} from '../src/jsonld/index.js';

console.log("Starting JSON-LD Integration Verification...");
console.log("------------------------------------------------");

// 1. Create a sample vCon
const vcon: VCon = {
    vcon: "0.3.0",
    uuid: randomUUID(),
    created_at: new Date().toISOString(),
    parties: [
        { name: "Alice", tel: "+15551234567" },
        { name: "Bot", name: "AI Agent" }
    ],
    dialog: [
        {
            type: "recording",
            start: new Date().toISOString(),
            duration: 10,
            mimetype: "audio/wav",
            body: "base64encodeddata...",
            encoding: "base64url"
        }
    ],
    analysis: [
        {
            type: "transcript",
            vendor: "openai",
            schema: "transcript-schema",
            body: "Alice: Hello\nBot: Hi there"
        }
    ]
};

console.log("1. Created Base vCon:", vcon.uuid);

// 2. Test JSON-LD Context
const jsonLdVcon = toJsonLd(vcon);
console.log("\n2. Converted to JSON-LD:");
if (jsonLdVcon["@context"]) {
    console.log("   PASS: @context is present");
} else {
    console.error("   FAIL: @context is missing");
    process.exit(1);
}

// 3. Test Enrichment
console.log("\n3. Testing Analysis Enrichment:");
const analysis = vcon.analysis![0];
const enrichedAnalysis = enrichAnalysis(analysis, 0.95, "https://api.openai.com/v1/chat/completions");

console.log("   Enriched Analysis:", JSON.stringify(enrichedAnalysis, null, 2));

if (enrichedAnalysis["@confidence"] === 0.95 && enrichedAnalysis["@source"] === "https://api.openai.com/v1/chat/completions") {
    console.log("   PASS: Enrichment fields present");
} else {
    console.error("   FAIL: Enrichment fields incorrect");
    process.exit(1);
}

// 4. Test Integrity
console.log("\n4. Testing Integrity Signing & Verification:");

// Sign the JSON-LD vCon (which includes the enriched analysis if we update it)
// Let's update the vCon with enriched analysis first
jsonLdVcon.analysis = [enrichedAnalysis];

const signedVCon = signVCon(jsonLdVcon);
console.log("   Signed vCon @integrity:", signedVCon["@integrity"]);

const isValid = verifyIntegrity(signedVCon);
if (isValid) {
    console.log("   PASS: Integrity valid immediately after signing");
} else {
    console.error("   FAIL: Integrity check failed");
    process.exit(1);
}

// Tamper with data
console.log("   Tampering with data...");
signedVCon.parties[0].name = "Mallory";

const isTamperedValid = verifyIntegrity(signedVCon);
if (!isTamperedValid) {
    console.log("   PASS: Integrity check failed after tampering (Expected)");
} else {
    console.error("   FAIL: Integrity check PASSED after tampering (Unexpected)");
    process.exit(1);
}

console.log("------------------------------------------------");
console.log("Verification SUCCESS");
