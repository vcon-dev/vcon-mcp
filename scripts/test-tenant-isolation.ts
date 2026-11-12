/**
 * Tenant isolation test: runs the REST shape in tests/tenant-isolation/.
 *
 * This script used to test a live database with two clients, but its
 * "authenticated" client was built with the service role key, which bypasses
 * row level security, so it could not see a leak. The REST shape replaces it:
 * a throwaway PostgreSQL 17 and PostgREST 16.2 in Docker, every migration, the
 * strict pack, signed tenant JWTs and a canary per tenant. It needs Docker and
 * no database of yours.
 *
 *   npm run test:tenant                strict pack applied; every check passes
 *   npm run test:tenant:baseline       unmodified schema; asserts the known leaks
 *   npm run test:tenant:guard          catalog guard and supabase/strict/apply.sh
 *
 * Pass --baseline here for the baseline run. See docs/guide/strict-tenant-pack.md.
 */
import '../tests/tenant-isolation/rest-shape.ts';
