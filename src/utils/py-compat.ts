/**
 * Python-compatible helpers for the reference validation (vcon-lib 1.0.5):
 * date-time parsing with the rules and error texts of the reference (dateutil
 * for created_at, datetime.fromisoformat for lawful basis timestamps), and
 * Python repr() / str() of JSON values for messages.
 *
 * Ported from vcon-js (src/util.ts, MIT), whose validator matches the
 * reference byte for byte.
 */

/** True for a non-negative integer (a valid array index). */
export function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Wrap a scalar in a list; undefined and null become an empty list. */
export function asList<T = any>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Parse an ISO 8601 / RFC 3339 date-time string to integer epoch microseconds,
 * or undefined if it is not one. A date-time with no offset is read as UTC, as
 * the Python reference does, so results do not depend on the machine's time
 * zone. Out-of-range fields (month 13, February 30, hour 24, second 60, an
 * offset of 24 hours or more) are rejected rather than rolled over. Fractional
 * seconds keep microsecond precision (digits past the sixth are dropped), so
 * timestamps written by microsecond-precision writers compare and subtract
 * exactly.
 */
export function parseDateTimeMicros(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = DATE_RE.exec(value.trim());
  if (!m) return undefined;
  const [, ys, mos, ds, hs = '00', mis = '00', ss = '00', frac = '', tz = 'Z'] = m;
  const [y, mo, d, h, mi, s] = [ys, mos, ds, hs, mis, ss].map(Number);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return undefined;
  const dim = mo === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[mo - 1];
  if (d > dim || h > 23 || mi > 59 || s > 59) return undefined;
  let offsetMinutes = 0;
  const t = tz.toUpperCase();
  if (t !== 'Z') {
    const digits = t.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2) || '0');
    if (oh > 23 || om > 59) return undefined;
    offsetMinutes = (t[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const date = new Date(Date.UTC(2000, mo - 1, d, h, mi, s));
  date.setUTCFullYear(y);
  const micros = frac ? Number(frac.slice(1, 7).padEnd(6, '0')) : 0;
  return date.getTime() * 1000 + micros - offsetMinutes * 60_000_000;
}

/**
 * Why the Python reference (dateutil's parser) rejects a date-time value, as
 * the text of its exception, for messages that quote it. Only meaningful for a
 * value parseDateTime() rejects.
 */
export function dateTimeProblem(value: unknown): string {
  if (typeof value !== 'string') {
    return `Parser must be a string or character stream, not ${pyTypeName(value)}`;
  }
  if (value.trim() === '') return `String does not contain a date: ${value}`;
  const m = DATE_RE.exec(value.trim());
  if (m) {
    const [, ys, mos, ds, hs = '00', mis = '00', ss = '00', , tz = 'Z'] = m;
    const [y, mo, d, h, mi, s] = [ys, mos, ds, hs, mis, ss].map(Number);
    if (y < 1) return `year ${y} is out of range: ${value}`;
    if (mo < 1 || mo > 12) return `month must be in 1..12: ${value}`;
    const dim = mo === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[mo - 1];
    if (d < 1 || d > dim) return `day is out of range for month: ${value}`;
    if (h > 23) return `hour must be in 0..23: ${value}`;
    if (mi > 59) return `minute must be in 0..59: ${value}`;
    if (s > 59) return `second must be in 0..59: ${value}`;
    if (tz.toUpperCase() !== 'Z') {
      return 'offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24).';
    }
  }
  return `Unknown string format: ${value}`;
}

const ISO_TIME_PART = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2}))?)?(?:[.,](\d+))?$/;

function parseIsoTimePart(s: string): { h: number; mi: number; sec: number; micros: number } | undefined {
  const m = ISO_TIME_PART.exec(s);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[3] ?? '0');
  const sec = Number(m[4] ?? '0');
  const micros = m[5] ? Number(m[5].slice(0, 6).padEnd(6, '0')) : 0;
  return { h, mi, sec, micros };
}

function isoWeekToDate(year: number, week: number, day: number): Date | undefined {
  const jan1 = new Date(Date.UTC(2000, 0, 1));
  jan1.setUTCFullYear(year);
  const jan1Weekday = (jan1.getUTCDay() + 6) % 7; // Monday = 0
  if (week < 1 || week > 53 || day < 1 || day > 7) return undefined;
  if (week === 53 && !(jan1Weekday === 3 || (jan1Weekday === 2 && isLeapYear(year)))) return undefined;
  const jan4 = new Date(jan1.getTime() + 3 * 86_400_000);
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  return new Date(jan4.getTime() + ((week - 1) * 7 + (day - 1) - jan4Weekday) * 86_400_000);
}

/**
 * Parse a string the way Python's `datetime.fromisoformat` (3.11+) does, which
 * the reference library's lawful basis validator uses. Returns epoch
 * microseconds (a naive value read as UTC) and whether it carried an offset, or
 * undefined if Python would raise ValueError.
 */
