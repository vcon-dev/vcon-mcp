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
<title>Authorize access</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a;background:#fafafa}
input,button{font:inherit;padding:.5rem .75rem;border-radius:6px;border:1px solid #bbb}
input{width:100%;box-sizing:border-box;margin:.25rem 0 .75rem}
button{cursor:pointer;background:#1a1a1a;color:#fff;border-color:#1a1a1a}
button.secondary{background:#fff;color:#1a1a1a}
.err{color:#b00020}.muted{color:#555;font-size:.9rem}code{word-break:break-all}
</style></head><body>
<h1>Authorize access</h1>
<div id="signin" hidden>
  <p>Sign in to continue.</p>
  <p id="external"></p>
  <div id="emailbox" hidden>
    <label>Email<input id="email" type="email" autocomplete="email" required></label>
    <button id="send">Email me a code</button>
    <div id="codebox" hidden>
      <label>Code<input id="code" inputmode="numeric" autocomplete="one-time-code"></label>
      <button id="verify">Sign in</button>
    </div>
  </div>
</div>
<div id="consent" hidden>
  <p><strong id="client"></strong> wants to use your vCon MCP access at <code id="resource"></code>.</p>
  <p class="muted">After you approve, you will be sent to <code id="redirect"></code>.</p>
  <button id="approve">Approve</button> <button id="deny" class="secondary">Deny</button>
</div>
<p id="msg" role="status"></p>
<script>
const B = __BOOT__;
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const id = q.get('authorization_id');
let jwt = null;
function say(text, err) { $('msg').textContent = text; $('msg').className = err ? 'err' : ''; }
async function api(method, path, body) {
  const headers = { apikey: B.anonKey, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = 'Bearer ' + jwt;
  const r = await fetch(B.authUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.msg || data.message || data.error_description || ('HTTP ' + r.status));
  return data;
}
function go(url) { location.assign(url); }
async function loadConsent() {
  const d = await api('GET', '/oauth/authorizations/' + encodeURIComponent(id));
  if (d.redirect_url) return go(d.redirect_url); // already consented
  $('signin').hidden = true;
  $('client').textContent = (d.client && (d.client.client_name || d.client.client_id)) || 'An application';
  $('resource').textContent = B.resource;
  let target = d.redirect_uri || '';
  try { target = new URL(target).origin; } catch (e) {}
  $('redirect').textContent = target || 'the application';
  $('consent').hidden = false;
  say('');
}
async function decide(action) {
  try {
    const d = await api('POST', '/oauth/authorizations/' + encodeURIComponent(id) + '/consent', { action });
    if (d.redirect_url) go(d.redirect_url); else say('Done. You can close this window.');
  } catch (e) { say(e.message, true); }
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
  const s = await api('POST', '/token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
  jwt = s.access_token;
  await loadConsent();
}
for (const p of B.providers) {
  if (p === 'email') { $('emailbox').hidden = false; continue; }
  const btn = document.createElement('button');
  btn.textContent = 'Sign in with ' + p.charAt(0).toUpperCase() + p.slice(1);
  btn.onclick = () => startProvider(p).catch((e) => say(e.message, true));
  $('external').appendChild(btn);
}
$('send').onclick = async () => {
  try {
    await api('POST', '/otp', { email: $('email').value.trim(), create_user: false });
    $('codebox').hidden = false; say('Check your email for a code.');
  } catch (e) { say(e.message, true); }
};
$('verify').onclick = async () => {
  try {
    const s = await api('POST', '/verify', { type: 'email', email: $('email').value.trim(), token: $('code').value.trim() });
    jwt = s.access_token;
    await loadConsent();
  } catch (e) { say(e.message, true); }
};
$('approve').onclick = () => decide('approve');
$('deny').onclick = () => decide('deny');
const failed = q.get('error_description') || new URLSearchParams(location.hash.slice(1)).get('error_description');
if (!id) say('Missing authorization_id. Start from your MCP client.', true);
else if (q.get('code')) { say('Signing in...'); finishProvider(q.get('code')).catch((e) => { $('signin').hidden = false; say(e.message, true); }); }
else { $('signin').hidden = false; if (failed) say(failed, true); }
</script></body></html>`;
