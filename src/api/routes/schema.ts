/**
 * Schema and Examples Routes
 *
 * Endpoints for vCon JSON Schema, examples, and API documentation.
 */

import { randomUUID } from 'crypto';
import Router from '@koa/router';
import type { Context } from 'koa';
import { RestApiContext } from '../context.js';
import { sendError, sendSuccess } from '../response.js';
import { getVersionInfo } from '../../version.js';

const EXAMPLE_TYPES = ['minimal', 'phone_call', 'chat', 'email', 'video', 'full_featured'] as const;

function buildExampleVCon(type: string): any {
  const examples: Record<string, any> = {
    minimal: {
      vcon: '0.4.0', uuid: randomUUID(), created_at: new Date().toISOString(),
      parties: [{ name: 'Agent' }],
    },
    phone_call: {
      vcon: '0.4.0', uuid: randomUUID(), created_at: new Date().toISOString(),
      subject: 'Phone Call', parties: [{ name: 'Caller' }, { name: 'Agent' }], dialog: [],
    },
    chat: {
      vcon: '0.4.0', uuid: randomUUID(), created_at: new Date().toISOString(),
      subject: 'Chat', parties: [{ name: 'User' }, { name: 'Support' }], dialog: [],
    },
    email: {
      vcon: '0.4.0', uuid: randomUUID(), created_at: new Date().toISOString(),
      subject: 'Email Thread', parties: [{ mailto: 'a@example.com' }, { mailto: 'b@example.com' }], attachments: [],
    },
    video: {
      vcon: '0.4.0', uuid: randomUUID(), created_at: new Date().toISOString(),
      subject: 'Video Meeting', parties: [{ name: 'Host' }], dialog: [],
    },
    full_featured: {
      vcon: '0.4.0', uuid: randomUUID(), created_at: new Date().toISOString(),
      subject: 'Full Example', parties: [{ name: 'Alice' }, { name: 'Bob' }],
      dialog: [], analysis: [], attachments: [],
    },
  };
  return examples[type];
}

export function createSchemaRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  // ── GET /health — Health check ────────────────────────────────────────────
  router.get('/health', async (ctx: Context) => {
    const versionInfo = getVersionInfo();
    try {
      // Backend-agnostic health probe
      const connInfo = await apiContext.dbInspector.getConnectionInfo();
      ctx.body = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        version: versionInfo.version,
        gitCommit: versionInfo.gitCommit,
        buildTime: versionInfo.buildTime,
        ...connInfo,
      };
    } catch (error) {
      ctx.status = 503;
      ctx.body = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        version: versionInfo.version,
        gitCommit: versionInfo.gitCommit,
        buildTime: versionInfo.buildTime,
      };
    }
  });

  // ── GET /version — Version info ───────────────────────────────────────────
  router.get('/version', (ctx: Context) => {
    const versionInfo = getVersionInfo();
    ctx.body = {
      version: versionInfo.version,
      gitCommit: versionInfo.gitCommit,
      buildTime: versionInfo.buildTime,
      isDev: versionInfo.isDev,
    };
  });

  // ── GET /schema — vCon JSON Schema ────────────────────────────────────────
  router.get('/schema', async (ctx: Context) => {
    const format = ctx.query.format as string || 'json_schema';
    if (format === 'typescript') {
      sendSuccess(ctx, {
        format: 'typescript',
        message: 'TypeScript definitions are available in the vcon-mcp source at src/types/vcon.ts',
        reference: 'https://github.com/vcon-dev/vcon-mcp/blob/main/src/types/vcon.ts',
      });
    } else {
      // Return the IETF vCon spec info
      sendSuccess(ctx, {
        format: 'json_schema',
        spec_version: '0.4.0',
        ietf_draft: 'draft-ietf-vcon-vcon-core-02',
        message: 'Full JSON Schema is available in the vCon IETF specification',
        reference: 'https://datatracker.ietf.org/doc/draft-ietf-vcon-vcon-core/',
      });
    }
  });

  // ── GET /examples/:type — Example vCons ───────────────────────────────────
  router.get('/examples/:type', async (ctx: Context) => {
    const exampleType = ctx.params.type;
    if (!EXAMPLE_TYPES.includes(exampleType as any)) {
      return sendError(ctx, 400, `Invalid example type. Must be one of: ${EXAMPLE_TYPES.join(', ')}`);
    }

    const example = buildExampleVCon(exampleType);
    sendSuccess(ctx, { type: exampleType, vcon: example });
  });

  return router;
}