export function parsePyIsoformat(value: string): { micros: number; aware: boolean } | undefined {
  if (!/^[\x21-\x7e]/.test(value) || value.length < 7) return undefined;
  let dateLen: number;
  if (value[4] === '-') {
    dateLen = value[5] === 'W' ? (value.length > 8 && value[8] === '-' ? 10 : 8) : 10;
  } else if (value[4] === 'W') {
    dateLen = value.length > 7 && /\d/.test(value[7]) ? 8 : 7;
  } else {
    dateLen = 8;
  }
  const dateStr = value.slice(0, dateLen);
  let date: Date | undefined;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-?W(\d{2})(?:-?(\d))?$/.exec(dateStr))) {
    const y = Number(m[1]);
    if (y < 1) return undefined;
    date = isoWeekToDate(y, Number(m[2]), Number(m[3] ?? '1'));
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr) || /^(\d{4})(\d{2})(\d{2})$/.exec(dateStr))) {
    const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
    if (y < 1 || mo < 1 || mo > 12 || d < 1) return undefined;
    if (d > (mo === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[mo - 1])) return undefined;
    date = new Date(Date.UTC(2000, mo - 1, d));
    date.setUTCFullYear(y);
  }
  if (!date) return undefined;
  const rest = value.slice(dateLen);
  if (rest === '') return { micros: date.getTime() * 1000, aware: false };
  const timeStr = rest.slice(1);
  const tzPos = timeStr.search(/[-+Z]/);
  const clock = parseIsoTimePart(tzPos < 0 ? timeStr : timeStr.slice(0, tzPos));
  if (!clock || clock.h > 23 || clock.mi > 59 || clock.sec > 59) return undefined;
  let micros = date.getTime() * 1000 + ((clock.h * 60 + clock.mi) * 60 + clock.sec) * 1_000_000 + clock.micros;
  if (tzPos < 0) return { micros, aware: false };
  const tz = timeStr.slice(tzPos);
  if (tz !== 'Z') {
    const off = parseIsoTimePart(tz.slice(1));
    if (!off || off.mi > 59 || off.sec > 59) return undefined;
    const offMicros = ((off.h * 60 + off.mi) * 60 + off.sec) * 1_000_000 + off.micros;
    if (offMicros >= 86_400_000_000) return undefined;
    micros -= (tz[0] === '-' ? -1 : 1) * offMicros;
  }
  return { micros, aware: true };
}

/**
 * Parse an ISO 8601 / RFC 3339 date-time string to epoch milliseconds, or
 * undefined if it is not one. See parseDateTimeMicros for the rules.
 */
export function parseDateTime(value: unknown): number | undefined {
  const us = parseDateTimeMicros(value);
  return us === undefined ? undefined : Math.floor(us / 1000);
}

/** The Python type name of a JSON value (int, float, str, bool, NoneType, list, dict). */
export function pyTypeName(value: unknown): string {
  if (value === null || value === undefined) return 'NoneType';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'str';
  if (Array.isArray(value)) return 'list';
  return 'dict';
}

function pyStringRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || (code >= 0x7f && code < 0xa0)) out += '\\x' + code.toString(16).padStart(2, '0');
    else out += ch;
  }
  return quote + out + quote;
}

/** Python `repr()` of a JSON value, e.g. `'a'`, `None`, `[1, 'b']`, `{'k': True}`. */
export function pyRepr(value: unknown): string {
  if (typeof value === 'string') return pyStringRepr(value);
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${pyStringRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
}

/** Python `str()` of a JSON value: strings as they are, anything else as pyRepr. */
export function pyStr(value: unknown): string {
  return typeof value === 'string' ? value : pyRepr(value);
}

const B64_VALUES: Record<string, number> = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => {
  B64_VALUES[c] = i;
});

/**
 * Decode base64 or base64url the way Python's `base64.urlsafe_b64decode` does
 * (non-strict binascii): characters outside the alphabet are skipped, decoding
 * stops at complete padding, and a dangling partial quantum is an error
 * (undefined). Non-ASCII input is an error too.
 */
export function lenientBase64UrlDecode(input: string): Uint8Array | undefined {
  if ([...input].some(c => c.charCodeAt(0) > 0x7f)) return undefined;
  const s = input.replace(/-/g, '+').replace(/_/g, '/');
  const out: number[] = [];
  let quadPos = 0;
  let left = 0;
  let pads = 0;
  for (const c of s) {
    if (c === '=') {
      if (quadPos >= 2 && quadPos + ++pads >= 4) return Uint8Array.from(out);
      continue;
    }
    const v = B64_VALUES[c];
    if (v === undefined) continue;
    pads = 0;
    switch (quadPos) {
      case 0:
        left = v;
        quadPos = 1;
        break;
      case 1:
        out.push(((left << 2) | (v >> 4)) & 0xff);
        left = v & 0x0f;
        quadPos = 2;
        break;
      case 2:
        out.push(((left << 4) | (v >> 2)) & 0xff);
        left = v & 0x03;
        quadPos = 3;
        break;
      default:
        out.push(((left << 6) | v) & 0xff);
        quadPos = 0;
    }
  }
  return quadPos === 0 ? Uint8Array.from(out) : undefined;
}

/**
 * The value of a JWS `payload` decoded as Python's
 * `json.loads(base64.urlsafe_b64decode(raw + padding))` would, or undefined if
 * that raises.
 */
export function decodeJsonPayload(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined;
  const bytes = lenientBase64UrlDecode(raw + '='.repeat((4 - (raw.length % 4)) % 4));
  if (!bytes) return undefined;
  let encoding = 'utf-8';
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(start));
    return JSON.parse(text.replace(/^\ufeff/, ''));
  } catch {
    return undefined;
  }
}
