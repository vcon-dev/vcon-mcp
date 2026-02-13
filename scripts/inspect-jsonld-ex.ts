
import * as core from '@jsonld-ex/core';
// Try importing from extensions if available
// @ts-ignore
import * as security from '@jsonld-ex/core/dist/extensions/security.js';
// @ts-ignore
import * as aiml from '@jsonld-ex/core/dist/extensions/ai-ml.js';

console.log('AI/ML Exports:', JSON.stringify(Object.keys(aiml || {}), null, 2));
