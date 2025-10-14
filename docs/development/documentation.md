# Documentation Standards

Guidelines for writing and maintaining documentation for the vCon MCP Server project.

## Table of Contents

- [Documentation Types](#documentation-types)
- [Writing Style](#writing-style)
- [Markdown Standards](#markdown-standards)
- [Code Examples](#code-examples)
- [API Documentation](#api-documentation)
- [User Guides](#user-guides)
- [Build and Deploy](#build-and-deploy)

---

## Documentation Types

### 1. API Reference (`docs/api/`)

**Purpose:** Complete reference for all tools, resources, prompts, types, and schemas.

**Audience:** Developers integrating with or extending the server.

**Content:**
- All input/output parameters
- Type definitions
- Examples for every function
- Error responses
- Performance characteristics

### 2. User Guides (`docs/guide/`)

**Purpose:** Help users accomplish specific tasks.

**Audience:** End users and developers using the server.

**Content:**
- Step-by-step instructions
- Common use cases
- Troubleshooting
- Best practices

### 3. Developer Guides (`docs/development/`)

**Purpose:** Help developers contribute to the project.

**Audience:** Contributors and maintainers.

**Content:**
- Architecture explanation
- Code standards
- Testing procedures
- Plugin development

### 4. Examples (`docs/examples/`)

**Purpose:** Practical code examples and tutorials.

**Audience:** All users, especially beginners.

**Content:**
- Complete working examples
- Real-world scenarios
- Copy-paste ready code

### 5. Reference (`docs/reference/`)

**Purpose:** Technical specifications and standards.

**Audience:** Advanced developers and spec implementers.

**Content:**
- IETF vCon spec details
- Database schema
- Protocol specifications
- Migration guides

---

## Writing Style

### General Principles

1. **Be Clear** - Use simple, direct language
2. **Be Concise** - Get to the point quickly
3. **Be Consistent** - Follow established patterns
4. **Be Complete** - Cover all necessary information
5. **Be Accurate** - Keep documentation current

### Voice and Tone

- **Use active voice**: "The server validates..." not "The vCon is validated by..."
- **Use second person**: "You can create..." not "One can create..."
- **Be direct**: "Set the environment variable" not "You might want to consider setting..."
- **Be helpful**: Include context and reasoning

### Examples

✅ **Good:**
```markdown
To create a vCon, call the `create_vcon` tool with a parties array:

```typescript
const vcon = {
  vcon: '0.3.0',
  parties: [{ name: 'Alice' }]
};
```

The server validates the structure and returns the UUID.
```

❌ **Bad:**
```markdown
A vCon can be created by the user by calling the create_vcon tool. 
One should ensure that the vCon has parties otherwise it might fail.
```

---

## Markdown Standards

### Headings

Use ATX-style headings (with `#`):

```markdown
# Main Title (H1 - One per page)

## Major Section (H2)

### Subsection (H3)

#### Detail (H4)

##### Note (H5 - Rarely used)
```

**Rules:**
- Only one H1 per document
- Don't skip heading levels
- Use sentence case for headings
- Add a blank line before and after headings

### Lists

**Unordered lists:**

```markdown
- First item
- Second item
  - Nested item
  - Another nested item
- Third item
```

**Ordered lists:**

```markdown
1. First step
2. Second step
   1. Sub-step
   2. Another sub-step
3. Third step
```

**Task lists:**

```markdown
- [ ] Todo item
- [x] Completed item
- [ ] Another todo
```

### Links

**Internal links:**

```markdown
See [Architecture](./architecture.md) for details.

Jump to [Creating a Tool](#creating-a-tool) section.
```

**External links:**

```markdown
Read the [IETF vCon Spec](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-00).
```

### Emphasis

```markdown
*Italic* or _italic_

**Bold** or __bold__

***Bold and italic***

`inline code`
```

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value 1  | Value 2  | Value 3  |
| Value A  | Value B  | Value C  |
```

**Alignment:**

```markdown
| Left | Center | Right |
|:-----|:------:|------:|
| L1   |   C1   |    R1 |
| L2   |   C2   |    R2 |
```

### Admonitions

Use blockquotes with emoji for callouts:

```markdown
> 📝 **Note:** Additional information that's helpful to know.

> ⚠️ **Warning:** Important information that requires attention.

> 🚨 **Critical:** Essential information that could cause problems if ignored.

> 💡 **Tip:** Helpful suggestion or best practice.

> ✅ **Success:** Confirmation or positive outcome.
```

---

## Code Examples

### Code Blocks

Always specify the language:

````markdown
```typescript
// TypeScript code
const vcon: VCon = {
  vcon: '0.3.0',
  uuid: crypto.randomUUID()
};
```

```bash
# Shell commands
npm install
npm test
```

```sql
-- SQL queries
SELECT * FROM vcons WHERE created_at > '2025-01-01';
```

```json
{
  "success": true,
  "uuid": "123e4567-e89b-12d3-a456-426614174000"
}
```
````

### Complete Examples

Provide complete, working examples:

````markdown
**Complete Example:**

```typescript
import { createClient } from '@supabase/supabase-js';
import { VCon } from './types/vcon';

// Initialize client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

// Create vCon
async function main() {
  const vcon: VCon = {
    vcon: '0.3.0',
    uuid: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    parties: [
      { name: 'Alice', mailto: 'alice@example.com' }
    ]
  };

  const { data, error } = await supabase
    .from('vcons')
    .insert(vcon)
    .select();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Created:', data[0].uuid);
}

main();
```
````

### Inline Code

Use backticks for:
- Function names: `createVCon()`
- Variable names: `vconUuid`
- File names: `config.ts`
- Command names: `npm`
- Type names: `VCon`

### Terminal Commands

Show commands and expected output:

````markdown
```bash
$ npm test

> vcon-mcp-server@1.0.0 test
> vitest

✓ tests/crud.test.ts (5)
✓ tests/search.test.ts (8)

Test Files  2 passed (2)
Tests  13 passed (13)
```
````

### Multi-Step Examples

Number steps clearly:

````markdown
### Step 1: Install Dependencies

```bash
npm install @supabase/supabase-js
```

### Step 2: Configure Environment

```bash
echo "SUPABASE_URL=your-url" >> .env
echo "SUPABASE_KEY=your-key" >> .env
```

### Step 3: Initialize Client

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);
```
````

---

## API Documentation

### Tool Documentation Template

````markdown
### tool_name

Brief description of what the tool does.

**Input Parameters:**

```typescript
{
  param1: string;              // Description
  param2?: number;             // Description (optional)
  param3: "a" | "b" | "c";    // Description (enum)
}
```

**Response:**

```typescript
{
  success: boolean;
  data?: ResultType;
  error?: string;
}
```

**Example:**

```typescript
const result = await callTool("tool_name", {
  param1: "value",
  param2: 42
});
```

**Errors:**

- `VALIDATION_ERROR` - When input validation fails
- `NOT_FOUND` - When resource doesn't exist
- `DATABASE_ERROR` - When database operation fails

**Performance:**
- Typical response time: ~100ms
- Rate limit: 100 requests/minute
````

### Type Documentation Template

````markdown
### TypeName

Description of the type and its purpose.

```typescript
interface TypeName {
  field1: string;              // Description
  field2?: number;             // Description (optional)
  field3: OtherType;          // Description
}
```

**Required Fields:**
- `field1` - Description and requirements
- `field3` - Description and requirements

**Optional Fields:**
- `field2` - Description and default value

**Examples:**

```typescript
// Minimal example
const minimal: TypeName = {
  field1: "value",
  field3: { /* ... */ }
};

// Complete example
const complete: TypeName = {
  field1: "value",
  field2: 42,
  field3: { /* ... */ }
};
```

**Validation:**
- `field1` must be non-empty
- `field2` must be positive if provided
- `field3` must be valid OtherType

**See Also:**
- [Related Type](./path.md#related-type)
- [Usage Example](../examples/example.md)
````

---

## User Guides

### Guide Structure

1. **Title** - Clear, action-oriented
2. **Introduction** - What you'll learn
3. **Prerequisites** - What's needed
4. **Steps** - Numbered, clear instructions
5. **Verification** - How to confirm success
6. **Troubleshooting** - Common issues
7. **Next Steps** - What to do next

### Example Guide Template

````markdown
# How to [Do Something]

Learn how to [accomplish goal] using [tool/feature].

## What You'll Learn

- How to [specific task 1]
- How to [specific task 2]
- Best practices for [topic]

## Prerequisites

Before starting, ensure you have:
- [ ] Item 1
- [ ] Item 2
- [ ] Item 3

## Steps

### Step 1: [First Action]

Description of what this step accomplishes.

```bash
# Commands to run
command --option value
```

**Expected output:**
```
Output that indicates success
```

### Step 2: [Second Action]

Continue with clear instructions...

## Verification

Verify your setup:

```bash
# Check command
npm test
```

You should see:
- ✅ All tests passing
- ✅ No errors in output

## Troubleshooting

### Issue: [Common Problem]

**Symptom:** Description of the problem

**Solution:**
1. Check X
2. Verify Y
3. Try Z

### Issue: [Another Problem]

**Symptom:** Description

**Solution:** Steps to fix

## Next Steps

Now that you've completed this guide:
- [Next Guide](./next-guide.md)
- [Related Topic](./related.md)
- [Advanced Usage](./advanced.md)
````

---

## Build and Deploy

### VitePress Setup

The documentation uses VitePress. To work on docs:

```bash
# Install dependencies
npm install

# Start dev server
npm run docs:dev

# Build for production
npm run docs:build

# Preview production build
npm run docs:preview
```

### Adding New Pages

1. **Create markdown file** in appropriate directory
2. **Add to sidebar** in `docs/.vitepress/config.ts`
3. **Link from index** or related pages
4. **Test locally** before committing

**Example sidebar config:**

```typescript
sidebar: {
  '/guide/': [
    {
      text: 'Getting Started',
      items: [
        { text: 'Introduction', link: '/guide/' },
        { text: 'Installation', link: '/guide/installation' },
        { text: 'Your New Page', link: '/guide/new-page' }
      ]
    }
  ]
}
```

### Documentation Workflow

1. **Create branch** for documentation changes
2. **Write/update** documentation
3. **Test locally** with `npm run docs:dev`
4. **Check links** are working
5. **Build** with `npm run docs:build`
6. **Commit** with appropriate message
7. **Create PR** for review

### Keeping Docs Updated

**When code changes:**
- [ ] Update API documentation
- [ ] Update code examples
- [ ] Update type definitions
- [ ] Update error messages
- [ ] Add migration notes if breaking

**When adding features:**
- [ ] Add to API reference
- [ ] Create user guide
- [ ] Add examples
- [ ] Update README
- [ ] Update changelog

### Documentation Review Checklist

Before submitting documentation:

- [ ] Spelling and grammar checked
- [ ] Code examples tested
- [ ] Links work correctly
- [ ] Images display properly
- [ ] Builds without errors
- [ ] Follows style guide
- [ ] No broken internal links
- [ ] No Lorem ipsum or TODO placeholders

---

## Style Guide Summary

### Do's ✅

- Use clear, simple language
- Provide complete examples
- Include error handling
- Show expected output
- Link to related content
- Keep content current
- Test all examples

### Don'ts ❌

- Use passive voice excessively
- Skip error cases
- Assume prior knowledge
- Use jargon without explanation
- Provide incomplete examples
- Leave content outdated
- Include untested code

---

## Documentation Templates

### New Feature Documentation

When adding a new feature, create:

1. **API Reference** - Complete technical specs
2. **User Guide** - How to use the feature
3. **Example** - Working code example
4. **Changelog Entry** - What changed

### Bug Fix Documentation

When fixing a bug:

1. **Update relevant docs** where bug was documented
2. **Add troubleshooting entry** if user-facing
3. **Update changelog** with fix details

### Deprecation Documentation

When deprecating a feature:

1. **Add deprecation notice** to docs
2. **Document migration path** to replacement
3. **Update changelog** with timeline
4. **Keep old docs** with "DEPRECATED" header

---

## Resources

### Tools

- **VS Code** with Markdown Preview
- **Grammarly** for spell/grammar checking
- **markdown-link-check** for broken links
- **VitePress** documentation framework

### References

- [VitePress Guide](https://vitepress.dev/guide/what-is-vitepress)
- [Markdown Guide](https://www.markdownguide.org/)
- [Google Developer Documentation Style Guide](https://developers.google.com/style)
- [Write the Docs](https://www.writethedocs.org/)

---

## Questions?

- Check existing documentation for examples
- Ask in GitHub Discussions
- Review recent PRs for documentation changes
- Contact documentation maintainers

**Remember:** Good documentation is as important as good code! 📚

