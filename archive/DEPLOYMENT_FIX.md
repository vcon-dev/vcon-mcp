# Fixing GitHub Actions Deployment Issues

## Issue 1: Missing Lock File

**Error:**
```
Dependencies lock file is not found in /home/runner/work/vcon-mcp/vcon-mcp. 
Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock
```

**Cause:** 
- `package-lock.json` was in `.gitignore`
- GitHub Actions workflow uses `npm ci` which requires a lock file

**Solution:**
1. Removed `package-lock.json` from `.gitignore`
2. Generate and commit the lock file

**Steps to fix:**

```bash
# Remove existing lock file if it exists
rm -f package-lock.json

# Generate fresh lock file
npm install

# Verify it was created
ls -la package-lock.json

# Add and commit
git add .gitignore package-lock.json
git commit -m "fix: commit lock file for reproducible builds"
git push
```

## Issue 2: VitePress Base Path

**Problem:** 
- Base path was set to `vcon-dev/vcon-mcp` (wrong format)
- VitePress requires paths to start AND end with `/`

**Fixed to:**
```typescript
base: '/vcon-mcp/', // Correct format
```

**Why this matters:**
- GitHub Pages serves at `https://username.github.io/repo-name/`
- Base path must match the repo name
- Must have leading and trailing slashes

## Lock File Best Practices

### Why Commit Lock Files?

✅ **Reproducible builds** - Everyone gets same versions
✅ **CI/CD reliability** - Consistent dependencies in pipelines  
✅ **Security** - Track exact versions for audits
✅ **Faster installs** - `npm ci` is faster than `npm install`
✅ **Team consistency** - No version drift

### npm ci vs npm install

**`npm ci` (used in CI/CD):**
- Requires lock file
- Installs exact versions from lock file
- Faster and more reliable
- Deletes node_modules first
- Fails if package.json and lock file are out of sync

**`npm install` (used in development):**
- Creates/updates lock file
- May install newer versions within ranges
- Slower but more flexible
- Used for adding/updating packages

## Verification Checklist

After fixing, verify:

- [ ] `package-lock.json` exists in repo root
- [ ] `package-lock.json` is NOT in `.gitignore`
- [ ] Lock file is committed to git
- [ ] VitePress base path has leading and trailing slashes
- [ ] Push triggers GitHub Actions successfully
- [ ] Documentation deploys without errors

## Testing Locally

```bash
# Test the lock file approach
rm -rf node_modules
npm ci  # Should work now

# Test VitePress build
npm run docs:build

# Test VitePress with correct base path
npm run docs:preview
# Should serve at http://localhost:4173/vcon-mcp/
```

## Alternative Solution (Not Recommended)

If you prefer NOT to commit lock files, change the workflow:

```yaml
# In .github/workflows/deploy-docs.yml
- name: Install dependencies
  run: npm install  # Changed from npm ci
```

**However, this is NOT recommended because:**
- Builds may not be reproducible
- Dependency versions may drift
- Security audits are harder
- CI/CD is less reliable

## Summary

**What was fixed:**
1. ✅ Removed `package-lock.json` from `.gitignore`
2. ✅ Fixed VitePress base path to `/vcon-mcp/`
3. ✅ Lock file will now be committed

**Next steps:**
```bash
npm install              # Generate lock file
git add -A              # Add .gitignore, config.ts, and lock file
git commit -m "fix: enable lock file and correct base path"
git push origin main    # Deploy!
```

Your GitHub Actions workflow should now succeed! 🎉

