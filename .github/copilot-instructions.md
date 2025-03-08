# Copilot Instructions

Follow these coding style rules for all code changes in this repository unless the user explicitly asks otherwise.

## Core Style

- Keep logic simple and readable; prefer small focused functions.
- Use clear and descriptive names; avoid short ambiguous identifiers.
- Preserve existing project structure and naming conventions.
- Avoid introducing new dependencies unless there is a concrete benefit.

## TypeScript Rules

- Prefer explicit types for public APIs and function return values.
- Use `unknown` instead of `any` where possible.
- Validate external input at boundaries before using it.
- Keep error handling explicit and actionable.

## Formatting Rules

- Use Prettier formatting for all edited files.
- Respect project `.editorconfig` and `.prettierrc.json`.
- Treat skill files as canonical:
	- `.github/skills/coding-style/.editorconfig`
	- `.github/skills/coding-style/.prettierrc.json`
	- `.github/skills/coding-style/.prettierignore`
- If root `.editorconfig`, `.prettierrc.json`, or `.prettierignore` is missing, copy the missing file from `.github/skills/coding-style/`.
- Keep line length aligned with Prettier config.
- Run `npm run format` for larger edits.

## Testing And Safety

- Add or update tests for behavior changes.
- Do not silently change public behavior without clear justification.
- Prefer deterministic logic over implicit side effects.
