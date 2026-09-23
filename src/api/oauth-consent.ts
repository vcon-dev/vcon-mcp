/**
 * OAuth consent page for Supabase OAuth Server.
 *
 * Supabase sends the user to `<Site URL><Authorization Path>?authorization_id=...`.
 * This page signs the user in, shows which client is asking and where it will
 * redirect, and posts approve or deny back to Supabase, which returns the client's
 * redirect URL.
 *
 * Sign-in methods come from OAUTH_CONSENT_PROVIDERS: "email" (emailed one-time code,
 * existing users only) and/or GoTrue external providers such as "google" (PKCE
 * redirect, so no token ever appears in the URL).
 *
 * Plain fetch against the GoTrue REST API, so no browser bundle is shipped. The
 * user's access token lives only in page memory; only the PKCE verifier touches
 * sessionStorage, for the length of the provider round trip.
 */

import type { ServerResponse } from 'http';
import type { OAuthConfig } from './oauth.js';

export const CONSENT_PATH = '/oauth/consent';

export function serveConsentPage(res: ServerResponse, config: OAuthConfig, anonKey: string): void {
  // JSON in a script block: escape "<" so a value can never close the tag.
  const boot = JSON.stringify({
    authUrl: config.issuer,
    anonKey,
    resource: config.resource,
    providers: config.consentProviders,
    readonly: config.readonly,
  }).replace(/</g, '\\u003c');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    // Consent must not be framed (clickjacking); only the issuer may be called.
    'Content-Security-Policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src ${new URL(config.issuer).origin}; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`,
  });
  res.end(PAGE.replace('__BOOT__', boot));
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign in · vCon MCP</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--ink:#16181d;--muted:#5d6470;--line:#e3e6eb;--accent:#2f5bea;--accent-ink:#fff;--ok:#1f8a4c;--err:#c0362c;--chip:#f0f2f5}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--ink:#eceef2;--muted:#9aa2ae;--line:#2a2f38;--accent:#6d8cff;--accent-ink:#0b0d12;--ok:#4cc38a;--err:#ff7b72;--chip:#222730}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;grid-template-columns:minmax(0,420px);place-content:center;padding:24px 16px;background:radial-gradient(1200px 600px at 50% -10%,color-mix(in srgb,var(--accent) 14%,transparent),transparent 70%),var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.08)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.mark{width:34px;height:34px;border-radius:9px;background:var(--accent);display:grid;place-items:center;flex:none}
.brand b{display:block;font-size:15px}.brand span{display:block;font-size:13px;color:var(--muted)}
h1{font-size:21px;line-height:1.3;margin:0 0 6px;letter-spacing:-.01em}
p{margin:0 0 16px}.lede{color:var(--muted)}
button{font:inherit;font-weight:600;cursor:pointer;border-radius:10px;padding:11px 16px;border:1px solid transparent;transition:filter .15s,background .15s}
button:disabled{opacity:.6;cursor:progress}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.primary{background:var(--accent);color:var(--accent-ink)}.primary:hover{filter:brightness(1.08)}
.secondary{background:transparent;color:var(--ink);border-color:var(--line)}.secondary:hover{background:var(--chip)}
.provider{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f1f1f;border:1px solid #747775;font-weight:500;margin-bottom:10px}
.provider:hover{background:#f7f8f8}
input{font:inherit;width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit;margin:6px 0 12px}
label{font-size:13px;color:var(--muted)}
.or{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;margin:14px 0}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
.who{display:inline-flex;align-items:center;gap:8px;background:var(--chip);border-radius:999px;padding:4px 12px 4px 4px;font-size:13px;margin:4px 0 18px;max-width:100%}
.who i{width:22px;height:22px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-style:normal;font-weight:700;font-size:11px;flex:none}
.who span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ul{list-style:none;padding:0;margin:0 0 18px;border:1px solid var(--line);border-radius:12px}
li{display:flex;gap:10px;padding:12px 14px;font-size:14px}li+li{border-top:1px solid var(--line)}
li svg{flex:none;margin-top:2px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.fine{font-size:12.5px;color:var(--muted);margin:14px 0 0}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
#msg{font-size:13.5px;margin:14px 0 0;min-height:1em}#msg.err{color:var(--err)}
#msg:empty{display:none}
</style></head><body>
<main class="card">
  <div class="brand">
    <div class="mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="color:var(--accent-ink)"><path d="M4 12h2M8 8v8M12 5v14M16 9v6M20 11v2"/></svg></div>
    <div><b>vCon MCP</b><span id="host"></span></div>
  </div>
  <section id="signin" hidden>
    <h1>Sign in to continue</h1>
    <p class="lede">An app is asking to connect to the conversation data on this server. Sign in to review the request.</p>
    <div id="external"></div>
    <div id="emailbox" hidden>
      <div class="or" id="orline" hidden>or</div>
      <label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
      <button id="send" class="primary" style="width:100%">Email me a code</button>
      <div id="codebox" hidden>
        <label for="code" style="display:block;margin-top:14px">Code</label><input id="code" inputmode="numeric" autocomplete="one-time-code">
        <button id="verify" class="primary" style="width:100%">Sign in</button>
      </div>
    </div>
  </section>
  <section id="consent" hidden>
    <h1><span id="client"></span> wants access</h1>
    <div class="who"><i id="initial"></i><span id="account"></span></div>
    <ul>
      <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>Search and read conversations (vCons) on <b id="resource"></b></span></li>
      <li id="scope"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span></span></li>
    </ul>
    <div class="row"><button id="deny" class="secondary">Deny</button><button id="approve" class="primary">Allow</button></div>
    <p class="fine">After you choose, you'll return to <code id="redirect"></code>.</p>
  </section>
  <p id="msg" role="status" aria-live="polite"></p>
</main>
<script>
const B = __BOOT__;
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const id = q.get('authorization_id');
let jwt = null;
let email = '';
const G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
$('host').textContent = new URL(B.resource).host;
function say(text, err) { $('msg').textContent = text; $('msg').className = err ? 'err' : ''; }
function busy(on) { document.querySelectorAll('button').forEach((b) => { b.disabled = on; }); }
async function api(method, path, body) {
  const headers = { apikey: B.anonKey, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = 'Bearer ' + jwt;
  const r = await fetch(B.authUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.msg || data.message || data.error_description || ('HTTP ' + r.status));
  return data;
}
function go(url) { location.assign(url); }
function signedIn(s) { jwt = s.access_token; email = (s.user && s.user.email) || ''; }
async function loadConsent() {
  const d = await api('GET', '/oauth/authorizations/' + encodeURIComponent(id));
  if (d.redirect_url) return go(d.redirect_url); // already consented
  $('signin').hidden = true;
  $('client').textContent = (d.client && (d.client.client_name || d.client.client_id)) || 'An application';
  $('resource').textContent = new URL(B.resource).host;
  $('account').textContent = email ? 'Signed in as ' + email : 'Signed in';
  $('initial').textContent = (email || '?').charAt(0).toUpperCase();
  $('scope').querySelector('span').textContent = B.readonly
    ? 'Read-only. It cannot create, change or delete anything.'
    : 'Read and write. It can create, change and delete conversations.';
  let target = d.redirect_uri || '';
  try { target = new URL(target).host; } catch (e) {}
  $('redirect').textContent = target || 'the application';
  $('consent').hidden = false;
  say('');
}
async function decide(action) {
  busy(true); say(action === 'approve' ? 'Connecting...' : 'Cancelling...');
  try {
    const d = await api('POST', '/oauth/authorizations/' + encodeURIComponent(id) + '/consent', { action });
    if (d.redirect_url) go(d.redirect_url); else say('Done. You can close this window.');
  } catch (e) { busy(false); say(e.message, true); }
}
const b64u = (a) => btoa(String.fromCharCode(...a)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
async function startProvider(provider) {
  // PKCE: GoTrue returns ?code= to this page; the verifier never leaves the browser.
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem('pkce_verifier', verifier);
  const back = location.origin + location.pathname + '?authorization_id=' + encodeURIComponent(id);
  go(B.authUrl + '/authorize?' + new URLSearchParams({ provider, redirect_to: back, code_challenge: challenge, code_challenge_method: 's256' }));
}
async function finishProvider(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');
  history.replaceState(null, '', location.pathname + '?authorization_id=' + encodeURIComponent(id));
  if (!verifier) throw new Error('Sign-in expired. Start again from your MCP client.');
  signedIn(await api('POST', '/token?grant_type=pkce', { auth_code: code, code_verifier: verifier }));
  await loadConsent();
}
for (const p of B.providers) {
  if (p === 'email') { $('emailbox').hidden = false; continue; }
  const btn = document.createElement('button');
  btn.className = 'provider';
  if (p === 'google') btn.innerHTML = G;
  btn.appendChild(document.createTextNode('Sign in with ' + p.charAt(0).toUpperCase() + p.slice(1)));
  btn.onclick = () => { busy(true); startProvider(p).catch((e) => { busy(false); say(e.message, true); }); };
  $('external').appendChild(btn);
}
$('orline').hidden = !(B.providers.includes('email') && B.providers.length > 1);
$('send').onclick = async () => {
  busy(true);
  try {
    await api('POST', '/otp', { email: $('email').value.trim(), create_user: false });
    $('codebox').hidden = false; say('Check your email for a code.');
  } catch (e) { say(e.message, true); }
  busy(false);
};
$('verify').onclick = async () => {
  busy(true);
  try {
    signedIn(await api('POST', '/verify', { type: 'email', email: $('email').value.trim(), token: $('code').value.trim() }));
    await loadConsent();
  } catch (e) { say(e.message, true); }
  busy(false);
};
$('approve').onclick = () => decide('approve');
$('deny').onclick = () => decide('deny');
const failed = q.get('error_description') || new URLSearchParams(location.hash.slice(1)).get('error_description');
if (!id) say('Missing authorization_id. Start from your MCP client.', true);
else if (q.get('code')) { say('Signing in...'); finishProvider(q.get('code')).catch((e) => { $('signin').hidden = false; say(e.message, true); }); }
else { $('signin').hidden = false; if (failed) say(failed, true); }
</script></body></html>`;
