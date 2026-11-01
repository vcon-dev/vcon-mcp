/**
 * Migrate a vCon from syntax 0.4.0 to 0.5.0 (draft-ietf-vcon-vcon-core-05, Appendix A.1).
 *
 * Port of the Python reference (vcon-lib, src/vcon/migration.py). The migration
 * is table driven: MIGRATION_STEPS holds one entry per step T1..T15 of the
 * ordered transform table, each one function that mutates a shared context.
 *
 * Execution order (the draft gives none; inferred so that every `dialog` index
 * stays valid): steps that read the 0.4.0 `dialog` array run before any array
 * is rewritten, and T10 blanks the removed Dialogs in place at the end.
 *
 *   T13 T15 T1  ->  T8 T9 T9b T6  ->  T2 T7 T4(+T5) T3  ->  T10 T10b T10c  ->  T11 T12 T14
 *
 * T4 runs before T3 so the Sessions T5 creates for a transfer's original,
 * consultation and target calls are known when T3 builds the party_history
 * Events: an Event lists every Session of the Dialog it came from.
 *
 * Nothing is invented silently. Every value the draft does not dictate is in
 * the MigrationReport as `inferred`, every field filled by a fallback as
 * `fallback`, every unresolved problem as `unresolved`. In strict mode a
 * fallback throws MigrationError instead.
 *
 * A signed 0.4.0 vCon is migrated as its unsigned payload. The migration never
 * signs; the report sets `resign_required`.
 */

import {
  EVENT_PARAMETERS,
  V050_ONLY_KEYS,
  extensionsInUse,
  validateVConDocument,
} from './vcon-validation.js';

export const SOURCE_VERSION = '0.4.0';
export const TARGET_VERSION = '0.5.0';

type Obj = Record<string, any>;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type ReportKind = 'inferred' | 'fallback' | 'unresolved' | 'info';

export interface ReportEntry {
  step: string;
  kind: ReportKind;
  message: string;
  /** AMB-n identifier from the implementation spec. */
  code?: string;
  details?: Obj;
}

export interface MigrationReport {
  source_version: string | null;
  target_version: string;
  strict: boolean;
  /** True when the input was signed: the signature is dropped and the result is unsigned. */
  resign_required: boolean;
  entries: ReportEntry[];
  /** Original content of every Dialog replaced by `{}`, keyed by its (unchanged) index. */
  removed_dialogs: Record<string, Obj>;
  steps_run: string[];
}

export interface MigrationResult {
  vcon: Obj;
  report: MigrationReport;
}

export function reportSummary(report: MigrationReport): string {
  const n = (k: ReportKind) => report.entries.filter((e) => e.kind === k).length;
  return `${n('inferred')} inferred, ${n('fallback')} fallback, ${n('unresolved')} unresolved` +
    (report.resign_required ? '; re-signing required' : '');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
/** Key present with a value. An undefined value counts as absent (JSON never carries one). */
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Epoch seconds (microsecond precision, as Python's datetime.timestamp() gives)
 * of an ISO 8601 / RFC 3339 date-time, or null. A date-time with no zone is
 * read as UTC. Out-of-range fields (February 30, hour 24, offset of 24 hours)
 * are rejected, not rolled over, and free-form strings such as "Jan 1 2022"
 * (which Date.parse would read in the server's local zone) are not dates.
 */
export function parseDt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const [, ys, mos, ds, hs = '00', mis = '00', ss = '00', frac = '', tz = 'Z'] = m;
  const [y, mo, d, h, mi, sec] = [ys, mos, ds, hs, mis, ss].map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return null;
  if (d > (mo === 2 && leap ? 29 : DAYS_IN_MONTH[mo - 1]) || h > 23 || mi > 59 || sec > 59) return null;
  let offsetMinutes = 0;
  const t = tz.toUpperCase();
  if (t !== 'Z') {
    const digits = t.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2) || '0');
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (t[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const date = new Date(Date.UTC(2000, mo - 1, d, h, mi, sec));
  date.setUTCFullYear(y);
  const micros = frac ? Number(frac.slice(1, 7).padEnd(6, '0')) : 0;
  return (date.getTime() * 1000 + micros - offsetMinutes * 60_000_000) / 1e6;
}

/**
 * Round seconds to six decimals as the reference's round(x, 6) does: on the
 * exact binary value, ties to even (Math.round(x * 1e6) / 1e6 disagrees on
 * values such as 0.0078125).
 */
export function num(seconds: number): number {
  if (!Number.isFinite(seconds)) return seconds;
  const sign = seconds < 0 ? -1 : 1;
  const [ip, fp] = Math.abs(seconds).toFixed(100).split('.');
  const keep = fp.slice(0, 6);
  const rest = fp.slice(6);
  const up = rest[0] > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || Number(keep[5]) % 2 === 1));
  const digits = (BigInt(ip + keep) + (up ? BigInt(1) : BigInt(0))).toString().padStart(7, '0');
  const value = Number(`${digits.slice(0, -6)}.${digits.slice(-6)}`);
  return value === 0 ? 0 : sign * value;
}

function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * What Python's datetime.fromtimestamp(t, tz=timezone.utc).isoformat() gives
 * for epoch seconds t, so a derived Event time matches the reference exactly.
 */
export function isoFromSeconds(t: number): string {
  let whole = Math.trunc(t);
  let us = roundHalfEven((t - whole) * 1e6);
  if (us >= 1e6) {
    whole += 1;
    us -= 1e6;
  } else if (us < 0) {
    whole -= 1;
    us += 1e6;
  }
  const base = new Date(whole * 1000).toISOString().slice(0, 19);
  return base + (us ? '.' + String(us).padStart(6, '0') : '') + '+00:00';
}

/** Flat list of int party indices of a 0.4.0 Dialog `parties` value. */
function plainParties(value: unknown): number[] {
  const out: number[] = [];
  const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  for (const v of items) {
    if (Array.isArray(v)) out.push(...v.filter(isInt));
    else if (isInt(v)) out.push(v);
  }
  return out;
}

function union(lists: number[][]): number[] {
  const seen: number[] = [];
  for (const l of lists) for (const v of l) if (!seen.includes(v)) seen.push(v);
  return seen;
}

function renameKey(d: Obj, oldName: string, newName: string): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(d)) out[k === oldName ? newName : k] = v;
  return out;
}

const SESSION_KEY_ORDER = ['start', 'duration', 'parties', 'originator', 'session_id', 'sessions', 'dialog'];
function orderSession(s: Obj): Obj {
  const out: Obj = {};
  for (const k of SESSION_KEY_ORDER) if (k in s) out[k] = s[k];
  return out;
}

