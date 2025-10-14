# Contributing Guide

Thank you for your interest in contributing to the vCon MCP Server! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Documentation](#documentation)
- [Release Process](#release-process)

---

## Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, experience level, nationality, personal appearance, race, religion, or sexual identity.

### Our Standards

**Positive behavior includes:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Accepting constructive criticism gracefully
- Focusing on what's best for the community
- Showing empathy towards others

**Unacceptable behavior includes:**
- Harassment, trolling, or derogatory comments
- Publishing others' private information
- Personal or political attacks
- Other unprofessional conduct

### Enforcement

Report violations to [project maintainers]. All complaints will be reviewed and investigated promptly and fairly.

---

## Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Node.js 18+** installed
- **Git** installed and configured
- **Supabase account** for database testing
- **GitHub account**
- Read the [Architecture documentation](./architecture.md)

### Initial Setup

1. **Fork the repository**
   ```bash
   # On GitHub, click "Fork" button
   ```

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/vcon-mcp.git
   cd vcon-mcp
   ```

3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/vcon-dev/vcon-mcp.git
   ```

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

6. **Run tests**
   ```bash
   npm test
   ```

7. **Build the project**
   ```bash
   npm run build
   ```

### Development Environment

We recommend:
- **VS Code** with these extensions:
  - ESLint
  - Prettier
  - TypeScript and JavaScript Language Features
  - GitLens
- **Database GUI**: Supabase Dashboard or pgAdmin

---

## Development Workflow

### Creating a Feature Branch

```bash
# Update your main branch
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/issue-number-description
```

**Branch Naming Convention:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/changes
- `chore/` - Maintenance tasks

### Making Changes

1. **Make your changes**
   - Follow [Coding Standards](#coding-standards)
   - Add tests for new functionality
   - Update documentation

2. **Test your changes**
   ```bash
   # Run all tests
   npm test
   
   # Run specific test
   npm test -- search.test.ts
   
   # Run with coverage
   npm run test:coverage
   ```

3. **Lint and format**
   ```bash
   # Check linting
   npm run lint
   
   # Fix linting issues
   npm run lint:fix
   
   # Format code
   npm run format
   ```

4. **Build and verify**
   ```bash
   npm run build
   npm run dev  # Test locally
   ```

### Committing Changes

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git add .
git commit -m "type(scope): description"
```

**Commit Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Maintenance tasks
- `perf`: Performance improvements

**Examples:**
```bash
git commit -m "feat(search): add hybrid search capability"
git commit -m "fix(validation): correct analysis vendor requirement"
git commit -m "docs(api): update tools reference"
git commit -m "test(crud): add tests for delete operation"
```

### Keeping Your Branch Updated

```bash
# Fetch upstream changes
git fetch upstream

# Rebase on upstream main
git rebase upstream/main

# Or merge if preferred
git merge upstream/main

# Force push if you rebased (after confirming with team)
git push origin feature/your-feature-name --force-with-lease
```

---

## Pull Request Process

### Before Submitting

Ensure your PR:
- [ ] Follows coding standards
- [ ] Includes tests for new functionality
- [ ] Passes all existing tests
- [ ] Updates relevant documentation
- [ ] Has no linting errors
- [ ] Builds successfully
- [ ] Has descriptive commit messages

### Creating a Pull Request

1. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open PR on GitHub**
   - Go to the repository
   - Click "New Pull Request"
   - Select your branch
   - Fill in the PR template

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Existing tests pass
- [ ] New tests added
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated

## Related Issues
Closes #123
```

### Review Process

1. **Automated Checks**
   - CI/CD runs tests
   - Linting checks
   - Build verification

2. **Code Review**
   - At least one maintainer approval required
   - Address all comments
   - Make requested changes

3. **Final Checks**
   - All conversations resolved
   - CI passes
   - Up to date with main

4. **Merge**
   - Maintainer will merge your PR
   - Branch will be deleted

### After Merge

1. **Update your local repo**
   ```bash
   git checkout main
   git pull upstream main
   ```

2. **Delete feature branch**
   ```bash
   git branch -d feature/your-feature-name
   git push origin --delete feature/your-feature-name
   ```

---

## Coding Standards

See [Code Style Guide](./code-style.md) for detailed standards.

### Quick Reference

**TypeScript:**
```typescript
// ✅ Good
export interface VCon {
  vcon: string;
  uuid: string;
  parties: Party[];
}

// ❌ Bad
export interface VCon {
  vcon: string;
  uuid: string;
  parties: any;  // Don't use 'any'
}
```

**Function Documentation:**
```typescript
/**
 * Create a new vCon in the database.
 * 
 * @param vcon - The vCon object to create
 * @returns Promise resolving to UUID of created vCon
 * @throws {ValidationError} If vCon fails validation
 * @throws {DatabaseError} If database operation fails
 */
async function createVCon(vcon: VCon): Promise<string> {
  // Implementation
}
```

**Error Handling:**
```typescript
// ✅ Good
try {
  const result = await queries.createVCon(vcon);
  return { success: true, uuid: result.uuid };
} catch (error) {
  logger.error('Failed to create vCon', { error, vcon });
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error'
  };
}
```

---

## Testing Requirements

### Test Coverage

All contributions must maintain test coverage:
- **Minimum:** 80% overall coverage
- **New code:** 90% coverage required
- **Critical paths:** 100% coverage

### Writing Tests

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VConQueries } from '../src/db/queries';
import { createTestVCon } from './fixtures';

describe('VConQueries', () => {
  let queries: VConQueries;
  
  beforeAll(async () => {
    // Setup
    queries = new VConQueries(supabase);
  });
  
  afterAll(async () => {
    // Cleanup
  });
  
  it('should create a vCon', async () => {
    const vcon = createTestVCon();
    const result = await queries.createVCon(vcon);
    
    expect(result.uuid).toBeDefined();
    expect(result.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });
  
  it('should reject invalid vCon', async () => {
    const invalidVCon = { vcon: '0.3.0' }; // Missing required fields
    
    await expect(queries.createVCon(invalidVCon as any))
      .rejects
      .toThrow('Validation failed');
  });
});
```

### Test Types

1. **Unit Tests** - Test individual functions
2. **Integration Tests** - Test component interactions
3. **Compliance Tests** - Test IETF spec compliance
4. **E2E Tests** - Test full workflows

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Specific file
npm test -- crud.test.ts

# Coverage report
npm run test:coverage

# Compliance tests only
npm run test:compliance
```

---

## Documentation

### Documentation Requirements

All contributions must include:

1. **Code Comments**
   - JSDoc for public APIs
   - Inline comments for complex logic
   - TODO/FIXME with issue numbers

2. **API Documentation**
   - Update `docs/api/` if changing tools/resources
   - Include examples
   - Document parameters and return values

3. **User Documentation**
   - Update `docs/guide/` if affecting user features
   - Add examples and use cases
   - Include troubleshooting tips

4. **README Updates**
   - Update if changing setup process
   - Keep examples current
   - Update feature list

### Documentation Style

See [Documentation Standards](./documentation.md) for details.

**Example:**

```typescript
/**
 * Search vCons using semantic similarity.
 * 
 * Uses AI embeddings to find conversations with similar meaning,
 * not just matching keywords.
 * 
 * @example
 * ```typescript
 * const results = await searchVConsSemantic(
 *   "frustrated customers",
 *   { threshold: 0.75, limit: 20 }
 * );
 * ```
 * 
 * @param query - Natural language search query
 * @param options - Search options
 * @param options.threshold - Minimum similarity (0-1), default 0.7
 * @param options.limit - Maximum results, default 20
 * @returns Promise resolving to search results
 * @throws {EmbeddingError} If embedding generation fails
 */
async function searchVConsSemantic(
  query: string,
  options?: SemanticSearchOptions
): Promise<SemanticResult[]> {
  // Implementation
}
```

---

## Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **Major (X.0.0)** - Breaking changes
- **Minor (0.X.0)** - New features (backward compatible)
- **Patch (0.0.X)** - Bug fixes

### Release Checklist

For maintainers:

1. **Update Version**
   ```bash
   npm version major|minor|patch
   ```

2. **Update CHANGELOG**
   - Document all changes
   - Group by type (Added, Changed, Fixed, Removed)
   - Include issue/PR numbers

3. **Create Release Branch**
   ```bash
   git checkout -b release/v1.2.0
   ```

4. **Final Testing**
   - Run full test suite
   - Test in production-like environment
   - Verify documentation

5. **Create Release PR**
   - Review all changes
   - Get approval from maintainers

6. **Merge and Tag**
   ```bash
   git checkout main
   git merge release/v1.2.0
   git tag -a v1.2.0 -m "Release v1.2.0"
   git push origin main --tags
   ```

7. **Publish**
   ```bash
   npm publish
   ```

8. **Create GitHub Release**
   - Copy CHANGELOG entry
   - Attach built assets
   - Publish release notes

---

## Getting Help

### Where to Ask

- **GitHub Issues** - Bug reports, feature requests
- **GitHub Discussions** - Questions, ideas, general discussion
- **Discord** - Real-time chat with community
- **Email** - Private matters to [maintainers email]

### Issue Templates

**Bug Report:**
```markdown
**Describe the bug**
Clear description of the bug

**To Reproduce**
Steps to reproduce

**Expected behavior**
What should happen

**Actual behavior**
What actually happens

**Environment**
- OS: [e.g., macOS 13.0]
- Node.js: [e.g., 18.12.0]
- vCon MCP Server: [e.g., 1.0.0]
```

**Feature Request:**
```markdown
**Problem Statement**
What problem does this solve?

**Proposed Solution**
How would you solve it?

**Alternatives Considered**
Other approaches you considered

**Additional Context**
Any other relevant information
```

---

## Recognition

Contributors are recognized in:

- **CONTRIBUTORS.md** - All contributors listed
- **Release Notes** - Major contributions highlighted
- **GitHub Profile** - Contribution graph

We appreciate all contributions, big and small!

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## Questions?

If you have questions about contributing:
1. Check existing documentation
2. Search existing issues/discussions
3. Ask in GitHub Discussions
4. Contact maintainers

Thank you for contributing to vCon MCP Server! 🎉

