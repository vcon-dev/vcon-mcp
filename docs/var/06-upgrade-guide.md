# VCONIC Upgrade Guide

**Audience:** Reseller deployment leads upgrading a customer instance to
a newer VCONIC release.

## Reseller lens

Use a stop-the-world upgrade: snapshot, migrate, swap, verify. The
procedure is short because each step is non-negotiable.

## Before you start

1. Read the [Release Notes](./07-release-notes.md) for the target version.
2. Note breaking changes and new required env vars.
3. **Snapshot the database.** Supabase backup (cloud) or `pg_dump`
   (self-hosted).
4. Record the current version: `curl -I http://<host>:3000/api/v1/health`
   — capture `X-Version` and `X-Git-Commit`.

## Upgrade procedure

```bash
# 1. Pull the target image (always pin to a semver tag)
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<new-tag>

# 2. Run new migrations BEFORE swapping the running container
docker run --rm \
  -e SUPABASE_DB_URL='postgresql://...' \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<new-tag> \
  migrate

# 3. Stop the current container
docker stop --time 30 vconic && docker rm vconic

# 4. Start the new image with the same env file
docker run -d --name vconic \
  --env-file /etc/vconic/env \
  -p 3000:3000 \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<new-tag>

# 5. Smoke-test
curl -I http://localhost:3000/api/v1/health
# Confirm X-Version matches <new-tag>
```

## Smoke-test (do every time)

- `GET /api/v1/health` → 200, `X-Version` matches target
- One `tools/list` MCP call → expected tool catalog
- One `get_vcon` against a known UUID → returns the vCon
- One `search_vcons` with a known filter → returns expected count

If any check fails, roll back immediately (see below) before
investigating.

## Rollback

```bash
# 1. Stop the new container
docker stop vconic && docker rm vconic

# 2. Restart the previous image
docker run -d --name vconic \
  --env-file /etc/vconic/env \
  -p 3000:3000 \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<previous-tag>
```

**Database rollback is harder.** Newly applied migrations are not
automatically reversible. If the new build is incompatible with the
old code:

1. Stop the new container.
2. Restore the database snapshot taken in step 3 of pre-upgrade.
3. Start the previous image against the restored database.

This is why the pre-upgrade snapshot is non-negotiable.

## Verifying after upgrade

Beyond the smoke-test:

- Check structured logs for new error codes you don't recognize.
- Run `get_database_health_metrics` — flag any recommendations that
  weren't there before the upgrade.
- Confirm tenant queries still scope correctly (RLS deployments).
- Watch latency dashboards for 24 hours before declaring success.

## See also

- [Release Notes](./07-release-notes.md)
- [Migration Guide](../reference/MIGRATION_GUIDE.md)
- [Changelog](../reference/CHANGELOG.md)
