/**
 * core-05 tool behaviour: create_vcon with Sessions and Events, 0.4.0 input migrated on create,
 * get_vcon reporting a migration on read, add_dialog Session membership, add_attachment scope,
 * tool input schemas.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import {
  AddAttachmentHandler,
  AddDialogHandler,
  CreateVConFromTemplateHandler,
  CreateVConHandler,
  GetVConHandler,
} from '../../src/tools/handlers/vcon-crud.js';
import { VConService, VConValidationError } from '../../src/services/vcon-service.js';
import {
  addAttachmentTool,
  addDialogTool,
  allTools,
  createVConTool,
  DialogSchema,
  EventSchema,
  SessionSchema,
  updateDialogTool,
} from '../../src/tools/vcon-crud.js';
import { migrateOnRead } from '../../src/utils/vcon-migration.js';
import { ToolHandlerContext } from '../../src/tools/handlers/base.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

const T = '2026-01-01T00:00:00Z';
const body = (r: any) => JSON.parse(r.content[0].text);

describe('core-05 tools', () => {
  let queries: any;
  let pluginManager: any;
  let service: VConService;
  let ctx: ToolHandlerContext;

  beforeEach(() => {
    queries = {
      createVCon: vi.fn(async (v: any) => ({ uuid: v.uuid, id: v.uuid })),
      saveMigrationReport: vi.fn(async () => undefined),
      getVCon: vi.fn(),
      addDialog: vi.fn(async () => ({ index: 1, session: 0, sessionCreated: false })),
      addAttachment: vi.fn(async (_u: string, a: any) => ({ index: 0, attachment: a })),
    };
    pluginManager = { executeHook: vi.fn().mockResolvedValue(undefined) };
    service = new VConService({ queries, pluginManager } as any);
    ctx = { queries, pluginManager, vconService: service, dbInspector: {}, dbAnalytics: {}, dbSizeAnalyzer: {}, supabase: {} } as any;
  });

  describe('create_vcon', () => {
    it('stores Sessions and Events as given and stamps 0.5.0', async () => {
      const result = await new CreateVConHandler().handle({
        parties: [{ name: 'A' }, { name: 'B' }],
        sessions: [{ start: T, parties: [0, 1], dialog: [0] }],
        dialog: [{ type: 'recording', start: T, parties: [0, 1], url: 'https://e.com/a.wav', content_hash: 'sha512-K7gkq531t9atY96FBDkQ9b7tiTZxnlO-X17gnDOayQY6NU4tWLz6AXZxFK7R_l_kqwI_iDUVkqvg2ljFK0Z-4Q' }],
        events: [{ type: 'join', time: T, sessions: 0, party: 0 }],
        redacted_from: { uuid: randomUUID(), type: 'pii' },
      }, ctx);
      const stored = queries.createVCon.mock.calls[0][0];
      expect(stored.vcon).toBe('0.5.0');
      expect(stored.sessions).toHaveLength(1);
      expect(stored.events).toHaveLength(1);
      expect(stored.redacted_from.type).toBe('pii');
      expect(body(result).migration_report).toBeUndefined();
    });

    it('rejects dialog with no Session, an Event that breaks the type table, and a legacy Dialog parameter', async () => {
      const handler = new CreateVConHandler();
      const dialog = [{ type: 'recording', parties: [0], url: 'https://e.com/a.wav', content_hash: 'sha512-K7gkq531t9atY96FBDkQ9b7tiTZxnlO-X17gnDOayQY6NU4tWLz6AXZxFK7R_l_kqwI_iDUVkqvg2ljFK0Z-4Q' }];
      await expect(handler.handle({ vcon: '0.5.0', parties: [{ name: 'A' }], dialog }, ctx)).rejects.toThrow(/At least one Session/);
      await expect(handler.handle({
        parties: [{ name: 'A' }], sessions: [{}], events: [{ type: 'keydown', time: T, sessions: 0, party: 0 }],
      }, ctx)).rejects.toThrow(/missing required field: button/);
      await expect(handler.handle({
        vcon: '0.5.0', parties: [{ name: 'A' }], sessions: [{}], dialog: [{ ...dialog[0], originator: 0 }],
      }, ctx)).rejects.toThrow(/originator/);
      expect(queries.createVCon).not.toHaveBeenCalled();
    });

    it('migrates a 0.4.0 vCon on create and returns the migration report', async () => {
      const result = await new CreateVConHandler().handle({
        vcon: '0.4.0',
        parties: [{ name: 'A' }, { name: 'B' }],
        dialog: [{
          type: 'recording', start: T, duration: 30, parties: [0, 1], originator: 1, url: 'https://e.com/a.wav', content_hash: 'sha512-K7gkq531t9atY96FBDkQ9b7tiTZxnlO-X17gnDOayQY6NU4tWLz6AXZxFK7R_l_kqwI_iDUVkqvg2ljFK0Z-4Q',
          party_history: [{ party: 0, time: T, event: 'join' }],
        }],
        redacted: { uuid: randomUUID(), type: 'pii' },
      }, ctx);
      const stored = queries.createVCon.mock.calls[0][0];
      expect(stored.vcon).toBe('0.5.0');
      expect(stored.sessions[0]).toMatchObject({ parties: [0, 1], originator: 1, dialog: [0] });
      expect(stored.events).toEqual([{ type: 'join', time: T, sessions: 0, party: 0 }]);
      expect(stored.redacted_from.type).toBe('pii');
      expect(stored).not.toHaveProperty('redacted');
      expect(stored.dialog[0]).not.toHaveProperty('party_history');
      const r = body(result);
      expect(r.migration_report.source_version).toBe('0.4.0');
      expect(r.migration_report.summary).toMatch(/inferred/);
      // The report is stored with the record (the reference requires it for a production migration).
      expect(queries.saveMigrationReport).toHaveBeenCalledWith(stored.uuid, expect.objectContaining({ source_version: '0.4.0' }), 'create');
    });

    it('does not store a migration report for a vCon posted as 0.5.0', async () => {
      await new CreateVConHandler().handle({ parties: [{ name: 'A' }] }, ctx);
      expect(queries.saveMigrationReport).not.toHaveBeenCalled();
    });

    it('still creates the vCon when the report cannot be stored', async () => {
      queries.saveMigrationReport.mockRejectedValueOnce(new Error('no table'));
      const result = await new CreateVConHandler().handle({
        vcon: '0.4.0', parties: [{ name: 'A' }, { name: 'B' }],
        dialog: [{ type: 'recording', start: T, parties: [0, 1], url: 'https://e.com/a.wav', content_hash: 'sha512-K7gkq531t9atY96FBDkQ9b7tiTZxnlO-X17gnDOayQY6NU4tWLz6AXZxFK7R_l_kqwI_iDUVkqvg2ljFK0Z-4Q' }],
      }, ctx);
      expect(queries.createVCon).toHaveBeenCalledTimes(1);
      expect(body(result).migration_report.source_version).toBe('0.4.0');
    });

    it('treats dialog with no sessions and no vcon as the 0.4.0 shape and migrates it', async () => {
      await new CreateVConHandler().handle({
        parties: [{ name: 'A' }],
        dialog: [{ type: 'text', start: T, parties: [0], body: 'hi', encoding: 'none' }],
      }, ctx);
      const stored = queries.createVCon.mock.calls[0][0];
      expect(stored.sessions).toHaveLength(1);
      expect(stored.sessions[0].dialog).toEqual([0]);
    });

    it('maps the deprecated aliases and adds the extensions it must list', async () => {
      await new CreateVConHandler().handle({
        parties: [{ name: 'A' }], sessions: [{}], must_support: ['x-ext'], amended: { uuid: randomUUID() },
        attachments: [{ purpose: 'lawful_basis', party: 0, session: 0, mediatype: 'application/json', encoding: 'json', body: '{"lawful_basis":"consent"}' }],
      }, ctx);
      const stored = queries.createVCon.mock.calls[0][0];
      expect(stored.critical).toEqual(['x-ext']);
      expect(stored.amended_from).toBeDefined();
      expect(stored).not.toHaveProperty('amended');
      expect([...stored.extensions].sort()).toEqual(['lawful_basis', 'x-ext']);
    });

    it('a migration that cannot complete is a validation error, not a crash', async () => {
      const bad = {
        vcon: '0.4.0', parties: [{ name: 'A' }],
        dialog: [{ type: 'transfer', transferee: 0, transferor: 0, transfer_target: 0, original: 0 }],
      };
      // no start anywhere and created_at is defaulted, so this still migrates; force the failure
      await expect(service.create({ ...bad, created_at: 'not a date' } as any)).rejects.toBeInstanceOf(VConValidationError);
    });
  });

  describe('get_vcon', () => {
    it('reports the migration when the stored vCon was 0.4.0, in every response format', async () => {
      const stored = {
        vcon: '0.4.0', uuid: randomUUID(), created_at: T, parties: [{ name: 'A' }, { name: 'B' }],
        dialog: [{ type: 'recording', start: T, parties: [0, 1], url: 'https://e.com/a.wav', content_hash: 'sha512-K7gkq531t9atY96FBDkQ9b7tiTZxnlO-X17gnDOayQY6NU4tWLz6AXZxFK7R_l_kqwI_iDUVkqvg2ljFK0Z-4Q' }],
        analysis: [{ type: 'summary', vendor: 'v', dialog: 0, body: 's', encoding: 'none' }],
      };
      queries.getVCon.mockImplementation(async () => migrateOnRead(stored));
      for (const response_format of ['full', 'summary', 'metadata']) {
        const r = body(await new GetVConHandler().handle({ uuid: stored.uuid, response_format }, ctx));
        expect(r.vcon.vcon).toBe('0.5.0');
        expect(r.migration_report.source_version).toBe('0.4.0');
      }
      const full = body(await new GetVConHandler().handle({ uuid: stored.uuid }, ctx));
      expect(full.vcon.sessions).toHaveLength(1);
      const summary = body(await new GetVConHandler().handle({ uuid: stored.uuid, response_format: 'summary' }, ctx));
      expect(summary.vcon.sessions).toHaveLength(1);
      expect(summary.vcon.analysis).toHaveLength(1);
    });

    it('keeps the report when an afterRead hook returns a different object', async () => {
      const stored = { vcon: '0.4.0', uuid: randomUUID(), created_at: T, parties: [{ name: 'A' }], dialog: [{ type: 'text', start: T, parties: [0], body: 'x', encoding: 'none' }] };
      queries.getVCon.mockImplementation(async () => migrateOnRead(stored));
      pluginManager.executeHook.mockImplementation(async (hook: string, vcon: any) =>
        hook === 'afterRead' ? { ...vcon, subject: 'redacted' } : undefined);
      const r = body(await new GetVConHandler().handle({ uuid: stored.uuid }, ctx));
      expect(r.vcon.subject).toBe('redacted');
      expect(r.migration_report).toBeDefined();
    });

    it('no report for a 0.5.0 vCon', async () => {
      queries.getVCon.mockResolvedValue({ vcon: '0.5.0', uuid: randomUUID(), created_at: T, parties: [{ name: 'A' }] });
      expect(body(await new GetVConHandler().handle({ uuid: randomUUID() }, ctx)).migration_report).toBeUndefined();
    });
  });

  describe('add_dialog', () => {
    it('passes the Session and new_session options through and returns where the dialog landed', async () => {
      const uuid = randomUUID();
      queries.addDialog.mockResolvedValue({ index: 3, session: 1, sessionCreated: false });
      const r = body(await new AddDialogHandler().handle({
        vcon_uuid: uuid, session: 1, dialog: { type: 'text', body: 'hi', encoding: 'none', parties: [0] },
      }, ctx));
      expect(queries.addDialog).toHaveBeenCalledWith(uuid, expect.objectContaining({ type: 'text' }), { session: 1, newSession: undefined });
      expect(r).toMatchObject({ index: 3, session: 1, session_created: false });
    });

    it('warns when it created a Session with no parties, and forwards new_session', async () => {
      queries.addDialog.mockResolvedValue({ index: 0, session: 0, sessionCreated: true });
      const r = body(await new AddDialogHandler().handle({
        vcon_uuid: randomUUID(), dialog: { type: 'text', body: 'hi', encoding: 'none' },
      }, ctx));
      expect(r.session_created).toBe(true);
      expect(r.warnings.join()).toContain('no parties');
      await new AddDialogHandler().handle({
        vcon_uuid: randomUUID(), dialog: { type: 'text', body: 'hi', encoding: 'none' }, new_session: { parties: [0, 1], dialog: [9] },
      }, ctx);
      expect(queries.addDialog.mock.calls[1][2].newSession).toEqual({ parties: [0, 1] });
    });

    it('rejects a legacy parameter and a missing type', async () => {
      const handler = new AddDialogHandler();
      await expect(handler.handle({ vcon_uuid: randomUUID(), dialog: { type: 'text', originator: 0 } }, ctx)).rejects.toThrow(McpError);
      await expect(handler.handle({ vcon_uuid: randomUUID(), dialog: { body: 'x', encoding: 'none' } }, ctx)).rejects.toThrow(McpError);
      await expect(handler.handle({ vcon_uuid: randomUUID(), dialog: {} }, ctx)).rejects.toThrow(McpError);
    });

    it('maps a Session index error from the query layer to InvalidParams', async () => {
      const { ChildIndexError } = await import('../../src/utils/vcon-children.js');
      queries.addDialog.mockRejectedValue(new ChildIndexError('vCon has 2 Sessions: pass session'));
      await expect(new AddDialogHandler().handle({ vcon_uuid: randomUUID(), dialog: { type: 'text', body: 'x', encoding: 'none' } }, ctx))
        .rejects.toMatchObject({ code: -32602 });
    });
  });

  describe('add_attachment', () => {
    it('requires party', async () => {
      await expect(new AddAttachmentHandler().handle({
        vcon_uuid: randomUUID(), attachment: { purpose: 'note', session: 0, body: 'x', encoding: 'none' },
      }, ctx)).rejects.toThrow(/party/);
    });

    it('reports a defaulted Session scope and maps a scope error to InvalidParams', async () => {
      queries.addAttachment.mockImplementation(async (_u: string, a: any) => ({ index: 2, attachment: { ...a, session: 0 } }));
      const r = body(await new AddAttachmentHandler().handle({
        vcon_uuid: randomUUID(), attachment: { purpose: 'note', party: 0, body: 'x', encoding: 'none' },
      }, ctx));
      expect(r).toMatchObject({ index: 2, scope_defaulted: 'session' });
      expect(r.attachment.session).toBe(0);

      const { AttachmentScopeError } = await import('../../src/utils/vcon-children.js');
      queries.addAttachment.mockRejectedValue(new AttachmentScopeError('attachment needs a scope'));
      await expect(new AddAttachmentHandler().handle({
        vcon_uuid: randomUUID(), attachment: { purpose: 'note', party: 0, body: 'x', encoding: 'none' },
      }, ctx)).rejects.toMatchObject({ code: -32602 });
    });

    it('warns about a lawful_basis attachment that is not scoped with party plus session', async () => {
      const r = body(await new AddAttachmentHandler().handle({
        vcon_uuid: randomUUID(),
        attachment: { purpose: 'lawful_basis', party: 0, dialog: 0, mediatype: 'application/json', encoding: 'json', body: { lawful_basis: 'consent' } },
      }, ctx));
      expect(r.warnings.join()).toContain('session is missing');
    });
  });

  describe('create_vcon_from_template', () => {
    it('carries a supplied lawful basis scoped with party plus session, and an empty Session', async () => {
      await new CreateVConFromTemplateHandler().handle({
        template_name: 'phone_call', parties: [{ name: 'A' }, { name: 'B' }],
        lawful_basis: { lawful_basis: 'legitimate_interests', expiration: null }, lawful_basis_party: 1,
      }, ctx);
      const stored = queries.createVCon.mock.calls[0][0];
      expect(stored.sessions).toEqual([{}]);
      expect(stored.extensions).toEqual(['lawful_basis']);
      expect(stored.attachments[0]).toMatchObject({ purpose: 'lawful_basis', party: 1, session: [0] });
    });

    it('invents nothing when no lawful basis is supplied', async () => {
      const r = body(await new CreateVConFromTemplateHandler().handle({ template_name: 'phone_call', parties: [{ name: 'A' }] }, ctx));
      const stored = queries.createVCon.mock.calls[0][0];
      expect(stored.attachments).toBeUndefined();
      expect(stored.sessions).toBeUndefined();
      expect(r.warnings.join()).toContain('no lawful_basis attachment');
    });
  });
});

describe('tool schemas', () => {
  it('create_vcon accepts sessions, events, redacted_from, amended_from, redacted_strings and vcon', () => {
    const props = createVConTool.inputSchema.properties as Record<string, any>;
    for (const key of ['sessions', 'events', 'redacted_from', 'amended_from', 'redacted_strings', 'vcon']) {
      expect(props[key], key).toBeDefined();
    }
    expect(props.dialog.items.properties).not.toHaveProperty('originator');
    expect(props.dialog.items.properties).not.toHaveProperty('party_history');
    expect(props.dialog.items.properties.type.enum).toEqual(['recording', 'text', 'incomplete']);
    expect(props.events.items.properties.type.enum).toContain('blind-transfer');
    expect(props.events.items.required).toEqual(['type', 'time']);
    expect(props.attachments.items.properties.session).toBeDefined();
    expect(props.analysis.items.properties.sessions).toBeDefined();
  });

  it('add_dialog takes session and new_session; add_attachment takes session and requires party; update_dialog allows {}', () => {
    expect((addDialogTool.inputSchema.properties as any).session).toMatchObject({ type: 'integer' });
    expect((addDialogTool.inputSchema.properties as any).new_session).toBeDefined();
    const att = (addAttachmentTool.inputSchema.properties as any).attachment;
    expect(att.properties.session).toBeDefined();
    expect(att.required).toEqual(['party']);
    expect((updateDialogTool.inputSchema.properties as any).dialog.required).toBeUndefined();
  });

  it('every tool description set that mentioned a transfer dialog no longer does', () => {
    const text = JSON.stringify(allTools);
    expect(text).not.toContain('recording, text, transfer, incomplete');
  });

  it('Zod: Event type table, Session, Dialog placeholder and contributors', () => {
    expect(EventSchema.safeParse({ type: 'join', time: T, sessions: 0, party: 0 }).success).toBe(true);
    expect(EventSchema.safeParse({ type: 'blind-transfer', time: T, sessions: 0, party: 0 }).success).toBe(false);
    expect(EventSchema.safeParse({ type: 'x-custom', time: T, whatever: 1 }).success).toBe(true);
    expect(SessionSchema.safeParse({}).success).toBe(true);
    expect(SessionSchema.safeParse({ parties: [0, -1] }).success).toBe(false);
    expect(DialogSchema.safeParse({}).success).toBe(true);
    expect(DialogSchema.safeParse({ type: 'text', parties: [0, null] }).success).toBe(true);
    expect(DialogSchema.safeParse({ type: 'recording', parties: [[0], [1, 2]] }).success).toBe(true);
    expect(DialogSchema.safeParse({ type: 'transfer' }).success).toBe(false);
    expect(DialogSchema.safeParse({ type: 'audio' }).success).toBe(false);
    expect(DialogSchema.safeParse({ body: 'x' }).success).toBe(false);
    const legacy = DialogSchema.safeParse({ type: 'recording', recordings: [0], recording_set: 1 });
    expect(legacy.success).toBe(false);
  });
});
