---
name: coding-style
description: "Apply the repository coding style and formatting conventions for TypeScript changes, including naming, typing, error handling, and Prettier-aligned output."
---

# Coding Style Skill

Use this skill when creating or refactoring TypeScript code in this repository.

## EditorConfig Source Of Truth

The canonical EditorConfig lives in this skill at `.github/skills/coding-style/.editorconfig`.

The canonical Prettier files also live in this skill:

- `.github/skills/coding-style/.prettierrc.json`
- `.github/skills/coding-style/.prettierignore`

If the root config files are missing, copy them from the skill:

```bash
if [ ! -f .editorconfig ]; then cp .github/skills/coding-style/.editorconfig .editorconfig; fi
if [ ! -f .prettierrc.json ]; then cp .github/skills/coding-style/.prettierrc.json .prettierrc.json; fi
if [ ! -f .prettierignore ]; then cp .github/skills/coding-style/.prettierignore .prettierignore; fi
```

## Rules

1. Keep functions short and single-purpose.
2. Favor explicit and descriptive naming.
3. Add explicit return types to exported functions.
4. Validate unknown input at system boundaries.
5. Prefer pure helper functions where practical.
6. Keep formatting compatible with Prettier and EditorConfig.

## Output Checklist

1. Consistent naming and structure with existing project files.
2. No unnecessary complexity or deep nesting.
3. Types are explicit at public boundaries.
4. Changed files are formatted with Prettier.
5. Tests updated when behavior changes.