function b64urlDecode(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

class Context {
  out: Obj;
  src: Obj;
  sessions: Obj[] = [];
  events: Obj[] = [];
  /** receivers contributed to the Session by each (kept) Dialog index */
  receivers = new Map<number, number[]>();
  /** originator value taken from each (kept) Dialog index */
  originators = new Map<number, number>();
  /** Session indices each Dialog index belongs to */
  dialogSessions = new Map<number, number[]>();
  /** recording-set Dialog index -> Session index (T7) */
  rsSession = new Map<number, number>();
  /** transfer Dialog index -> Session index of its original call (T4) */
  transferSession = new Map<number, number>();
  roleSessions = new Map<number, number>();
  emptyPartyIdx: number | null = null;
  catchAll: number | null = null;

  constructor(data: Obj, readonly strict: boolean, readonly report: MigrationReport) {
    this.out = data;
    this.src = clone(data);
  }

  get dialogs(): any[] {
    return Array.isArray(this.src.dialog) ? this.src.dialog : [];
  }

  /** Dialog index -> removed type, for transfer and recording-set Dialogs. */
  get removed(): Map<number, string> {
    const m = new Map<number, string>();
    this.dialogs.forEach((d, i) => {
      if (d && typeof d === 'object' && (d.type === 'transfer' || d.type === 'recording-set')) m.set(i, d.type);
    });
    return m;
  }

  kept(): number[] {
    const rem = this.removed;
    const out: number[] = [];
    this.dialogs.forEach((d, i) => {
      if (!rem.has(i) && d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length > 0) out.push(i);
    });
    return out;
  }

  add(step: string, kind: ReportKind, message: string, code?: string, details?: Obj): void {
    const e: ReportEntry = { step, kind, message };
    if (code) e.code = code;
    if (details && Object.keys(details).length > 0) e.details = details;
    this.report.entries.push(e);
  }

  /** Record a fallback for a MUST field, or throw in strict mode. */
  needFallback(step: string, message: string, code?: string, details?: Obj): void {
    if (this.strict) throw new MigrationError(`${step}: ${message} (strict mode: no source for a required field)`);
    this.add(step, 'fallback', message, code, details);
  }

  newSession(session: Obj): number {
    this.sessions.push(session);
    return this.sessions.length - 1;
  }

  /** Index of an empty Party Object, appended once (4.3.9: unknown party). */
  emptyParty(step: string): number {
    if (this.emptyPartyIdx === null) {
      if (!Array.isArray(this.out.parties)) this.out.parties = [];
      this.out.parties.push({});
      this.emptyPartyIdx = this.out.parties.length - 1;
      this.add(step, 'inferred', `Appended an empty Party Object at parties[${this.emptyPartyIdx}] to stand for unknown parties.`, undefined, { party: this.emptyPartyIdx });
    }
    return this.emptyPartyIdx;
  }

  /** Start of a Dialog, or of a recording-set's earliest recording. */
  dialogStart(idx: unknown): string | null {
    if (!isInt(idx) || idx < 0 || idx >= this.dialogs.length) return null;
    const d = this.dialogs[idx];
    if (!d || typeof d !== 'object') return null;
    if (parseDt(d.start) !== null) return d.start;
    if (d.type === 'recording-set') {
      const starts = (Array.isArray(d.recordings) ? d.recordings : [])
        .filter((r: unknown) => isInt(r) && r >= 0 && r < this.dialogs.length && this.dialogs[r] && typeof this.dialogs[r] === 'object')
        .map((r: number) => this.dialogs[r].start)
        .filter((s: unknown) => parseDt(s) !== null) as string[];
      if (starts.length > 0) return starts.reduce((a, b) => (parseDt(b)! < parseDt(a)! ? b : a));
    }
    return null;
  }

  /** Derived (start, duration) of a group of Dialogs. */
  span(idxs: number[]): { start: string | null; duration: number | null } {
    const items = idxs
      .filter((i) => this.dialogs[i] && typeof this.dialogs[i] === 'object')
      .map((i) => ({ i, t: parseDt(this.dialogs[i].start) }))
      .filter((x): x is { i: number; t: number } => x.t !== null);
    if (items.length === 0) return { start: null, duration: null };
    const first = items.reduce((a, b) => (b.t < a.t ? b : a));
    const startStr = this.dialogs[first.i].start as string;
    const ends: number[] = [];
    let anyDuration = false;
    for (const { i, t } of items) {
      const dur = this.dialogs[i].duration;
      if (isNum(dur)) {
        anyDuration = true;
        ends.push(t + dur);
      } else {
        ends.push(t);
      }
    }
    if (!anyDuration) return { start: startStr, duration: null };
    return { start: startStr, duration: num(Math.max(...ends) - first.t) };
  }

  /** Build a Session for a group of kept Dialogs from derived values. */
  makeSession(step: string, idxs: number[], label: string): Obj {
    const session: Obj = {};
    const { start, duration } = this.span(idxs);
    if (start !== null) session.start = start;
    if (duration !== null) session.duration = duration;
    const parties = union(idxs.map((i) => this.receivers.get(i) ?? []));
    if (parties.length > 0) session.parties = parties;
    const orig = idxs.filter((i) => this.originators.has(i)).map((i) => this.originators.get(i)!);
    if (orig.length > 0) {
      const chosen = orig[0];
      const others = [...new Set(orig.slice(1).filter((o) => o !== chosen))].sort((a, b) => a - b);
      if (others.length > 0) {
        this.add(step, 'unresolved', `${label}: Dialogs name different originators; kept ${chosen}, did not record ${JSON.stringify(others)}.`, undefined, { kept: chosen, dropped: others });
      }
      if (parties.length === 0 || chosen !== parties[0]) session.originator = chosen;
    }
    session.dialog = [...idxs];
    if (start !== null || duration !== null) {
      this.add(step, 'inferred', `${label}: start/duration derived from its Dialogs (earliest start; duration to the latest end when any Dialog has a duration).`, undefined, { start, duration });
    }
    return orderSession(session);
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function t1Version(ctx: Context): void {
  if (!has(ctx.out, 'vcon')) {
    ctx.add('T1', 'inferred', "Input had no 'vcon' parameter; set to '0.5.0' (AMB-12: writers emit it).", 'AMB-12');
  }
  ctx.out.vcon = TARGET_VERSION;
}

function t2Sessions(ctx: Context): void {
  const kept = ctx.kept();
  if (kept.length === 0) return;
  ctx.catchAll = ctx.newSession(ctx.makeSession('T2', kept, 'Session 0 (all Dialogs)'));
  for (const i of kept) pushMap(ctx.dialogSessions, i, ctx.catchAll);
  ctx.add('T2', 'info', `Added Session ${ctx.catchAll} referencing ${kept.length} Dialog Object(s).`);
}

function pushMap(m: Map<number, number[]>, k: number, v: number): void {
  const cur = m.get(k);
  if (cur) cur.push(v);
  else m.set(k, [v]);
}

function t3PartyHistory(ctx: Context): void {
  const dialogs = ctx.out.dialog;
  if (!Array.isArray(dialogs)) return;
  ctx.dialogs.forEach((srcD, i) => {
    if (!srcD || typeof srcD !== 'object' || !has(srcD, 'party_history')) return;
    if (srcD.type === 'transfer') {
      ctx.add('T3', 'unresolved', `dialog[${i}] is a transfer Dialog with party_history; the entries are not migrated (A.1 covers party_history on non-transfer Dialogs). Original kept in removed_dialogs.`, undefined, { dialog: i });
      return;
    }
    const sess: number[] =
      srcD.type === 'recording-set'
        ? ctx.rsSession.has(i) ? [ctx.rsSession.get(i)!] : []
        : [...(ctx.dialogSessions.get(i) ?? [])].sort((a, b) => a - b);
    if (sess.length > 1) {
      ctx.add('T3', 'inferred', `dialog[${i}] belongs to Sessions ${JSON.stringify(sess)}; its party_history Events list all of them in 'sessions' (4.3.3: an Event applies only to the Sessions listed).`, 'AMB-3', { dialog: i, sessions: sess });
    }
    const history = srcD.party_history;
    if (!Array.isArray(history)) {
      ctx.add('T3', 'unresolved', `dialog[${i}] party_history is not a list; dropped.`, undefined, { dialog: i });
    } else {
      history.forEach((entry: any, n: number) => {
        if (!entry || typeof entry !== 'object' || !has(entry, 'event')) {
          ctx.add('T3', 'unresolved', `dialog[${i}].party_history[${n}] has no 'event'; entry not migrated.`, undefined, { dialog: i, entry });
          return;
        }
        const ev: Obj = { type: entry.event };
        if (parseDt(entry.time) !== null) {
          ev.time = entry.time;
        } else {
          // MUST field: Dialog start, then the vCon created_at.
          let fb = srcD.start;
          let source = 'Dialog start';
          if (parseDt(fb) === null) {
            fb = ctx.out.created_at;
            source = 'vCon created_at';
          }
          if (parseDt(fb) === null) {
            throw new MigrationError(`T3: dialog[${i}].party_history[${n}] has no time, and neither the Dialog start nor the vCon created_at can stand in`);
          }
          ctx.needFallback('T3', `dialog[${i}].party_history[${n}] has no usable time (${JSON.stringify(entry.time)}); used the ${source} (${JSON.stringify(fb)}) as the Event time.`, undefined, { dialog: i, entry: n, original_time: entry.time, source, time: fb });
          ev.time = fb;
        }
        if (sess.length > 0) ev.sessions = sess.length === 1 ? sess[0] : sess;
        if (isInt(entry.party)) {
          ev.party = entry.party;
        } else {
          ctx.needFallback('T3', `dialog[${i}].party_history[${n}] has no party; referenced an empty Party Object.`, undefined, { dialog: i });
          ev.party = ctx.emptyParty('T3');
        }
        if ((entry.event === 'keydown' || entry.event === 'keyup') && has(entry, 'button')) {
          ev.button = entry.button;
        } else if (has(entry, 'button')) {
          ctx.add('T3', 'unresolved', `dialog[${i}].party_history[${n}] has 'button' on a '${entry.event}' event (only keydown and keyup carry it); button not migrated.`, undefined, { dialog: i, entry: n, dropped: { button: entry.button } });
        }
        // Parameters a 0.4.0 extension added to the entry: carried onto the Event
        // unless the name is a core Event parameter (which would change its meaning).
        const unknown = Object.entries(entry).filter(([k]) => !['party', 'time', 'event', 'button'].includes(k));
        if (unknown.length > 0) {
          const core = EVENT_PARAMETERS as readonly string[];
          const carried = Object.fromEntries(unknown.filter(([k]) => !core.includes(k)));
          const dropped = Object.fromEntries(unknown.filter(([k]) => core.includes(k)));
          Object.assign(ev, carried);
          ctx.add('T3', 'unresolved', `dialog[${i}].party_history[${n}] had non-core parameter(s) ${JSON.stringify(unknown.map(([k]) => k).sort())}; carried onto the Event: ${JSON.stringify(Object.keys(carried).sort())}, dropped (name clashes with a core Event parameter): ${JSON.stringify(Object.keys(dropped).sort())}. List the defining extension in 'extensions'.`, undefined, { dialog: i, entry: n, carried, dropped });
        }
        ctx.events.push(ev);
      });
    }
    if (srcD.type !== 'recording-set' && dialogs[i] && typeof dialogs[i] === 'object') delete dialogs[i].party_history;
  });
}

function t4Transfers(ctx: Context): void {
  for (const [k, kind] of ctx.removed) {
    if (kind !== 'transfer') continue;
    const tr = ctx.dialogs[k];
    const step = 'T4';

    /** T5: Session index for a Dialog reference held by a transfer Dialog. */
    const sessionFor = (ref: unknown, role: string): number | null => {
      if (ref === undefined || ref === null) return null;
      if (!isInt(ref) || ref < 0 || ref >= ctx.dialogs.length) {
        ctx.add(step, 'unresolved', `transfer dialog[${k}] ${role}=${JSON.stringify(ref)} is not a Dialog index.`, undefined, { dialog: k });
        return null;
      }
      if (ctx.rsSession.has(ref)) {
        ctx.add('T5', 'info', `transfer dialog[${k}] ${role} -> dialog[${ref}] is a recording-set; using its Session ${ctx.rsSession.get(ref)}.`);
        return ctx.rsSession.get(ref)!;
      }
      if (ctx.removed.has(ref)) {
        const idx = ctx.newSession({});
        ctx.add('T5', 'unresolved', `transfer dialog[${k}] ${role} -> dialog[${ref}] is itself a removed ${ctx.removed.get(ref)} Dialog; created placeholder Session ${idx} with no parameters.`, undefined, { dialog: k });
        return idx;
      }
      if (ctx.roleSessions.has(ref)) return ctx.roleSessions.get(ref)!;
      const sess = ctx.makeSession('T5', [ref], `Session for transfer ${role} (dialog[${ref}])`);
      const idx = ctx.newSession(sess);
      ctx.roleSessions.set(ref, idx);
      pushMap(ctx.dialogSessions, ref, idx);
      ctx.add('T5', 'inferred', `transfer dialog[${k}] ${role} -> created Session ${idx} listing dialog[${ref}] (A.1: referenced through a Session Object).`, undefined, { dialog: k, session: idx });
      return idx;
    };

    const placeholder = (role: string, why: string, requiredFallback: boolean): number => {
      const idx = ctx.newSession({});
      const msg = `transfer dialog[${k}] has no ${role} (${why}); created placeholder Session ${idx} with no parameters (4.3.1.3).`;
      if (requiredFallback) ctx.needFallback(step, msg, undefined, { dialog: k, session: idx });
      else ctx.add(step, 'inferred', msg, 'AMB-7', { dialog: k, session: idx });
      return idx;
    };

    // Session of the original call (sessions: M, single index).
    const origRef = tr.original;
    let sidx = sessionFor(origRef, 'original');
    if (sidx === null) sidx = placeholder('original', "'sessions' is required on every transfer Event", true);
    ctx.transferSession.set(k, sidx);

    const partyRef = (key: string, role: string, required: boolean): number | null => {
      const val = tr[key];
      if (isInt(val)) return val;
      if (!required) return null;
      ctx.needFallback(step, `transfer dialog[${k}] has no ${key} (${role}); referenced an empty Party Object (4.3.9).`, undefined, { dialog: k });
      return ctx.emptyParty(step);
    };

    const transferor = partyRef('transferor', "Transferor, becomes 'party'", true);
    const transferee = partyRef('transferee', 'Transferee', true);

    const consRef = tr.consultation;
    const targetRef = tr.target_dialog;
    const hasCons = consRef !== undefined && consRef !== null;
    const hasTarget = targetRef !== undefined && targetRef !== null;
    let consSess = hasCons ? sessionFor(consRef, 'consultation') : null;
    if (hasCons && consSess === null) consSess = placeholder('usable consultation', 'consultation Dialog index could not be resolved', false);
    let targetSess = hasTarget ? sessionFor(targetRef, 'target_dialog') : null;
    const hasTargetParty = isInt(tr.transfer_target);

    // Event types (AMB-7).
    const types: string[] = [];
    if (hasCons) types.push('consultation-start');
    if (hasTarget || hasTargetParty) types.push(hasCons ? 'consultative-transfer' : 'blind-transfer');
    else types.push('transfer-abandoned');
    ctx.add(step, 'inferred', `transfer dialog[${k}] mapped to Event type(s) ${JSON.stringify(types)} (consultation present -> consultation-start + consultative-transfer; otherwise blind-transfer; no target_dialog and no transfer_target -> transfer-abandoned).`, 'AMB-7', { dialog: k, types });
    if (types.includes('blind-transfer') || types.includes('consultative-transfer')) {
      if (targetSess === null) {
        targetSess = placeholder('target_dialog', 'the target call was not captured; 4.3.1.3 uses a placeholder Session in that case', false);
      }
    }

    const eventTime = (which: 'consult' | 'transfer'): string => {
      const own = tr.start;
      if (parseDt(own) !== null) return own;
      const cands: Array<[string | null, string]> = [];
      if (which === 'consult') {
        cands.push([ctx.dialogStart(consRef), `start of consultation dialog[${consRef}]`]);
      } else {
        cands.push([ctx.dialogStart(targetRef), `start of target dialog[${targetRef}]`]);
        if (hasCons) {
          const cd = isInt(consRef) && consRef >= 0 && consRef < ctx.dialogs.length ? ctx.dialogs[consRef] : null;
          const cs = parseDt(ctx.dialogStart(consRef));
          const dur = cd && typeof cd === 'object' ? cd.duration : null;
          if (cs !== null && isNum(dur)) {
            cands.push([isoFromSeconds(cs + dur), `end of consultation dialog[${consRef}] (start + duration)`]);
          }
          cands.push([ctx.dialogStart(consRef), `start of consultation dialog[${consRef}]`]);
        }
      }
      for (const [value, source] of cands) {
        if (value && parseDt(value) !== null) {
          ctx.add(step, 'inferred', `transfer dialog[${k}] has no start; Event time taken from the ${source}, not from the transfer Dialog's own start.`, 'AMB-7', { dialog: k, source, time: value });
          return value;
        }
      }
      const created = ctx.out.created_at;
      if (parseDt(created) !== null) {
        ctx.needFallback(step, `transfer dialog[${k}] has no start and no other time source; used the vCon created_at (${JSON.stringify(created)}) as the Event time.`, 'AMB-7', { dialog: k });
        return created;
      }
      throw new MigrationError(`${step}: transfer dialog[${k}] has no start and the vCon has no created_at; no time can be sourced`);
    };

    for (const t of types) {
      const ev: Obj = { type: t };
      ev.time = eventTime(t === 'consultation-start' ? 'consult' : 'transfer');
      ev.sessions = sidx;
      ev.party = transferor;
      ev.transferee = transferee;
      const tt = partyRef('transfer_target', 'Transfer Target', t !== 'transfer-abandoned');
      if (tt !== null) ev.transfer_target = tt;
      if (t === 'consultation-start' || t === 'consultative-transfer') ev.consultation = consSess;
      else if (t === 'transfer-abandoned' && consSess !== null) ev.consultation = consSess;
      if (t === 'blind-transfer' || t === 'consultative-transfer') ev.target_session = targetSess;
      ctx.events.push(ev);
    }
    const known = ['type', 'start', 'transferee', 'transferor', 'transfer_target', 'original', 'consultation', 'target_dialog', 'parties', 'party_history'];
    const extra = Object.keys(tr).filter((key) => !known.includes(key)).sort();
    const hasParties = Array.isArray(tr.parties) ? tr.parties.length > 0 : !!tr.parties;
    if (extra.length > 0 || hasParties) {
      const fields = [...extra, ...(hasParties ? ['parties'] : [])];
      ctx.add(step, 'unresolved', `transfer dialog[${k}] had parameters with no Event equivalent (${JSON.stringify(fields)}); not migrated. Original kept in report.removed_dialogs.`, undefined, { dialog: k, dropped: Object.fromEntries(fields.map((f) => [f, tr[f]])) });
    }
  }
}

function t6Originator(ctx: Context): void {
  const dialogs = ctx.out.dialog;
  if (!Array.isArray(dialogs)) return;
  for (const i of ctx.kept()) {
    const d = dialogs[i];
    if (has(d, 'originator')) {
      const val = d.originator;
      delete d.originator;
      if (isInt(val)) ctx.originators.set(i, val);
      else ctx.add('T6', 'unresolved', `dialog[${i}] originator ${JSON.stringify(val)} is not a party index; dropped.`, undefined, { dialog: i });
    }
  }
}

function t7RecordingSets(ctx: Context): void {
  const dialogs = ctx.out.dialog;
  const rsIds = [...ctx.removed].filter(([, kind]) => kind === 'recording-set').map(([k]) => k);
  for (const k of rsIds) ctx.rsSession.set(k, ctx.newSession({}));

  // recording_set back-references from kept Dialogs.
  const back = new Map<number, number[]>();
  for (const i of ctx.kept()) {
    const ref = ctx.dialogs[i].recording_set;
    if (ref === undefined || ref === null) continue;
    if (isInt(ref) && ctx.rsSession.has(ref)) pushMap(back, ref, i);
    else ctx.add('T7', 'unresolved', `dialog[${i}] recording_set=${JSON.stringify(ref)} does not reference a recording-set Dialog; parameter removed, no Session membership derived from it.`, undefined, { dialog: i, recording_set: ref });
  }

  for (const k of rsIds) {
    const rs = ctx.dialogs[k];
    const sidx = ctx.rsSession.get(k)!;
    const recsRaw = rs.recordings;
    const recs: number[] = [];
    const children: number[] = [];
    if (Array.isArray(recsRaw)) {
      for (const r of recsRaw) {
        if (isInt(r) && ctx.rsSession.has(r) && r !== k) {
          if (!children.includes(ctx.rsSession.get(r)!)) children.push(ctx.rsSession.get(r)!);
        } else if (isInt(r) && r >= 0 && r < ctx.dialogs.length && !ctx.removed.has(r) && ctx.dialogs[r] && typeof ctx.dialogs[r] === 'object' && Object.keys(ctx.dialogs[r]).length > 0) {
          if (!recs.includes(r)) recs.push(r);
        } else {
          ctx.add('T7', 'unresolved', `recording-set dialog[${k}] lists recordings entry ${JSON.stringify(r)}, which is not a kept Dialog or another recording-set; left out of the Session.`, undefined, { dialog: k, entry: r });
        }
      }
    } else {
      ctx.add('T7', 'unresolved', `recording-set dialog[${k}] has no recordings list.`, undefined, { dialog: k });
    }
    const addedBack = (back.get(k) ?? []).filter((i) => !recs.includes(i));
    if (addedBack.length > 0) {
      recs.push(...addedBack);
      ctx.add('T7', 'inferred', `dialog(s) ${JSON.stringify(addedBack)} name recording-set dialog[${k}] in recording_set but are not in its recordings list; added to Session ${sidx}.`, undefined, { dialog: k, added: addedBack, session: sidx });
    }
    const sess: Obj = {};
    const derived = recs.length > 0 ? ctx.span(recs) : { start: null, duration: null };
    if (parseDt(rs.start) !== null) sess.start = rs.start;
    else if (derived.start !== null) sess.start = derived.start;
    if (isNum(rs.duration)) sess.duration = rs.duration;
    else if (derived.duration !== null) sess.duration = derived.duration;
    const rsParties = plainParties(rs.parties);
    const parties = rsParties.length > 0 ? rsParties : union(recs.map((r) => ctx.receivers.get(r) ?? []));
    if (parties.length > 0) sess.parties = parties;
    const orig = rs.originator;
    if (isInt(orig) && (parties.length === 0 || orig !== parties[0])) sess.originator = orig;
    else if (orig !== undefined && orig !== null && !isInt(orig)) {
      ctx.add('T7', 'unresolved', `recording-set dialog[${k}] originator ${JSON.stringify(orig)} is not a party index; dropped.`, undefined, { dialog: k });
    }
    const sid = rs.session_id;
    if (sid && typeof sid === 'object' && !Array.isArray(sid)) sess.session_id = sid;
    else if (Array.isArray(sid) && sid.length === 1 && sid[0] && typeof sid[0] === 'object') sess.session_id = sid[0];
    else if (sid !== undefined && sid !== null) {
      ctx.add('T7', 'unresolved', `recording-set dialog[${k}] session_id is not a single SessionId Object; Session.session_id not set.`, 'AMB-4', { dialog: k, session_id: sid });
    }
    if (children.length > 0) {
      sess.sessions = children.map((c) => ({ session: c, type: 'child' }));
      ctx.add('T7', 'inferred', `recording-set dialog[${k}] lists other recording-set(s); Session ${sidx} references their Session(s) ${JSON.stringify(children)} as 'child'.`, 'AMB-1', { dialog: k, session: sidx, children });
    }
    if (recs.length > 0) sess.dialog = recs;
    ctx.sessions[sidx] = orderSession(sess);
    for (const r of recs) pushMap(ctx.dialogSessions, r, sidx);
    const moved = ['start', 'duration', 'parties', 'session_id', 'originator'].filter((f) => has(rs, f));
    ctx.add('T7', 'inferred', `recording-set dialog[${k}] -> Session ${sidx}; its ${JSON.stringify(moved)} moved to the Session (A.1 silent about them); Session start/duration/parties fall back to values derived from the recordings when absent.`, 'AMB-4', { dialog: k, session: sidx });
    const knownRs = ['type', 'recordings', 'start', 'duration', 'parties', 'session_id', 'originator', 'party_history'];
    const extra = Object.keys(rs).filter((key) => !knownRs.includes(key)).sort();
    if (extra.length > 0) {
      ctx.add('T7', 'unresolved', `recording-set dialog[${k}] had parameter(s) ${JSON.stringify(extra)} with no Session equivalent; not migrated. Original kept in report.removed_dialogs.`, undefined, { dialog: k, dropped: Object.fromEntries(extra.map((f) => [f, rs[f]])) });
    }
    if (ctx.catchAll !== null && recs.length > 0) {
      ctx.add('T7', 'unresolved', `Session ${sidx} (recording-set dialog[${k}]) overlaps Session ${ctx.catchAll}, which also lists its recordings; A.1 does not say whether to relate them, so no Session_Reference was added.`, 'AMB-1', { session: sidx, catch_all: ctx.catchAll });
    }
  }
  // recording_set has been consumed above; recordings is only legal on recording-sets.
  if (Array.isArray(dialogs)) {
    for (const i of ctx.kept()) {
      delete dialogs[i].recording_set;
      if (has(dialogs[i], 'recordings')) {
        const rec = dialogs[i].recordings;
        delete dialogs[i].recordings;
        ctx.add('T7', 'unresolved', `dialog[${i}] (${JSON.stringify(ctx.dialogs[i].type)}) had a recordings parameter, which only a recording-set may carry; removed.`, undefined, { dialog: i, recordings: rec });
      }
    }
  }
}

const firstSlotIsNull = (parties: unknown): boolean => Array.isArray(parties) && parties.length > 0 && parties[0] === null;

/**
 * The first party slot of a text/incomplete Dialog is null: its sender is
 * unknown. The next party is a receiver, so promoting it would invent a
 * sender. An empty Party Object stands in and becomes the Session originator.
 */
function unknownFirstParty(ctx: Context, step: string, i: number, kind: string, role: string): number {
  const e = ctx.emptyParty(step);
  ctx.originators.set(i, e);
  ctx.add(step, 'unresolved', `${kind} dialog[${i}] has null as its first party, so its ${role} is unknown; an empty Party Object (parties[${e}]) stands in rather than promoting a receiver.`, undefined, { dialog: i, party: e });
  return e;
}

function t8TextParties(ctx: Context): void {
  const dialogs = ctx.out.dialog;
  if (!Array.isArray(dialogs)) return;
  for (const i of ctx.kept()) {
    if (ctx.dialogs[i].type !== 'text') continue;
    const p = plainParties(ctx.dialogs[i].parties);
    if (p.length === 0) {
      ctx.add('T8', 'unresolved', `text dialog[${i}] has no parties; sender and receivers unknown.`, undefined, { dialog: i });
      continue;
    }
    const orig = ctx.dialogs[i].originator;
    let sender: number;
    if (isInt(orig)) sender = orig;
    else if (firstSlotIsNull(ctx.dialogs[i].parties)) sender = unknownFirstParty(ctx, 'T8', i, 'text', 'sender');
    else sender = p[0];
    dialogs[i].parties = [sender];
    ctx.receivers.set(i, p.includes(sender) ? p : [sender, ...p]);
  }
}

function t9IncompleteParties(ctx: Context): void {
  const dialogs = ctx.out.dialog;
  if (!Array.isArray(dialogs)) return;
  for (const i of ctx.kept()) {
    if (ctx.dialogs[i].type !== 'incomplete') continue;
    const p = plainParties(ctx.dialogs[i].parties);
    if (p.length === 0) continue;
    const orig = ctx.dialogs[i].originator;
    let who: number;
    if (isInt(orig)) who = orig;
    else if (firstSlotIsNull(ctx.dialogs[i].parties)) who = unknownFirstParty(ctx, 'T9', i, 'incomplete', 'originator');
    else who = p[0];
    dialogs[i].parties = [who];
    ctx.receivers.set(i, p.includes(who) ? p : [who, ...p]);
  }
}

function t9bRecordingParties(ctx: Context): void {
  const idxs: number[] = [];
  for (const i of ctx.kept()) {
    if (ctx.dialogs[i].type === 'text' || ctx.dialogs[i].type === 'incomplete') continue;
    const p = plainParties(ctx.dialogs[i].parties);
    if (p.length > 0) {
      ctx.receivers.set(i, p);
      idxs.push(i);
    }
  }
  if (idxs.length > 0) {
    ctx.add('T9b', 'inferred', `Dialog(s) ${JSON.stringify(idxs)} (recording or other type): parties left as the contributors; the Session parties are the union of the contributors across its Dialogs (A.1 gives no rule).`, 'AMB-6', { dialogs: idxs });
  }
  const texts = ctx.kept().filter((i) => ctx.dialogs[i].type === 'text');
  if (texts.length > 0) {
    const sets = new Set(texts.map((i) => JSON.stringify([...(ctx.receivers.get(i) ?? [])].sort((a, b) => a - b))));
    if (sets.size > 1) {
      ctx.add('T8', 'unresolved', `text Dialogs ${JSON.stringify(texts)} have different receiver sets; they were put in one Session whose parties are the union. 4.5.4 prescribes a parent Session with a child Session per receiver set; that split was not made.`, 'AMB-5', { dialogs: texts });
    }
    if ([...sets].some((s) => (JSON.parse(s) as number[]).length > 2)) {
      ctx.add('T8', 'unresolved', '0.4.0 parties do not distinguish To, Cc and Bcc, so Bcc recipients cannot be identified or excluded.', 'AMB-5', { dialogs: texts });
    }
  }
}

function t10BlankRemoved(ctx: Context): void {
  const dialogs = ctx.out.dialog;
  if (!Array.isArray(dialogs)) return;
  for (const [k, kind] of ctx.removed) {
    ctx.report.removed_dialogs[String(k)] = clone(ctx.dialogs[k]);
    dialogs[k] = {};
    ctx.add('T10', 'info', `dialog[${k}] (${kind}) replaced by an empty Dialog Object; index ${k} unchanged.`, undefined, { dialog: k });
  }
  if (dialogs.length !== ctx.dialogs.length) throw new MigrationError('T10: dialog array length changed; indices would break');
}

function mergeIndex(existing: unknown, add: number[]): number | number[] {
  const cur = existing === undefined || existing === null ? [] : Array.isArray(existing) ? existing : [existing];
  const merged = [...cur];
  for (const n of add) if (!merged.includes(n)) merged.push(n);
  return merged.length === 1 ? merged[0] : merged;
}

/** AMB-2: re-point analysis and attachment references to removed Dialogs. */
function t10bRetarget(ctx: Context): void {
  const removed = ctx.removed;
  if (removed.size === 0) return;
  const targets = (e: number): { reps: number[]; sidx: number | null } => {
    if (removed.get(e) === 'recording-set') {
      const sidx = ctx.rsSession.get(e) ?? null;
      const recs = sidx !== null ? ctx.sessions[sidx].dialog ?? [] : [];
      return { reps: [...recs], sidx };
    }
    return { reps: [], sidx: ctx.transferSession.get(e) ?? null };
  };

  (Array.isArray(ctx.out.analysis) ? ctx.out.analysis : []).forEach((an: any, n: number) => {
    if (!an || typeof an !== 'object' || !has(an, 'dialog')) return;
    const old = an.dialog;
    const items: any[] = Array.isArray(old) ? old : [old];
    if (!items.some((x) => isInt(x) && removed.has(x))) return;
    const newDialogs: number[] = [];
    const sessAdd: number[] = [];
    for (const x of items) {
      if (isInt(x) && removed.has(x)) {
        const { reps, sidx } = targets(x);
        for (const r of reps) if (!newDialogs.includes(r)) newDialogs.push(r);
        if (sidx !== null) sessAdd.push(sidx);
      } else if (!newDialogs.includes(x)) {
        newDialogs.push(x);
      }
    }
    if (newDialogs.length > 0) an.dialog = newDialogs.length === 1 && !Array.isArray(old) ? newDialogs[0] : newDialogs;
    else delete an.dialog;
    if (sessAdd.length > 0) an.sessions = mergeIndex(an.sessions, sessAdd);
    ctx.add('T10b', 'inferred', `analysis[${n}].dialog ${JSON.stringify(old)} pointed at a removed Dialog; now dialog=${JSON.stringify(an.dialog)}, sessions=${JSON.stringify(an.sessions)}.`, 'AMB-2', { analysis: n });
  });
  (Array.isArray(ctx.out.attachments) ? ctx.out.attachments : []).forEach((att: any, n: number) => {
    if (!att || typeof att !== 'object' || !(isInt(att.dialog) && removed.has(att.dialog))) return;
    const e = att.dialog as number;
    const { sidx } = targets(e);
    delete att.dialog;
    if (sidx !== null) {
      att.session = mergeIndex(att.session, [sidx]);
      ctx.add('T10b', 'inferred', `attachments[${n}].dialog=${e} pointed at a removed Dialog; replaced by session=${JSON.stringify(att.session)}.`, 'AMB-2', { attachment: n });
    } else {
      ctx.add('T10b', 'unresolved', `attachments[${n}].dialog=${e} pointed at a removed Dialog with no Session to re-point to; the attachment now has neither dialog nor session.`, 'AMB-2', { attachment: n });
    }
  });
}

/** Scope an attachment that has neither dialog nor session (only when exactly one Session exists). */
function t10cUnscopedAttachments(ctx: Context): void {
  (Array.isArray(ctx.out.attachments) ? ctx.out.attachments : []).forEach((att: any, n: number) => {
    if (!att || typeof att !== 'object' || has(att, 'dialog') || has(att, 'session')) return;
    if (ctx.sessions.length === 1) {
      att.session = 0;
      ctx.add('T10c', 'inferred', `attachments[${n}] had neither dialog nor session; scoped to the only Session (session=0).`, undefined, { attachment: n, purpose: att.purpose });
    } else {
      ctx.add('T10c', 'unresolved', `attachments[${n}] has neither dialog nor session and the vCon has ${ctx.sessions.length} Sessions, so its scope cannot be chosen; set dialog or session by hand.`, undefined, { attachment: n, purpose: att.purpose });
    }
  });
}

function t13UnwrapSigned(ctx: Context): void {
  const out = ctx.out;
  if (has(out, 'ciphertext') && (has(out, 'recipients') || has(out, 'protected'))) {
    throw new MigrationError('T13: the input is an encrypted (JWE) vCon; decrypt it before migrating');
  }
  if (has(out, 'payload') && has(out, 'signatures')) {
    let payload: unknown;
    try {
      payload = JSON.parse(b64urlDecode(String(out.payload)));
    } catch (e) {
      throw new MigrationError(`T13: could not decode the signed vCon payload: ${(e as Error).message}`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new MigrationError('T13: the signed vCon payload is not a JSON object');
    }
    const algs: unknown[] = [];
    for (const sig of Array.isArray(out.signatures) ? out.signatures : []) {
      try {
        if (sig?.protected) algs.push(JSON.parse(b64urlDecode(String(sig.protected))).alg);
        if (sig?.header && typeof sig.header === 'object' && 'alg' in sig.header) algs.push(sig.header.alg);
      } catch {
        continue;
      }
    }
    ctx.out = payload as Obj;
    ctx.report.resign_required = true;
    ctx.add('T13', 'unresolved', 'The input was signed. It was migrated as the unsigned payload; the signature was dropped. Re-signing is required, and signing changes updated_at (4.1.6).');
    if (algs.some((a) => typeof a === 'string' && a.toLowerCase() === 'none')) {
      ctx.add('T13', 'unresolved', "A signature used alg 'none', which 0.5.0 forbids; sign again with a permitted algorithm.");
    }
  }
  ctx.src = clone(ctx.out);
  ctx.report.source_version = ctx.out.vcon ?? null;
}

function t14Extensions(ctx: Context): void {
  const { names, unnamed } = extensionsInUse(ctx.out);
  const listed: string[] = Array.isArray(ctx.out.extensions) ? [...ctx.out.extensions] : [];
  const added: string[] = [];
  for (const name of [...names].sort()) {
    if (!listed.includes(name)) {
      listed.push(name);
      added.push(name);
    }
  }
  for (const name of Array.isArray(ctx.out.critical) ? ctx.out.critical : []) {
    if (typeof name === 'string' && !listed.includes(name)) {
      listed.push(name);
      added.push(name);
    }
  }
  if (added.length > 0) {
    ctx.out.extensions = listed;
    ctx.add('T14', 'inferred', `Added extension name(s) ${JSON.stringify(added)} to extensions.`, undefined, { added });
  }
  if (unnamed.length > 0 && listed.length === 0) {
    ctx.add('T14', 'unresolved', `Values outside the core vocabulary are in use but their defining extension cannot be identified: ${unnamed.join('; ')}. extensions was not changed.`, undefined, { uses: unnamed });
  }
}

function t15DuplicateHeaders(ctx: Context): void {
  if (ctx.report.resign_required) {
    ctx.add('T15', 'info', 'Header parameters repeated across JWS headers are not checked or rejected on read; writers must not emit duplicates in 0.5.0.');
  }
}

function renameTop(ctx: Context, oldName: string, newName: string, step: string): void {
  if (has(ctx.out, oldName)) {
    ctx.out = renameKey(ctx.out, oldName, newName);
    ctx.add(step, 'info', `Renamed '${oldName}' to '${newName}'.`);
  }
}

export interface MigrationStep {
  id: string;
  title: string;
  /** where the draft says it */
  source: string;
  func: (ctx: Context) => void;
}

/** One entry per step of the ordered transform table (Appendix A.1), in execution order. */
export const MIGRATION_STEPS: MigrationStep[] = [
  { id: 'T13', title: 'Signed input: migrate the payload, require re-signing', source: 'A.1 bullet 11; 6.2.2', func: t13UnwrapSigned },
  { id: 'T15', title: 'Duplicate header parameters tolerated on read', source: 'A.1 bullet 13', func: t15DuplicateHeaders },
  { id: 'T1', title: 'vcon 0.4.0 -> 0.5.0', source: 'A.1 bullet 1', func: t1Version },
  { id: 'T8', title: 'text Dialog parties -> sender; all parties to Session', source: 'A.1 bullet 6', func: t8TextParties },
  { id: 'T9', title: 'incomplete Dialog parties -> originator/first', source: 'A.1 bullet 6', func: t9IncompleteParties },
  { id: 'T9b', title: 'other Dialog parties kept; union to Session', source: '4.5.4 (A.1 silent)', func: t9bRecordingParties },
  { id: 'T6', title: 'Dialog originator -> Session originator', source: 'A.1 bullet 5', func: t6Originator },
  { id: 'T2', title: 'Add a Session referencing all Dialogs', source: 'A.1 bullet 2', func: t2Sessions },
  { id: 'T7', title: 'recording-set Dialog -> Session', source: 'A.1 bullet 9', func: t7RecordingSets },
  { id: 'T4', title: 'transfer Dialog -> transfer Events (with T5 Session references)', source: 'A.1 bullet 4', func: t4Transfers },
  { id: 'T3', title: 'party_history -> Events', source: 'A.1 bullet 3', func: t3PartyHistory },
  { id: 'T10', title: 'Removed Dialogs -> {} in place', source: 'A.1 bullet 10; 4.5.1', func: t10BlankRemoved },
  { id: 'T10b', title: 'Re-point analysis/attachment references to removed Dialogs', source: 'AMB-2', func: t10bRetarget },
  { id: 'T10c', title: 'Scope unscoped attachments to the only Session', source: '4.6.4 (A.1 silent)', func: t10cUnscopedAttachments },
  { id: 'T11', title: 'redacted -> redacted_from', source: 'A.1 bullet 7', func: (c) => renameTop(c, 'redacted', 'redacted_from', 'T11') },
  { id: 'T12', title: 'amended -> amended_from', source: 'A.1 bullet 8', func: (c) => renameTop(c, 'amended', 'amended_from', 'T12') },
  { id: 'T14', title: 'extensions lists every extension in use', source: 'A.1 bullet 12; 4.1.3', func: t14Extensions },
];

/** True when a payload still has the 0.4.0 shape and needs migrating. */
export function needsMigration(vcon: unknown): boolean {
  if (!vcon || typeof vcon !== 'object' || Array.isArray(vcon)) return false;
  const v = vcon as Obj;
  if (has(v, 'payload') && has(v, 'signatures')) return false; // signed: never migrate on load
  if (v.vcon === SOURCE_VERSION) return true;
  return false;
}

/**
 * True when a payload with no `vcon` parameter still has the 0.4.0 shape: it
 * carries dialog (or a legacy parameter) but none of the 0.5.0-only parameters.
 */
export function looksLegacy(vcon: Obj): boolean {
  if (V050_ONLY_KEYS.some((k) => has(vcon, k))) return false;
  if (has(vcon, 'redacted') || has(vcon, 'amended')) return true;
  return Array.isArray(vcon.dialog) && vcon.dialog.length > 0;
}

/**
 * Migrate a 0.4.0 vCon object (or JSON string) to 0.5.0. The input is not
 * modified. Throws MigrationError for input that cannot be migrated and, in
 * strict mode, when a required field has no source.
 */
export function migrate040To050(input: unknown, opts: { strict?: boolean } = {}): MigrationResult {
  let vcon: unknown = input;
  if (typeof vcon === 'string') {
    try {
      vcon = JSON.parse(vcon);
    } catch (e) {
      throw new MigrationError(`input is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (!vcon || typeof vcon !== 'object' || Array.isArray(vcon)) {
    throw new MigrationError('input must be a vCon object or JSON string');
  }
  const strict = opts.strict ?? false;
  const data = clone(vcon) as Obj;
  const report: MigrationReport = {
    source_version: null,
    target_version: TARGET_VERSION,
    strict,
    resign_required: false,
    entries: [],
    removed_dialogs: {},
    steps_run: [],
  };
  const ctx = new Context(data, strict, report);

  const version = data.vcon;
  const signed = has(data, 'payload') && has(data, 'signatures');
  if (version !== undefined && version !== null && version !== SOURCE_VERSION && !signed) {
    throw new MigrationError(`cannot migrate: input vcon is ${JSON.stringify(version)}, expected ${JSON.stringify(SOURCE_VERSION)}`);
  }
  for (const step of MIGRATION_STEPS) {
    report.steps_run.push(step.id);
    step.func(ctx);
    if (step.id === 'T13') {
      const v = ctx.out.vcon;
      if (v !== undefined && v !== null && v !== SOURCE_VERSION) {
        throw new MigrationError(`cannot migrate: input vcon is ${JSON.stringify(v)}, expected ${JSON.stringify(SOURCE_VERSION)}`);
      }
      if (v === undefined || v === null) {
        const markers = V050_ONLY_KEYS.filter((k) => has(ctx.out, k)).sort();
        if (markers.length > 0) {
          throw new MigrationError(`cannot migrate: input has no 'vcon' parameter but has 0.5.0-only parameter(s) ${JSON.stringify(markers)}; it is already 0.5.0 (vcon is optional there)`);
        }
        ctx.add('T13', 'info', "Input has no 'vcon' parameter; treated as 0.4.0.");
      }
    }
  }

  const out = ctx.out;
  if (ctx.sessions.length > 0) out.sessions = ctx.sessions;
  if (ctx.events.length > 0) out.events = ctx.events;

  // Lawful basis attachments keep their 0.4.0 scope (dialog). 0.5.0 scopes them with
  // session plus party; adding a Session reference would be inventing a scope.
  (Array.isArray(out.attachments) ? out.attachments : []).forEach((att: any, n: number) => {
    if (att && typeof att === 'object' && att.purpose === 'lawful_basis' && !has(att, 'session')) {
      ctx.add('post', 'info', `attachments[${n}] is a lawful_basis attachment scoped by dialog only; it was left as is. 0.5.0 scopes a lawful basis to Sessions with 'session' (plus 'party'); add it if it covers the Session.`, undefined, { attachment: n });
    }
  });

  // Post-check: the result must satisfy the core-05 rules; anything left is reported.
  for (const err of validateVConDocument(out).errors) ctx.add('post', 'unresolved', `Result does not validate: ${err}`);
  return { vcon: out, report };
}

// ---------------------------------------------------------------------------
// Migrate on read
// ---------------------------------------------------------------------------

const reports = new WeakMap<object, MigrationReport>();

/** Carry a migration report over to a copy of the vCon (e.g. one an afterRead hook returned). */
export function carryMigrationReport(from: object, to: object): void {
  const report = reports.get(from);
  if (report && from !== to) reports.set(to, report);
}

/** The report of a vCon returned by migrateOnRead, if it was migrated. */
export function getMigrationReport(vcon: unknown): MigrationReport | undefined {
  return vcon && typeof vcon === 'object' ? reports.get(vcon) : undefined;
}

/**
 * Read-path entry point: a vCon that is not 0.5.0 (declared "0.4.0", an older
 * version string, or undeclared with dialog and no 0.5.0 parameters) is migrated with the
 * reference semantics (non-strict, so fallbacks are reported rather than
 * thrown) and the report is attached out of band (getMigrationReport). Anything
 * else is returned unchanged, including signed input. If the migration throws
 * the stored vCon is returned as it was, never dropped.
 */
export function migrateOnRead<T extends object>(vcon: T, onError?: (err: unknown) => void): T {
  const v = vcon as Obj;
  if (!v || typeof v !== 'object' || (has(v, 'payload') && has(v, 'signatures'))) return vcon;
  if (v.vcon === TARGET_VERSION) return vcon;
  const noMarkers = !V050_ONLY_KEYS.some((k) => has(v, k));
  // 0.4.0 declared, or an older/undeclared version string on a 0.4.0 shape (the stored corpus mixes
  // 0.3.0 and 0.4.0 vCons). A vCon with no version and nothing to migrate is left alone.
  const legacy = v.vcon === SOURCE_VERSION || (noMarkers && (typeof v.vcon === 'string' || looksLegacy(v)));
  if (!legacy) return vcon;
  try {
    const declared = v.vcon;
    const input = declared === SOURCE_VERSION || declared === undefined ? v : { ...v, vcon: SOURCE_VERSION };
    const { vcon: migrated, report } = migrate040To050(input);
    if (declared !== undefined && declared !== SOURCE_VERSION) {
      report.source_version = declared;
      report.entries.unshift({
        step: 'T1', kind: 'info',
        message: `Stored version ${JSON.stringify(declared)} read as the 0.4.0 shape.`,
      });
    }
    reports.set(migrated, report);
    return migrated as T;
  } catch (err) {
    onError?.(err);
    return vcon;
  }
}
