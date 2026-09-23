# Security

Security considerations specific to vCon MCP Server.

## Supabase Keys

| Key | Access Level | Use Case |
|-----|--------------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Full access, bypasses RLS | Server-side deployments |
| `SUPABASE_ANON_KEY` | Restricted, RLS enforced | Client-facing with user auth |

**Recommendation**: Use `SUPABASE_SERVICE_ROLE_KEY` for trusted server deployments.

## Tool Access Control

### Profiles

Control which MCP tools are available:

```bash
MCP_TOOLS_PROFILE=readonly   # Read-only operations
MCP_TOOLS_PROFILE=user       # CRUD without admin ops
MCP_TOOLS_PROFILE=full       # All tools (default)
```

### Disable Specific Tools

```bash
MCP_DISABLED_TOOLS=delete_vcon,execute_sql
```

### Available Profiles

| Profile | Description |
|---------|-------------|
| `full` | All tools enabled (default) |
| `readonly` | Read-only operations only |
| `user` | CRUD without admin operations |
| `admin` | Full access including schema changes |
| `minimal` | Basic operations only |
| `public` | Read and search tools for a hosted public dataset; hides database internals, analytics, deployment-shaped rollups, and the prompts that assume them |

## OAuth for MCP Connectors

claude.ai and the Claude Desktop chat add remote MCP servers as custom connectors, and those
only sign in with OAuth 2.1. Claude Code and scripts keep using a static bearer token from
`API_KEYS` or `API_KEYS_READONLY`; the server checks static keys first, so turning OAuth on
changes nothing for them.

vcon-mcp is the **resource server** only. An external authorization server handles sign-in,
PKCE, dynamic client registration and token issuance. The steps below use Supabase OAuth
Server; any issuer that signs JWTs and publishes `<issuer>/.well-known/jwks.json` works the
same way.

### What the server does

| Path | Auth | Response |
|------|------|----------|
| `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` | none | RFC 9728 metadata naming `OAUTH_ISSUER` as the authorization server |
| `/.well-known/oauth-authorization-server` | none | `302` to the issuer's RFC 8414 metadata |
| `/oauth/consent` | none | Consent page, when `OAUTH_CONSENT_ANON_KEY` is set |
| `/mcp` with no or bad token | | `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"` |
| `/mcp` with an OAuth token | JWT | Checked on every request: signature against the issuer JWKS, `iss`, `exp`, `aud` equal to `OAUTH_RESOURCE`, optional email domain |

The REST API (`/api/v1`) still takes static keys only.

### Environment

```bash
OAUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1
OAUTH_RESOURCE=https://mcp.example.com/mcp     # the exact URL users paste into the connector
OAUTH_READONLY=true                             # default; false gives OAuth sessions write tools
OAUTH_ALLOWED_EMAIL_DOMAINS=example.com         # optional
OAUTH_CONSENT_ANON_KEY=<publishable key>        # Supabase publishable (anon) key, safe to expose
```

With OAuth on, `API_KEYS` may be empty: an OAuth-only deployment gets `401`s that point at
the metadata instead of the "no API keys configured" `503`.

### Supabase setup

1. **Signing keys.** Authentication > JWT Keys: move to asymmetric keys (ES256 or RS256). The
   server verifies against the JWKS and cannot check legacy HS256 tokens.
2. **OAuth Server.** Authentication > OAuth Server: enable it, turn on dynamic client
   registration (claude.ai registers itself), and set the Authorization Path to
   `/oauth/consent`. Set the project's Site URL to the MCP server's origin
   (`https://mcp.example.com`) so the consent link lands on this server.
3. **Audience.** Supabase access tokens carry `aud: "authenticated"`, which the server
   rejects. Add a Custom Access Token hook that sets `aud` to `OAUTH_RESOURCE` on OAuth-issued
   tokens (those carrying `client_id`):

   ```sql
   create or replace function public.mcp_access_token_hook(event jsonb)
   returns jsonb language plpgsql stable as $$
   begin
     if event->'claims' ? 'client_id' then
       event := jsonb_set(event, '{claims,aud}', to_jsonb('https://mcp.example.com/mcp'::text));
     end if;
     return event;
   end $$;
   grant execute on function public.mcp_access_token_hook to supabase_auth_admin;
   revoke execute on function public.mcp_access_token_hook from authenticated, anon, public;
   ```

   Then select it under Authentication > Hooks > Custom Access Token.
4. **Sign-in.** The consent page signs users in with a six-digit emailed code and never creates
   accounts (`create_user: false`), so only existing users get through. Add `{{ .Token }}` to
   the Magic Link email template so the email carries the code.

### Self-hosted Supabase

The same steps apply, set through the auth container's environment instead of the dashboard.
The OAuth server is in `supabase/gotrue` from v2.180; use v2.186 or later, which
stores and enforces the `token_endpoint_auth_method` that dynamically registered clients declare.

```bash
GOTRUE_JWT_ISSUER=https://mcp.example.com/auth/v1
GOTRUE_SITE_URL=https://mcp.example.com
GOTRUE_OAUTH_SERVER_ENABLED=true
GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent
GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION=true
GOTRUE_JWT_KEYS='[<ES256 signing JWK>, <existing HS256 secret as an oct verify-only JWK>]'
GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true
GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/mcp_access_token_hook
```

Keeping the old HS256 secret in `GOTRUE_JWT_KEYS` as verify-only keeps the existing anon and
service-role keys valid, so PostgREST and vcon-mcp's database access are unaffected.

MCP clients call the authorization server without a Supabase `apikey`, which the stock Kong
gateway requires. Route the OAuth paths from the reverse proxy straight to the auth container
(port 9999) with `/auth/v1` stripped: `/auth/v1/oauth/*`, `/auth/v1/.well-known/*`,
`/auth/v1/otp`, `/auth/v1/verify`, plus `/.well-known/oauth-authorization-server/auth/v1`
rewritten to `/.well-known/oauth-authorization-server`. Give these routes priority over the
vcon-mcp route. Nothing else on the auth API needs to be public.

### Connect a client

In claude.ai: Settings > Connectors > Add custom connector, URL `https://mcp.example.com/mcp`.
Leave the OAuth client ID and secret empty; the client registers itself. Sign in, enter the
emailed code, approve. The connector then shows in Claude Desktop chat as well.

### Checks

```bash
curl -s https://mcp.example.com/.well-known/oauth-protected-resource/mcp
curl -si -X POST https://mcp.example.com/mcp | grep -i www-authenticate
```

## Container Security

The Docker image includes security defaults:

- Runs as non-root user (`vcon`, uid 1001)
- Minimal Alpine base image
- No shell access by default

## Best Practices

- Store secrets in environment variables or secret managers, not in code
- Use HTTPS in production (via reverse proxy)
- Enable `MCP_HTTP_STATELESS=true` for multi-instance deployments
- Restrict tool profiles based on use case

## Next Steps

- [Production Setup](./production.md)
- [Docker Deployment](./docker.md)
