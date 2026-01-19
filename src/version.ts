/**
 * Version Information Module
 * 
 * Provides version info for the vCon MCP Server.
 * Version info is injected via environment variables during CI/CD builds.
 * Falls back to "dev" values for local development.
 * 
 * Environment Variables:
 *   - VCON_MCP_VERSION: CalVer version (e.g., "2026.01.18")
 *   - VCON_MCP_GIT_COMMIT: Git short hash (e.g., "a1b2c3d")
 *   - VCON_MCP_BUILD_TIME: ISO timestamp of build
 */

export interface VersionInfo {
  /** CalVer version (YYYY.MM.DD[.N]) or "dev" for local development */
  version: string;
  /** Git commit short hash or "unknown" */
  gitCommit: string;
  /** ISO timestamp of build or current time for dev */
  buildTime: string;
  /** Whether running in development mode (no CI/CD version set) */
  isDev: boolean;
}

/**
 * Get version information from environment variables
 */
export function getVersionInfo(): VersionInfo {
  const version = process.env.VCON_MCP_VERSION || 'dev';
  const gitCommit = process.env.VCON_MCP_GIT_COMMIT || 'unknown';
  const buildTime = process.env.VCON_MCP_BUILD_TIME || new Date().toISOString();
  const isDev = version === 'dev';

  return {
    version,
    gitCommit,
    buildTime,
    isDev,
  };
}

/**
 * Get a formatted version string for display
 * e.g., "2026.01.18 (a1b2c3d)" or "dev (unknown)"
 */
export function getVersionString(): string {
  const info = getVersionInfo();
  return `${info.version} (${info.gitCommit})`;
}

/**
 * Get version info as a simple object for JSON responses
 */
export function getVersionResponse(): VersionInfo {
  return getVersionInfo();
}
