# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pi Monorepo — tools for building AI agents and managing LLM deployments. npm workspaces monorepo with lockstep versioning across all packages.

## Packages (dependency order)

1. **pi-tui** (`packages/tui`) — Terminal UI library with differential rendering
2. **pi-ai** (`packages/ai`) — Unified multi-provider LLM API (OpenAI, Anthropic, Google, Gemini, Bedrock, etc.)
3. **pi-agent-core** (`packages/agent`) — Agent runtime with tool calling, transport abstraction, state management
4. **pi-coding-agent** (`packages/coding-agent`) — Interactive coding agent CLI (the main product, `pi` binary)
5. **pi-mom** (`packages/mom`) — Slack bot delegating to the coding agent
6. **pi-web-ui** (`packages/web-ui`) — Web components for AI chat interfaces
7. **pi-pods** (`packages/pods`) — CLI for managing vLLM deployments on GPU pods

All packages are published under `@mariozechner/` scope.

## Essential Commands

```bash
npm install                # Install all workspace dependencies
npm run build              # Build all packages (sequential, respects dependency order)
npm run check              # Biome lint/format + tsgo type check (requires build first)
./test.sh                  # Run all tests without API keys (LLM tests skipped)
./pi-test.sh               # Run pi coding agent from sources
```

### Running a Single Test

Run from the **package root**, not the repo root:
```bash
cd packages/ai
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

For `tui` package (uses node:test, not vitest):
```bash
cd packages/tui
node --test --import tsx test/specific.test.ts
```

### What NOT to Run

- `npm run dev` / `npm run build` / `npm test` from repo root during development — only use `npm run check` and specific test commands
- Never run `npm run dev` or `npm run build` as an agent

## Code Style & Tooling

- **Formatter/Linter**: Biome (tabs, indent width 3, line width 120)
- **TypeScript**: `tsgo` (native TS compiler preview) for type checking; `tsx` for running `.ts` files
- **Module system**: ESM (`"type": "module"`) with Node16 module resolution
- **Build**: `tsgo -p tsconfig.build.json` per package
- **Test**: vitest for most packages, `node --test` for tui
- **Pre-commit hook**: runs `npm run check` automatically via husky

## Critical Rules (from AGENTS.md)

- No `any` types unless absolutely necessary
- **Never use inline imports** — no `await import("./foo.js")`, no `import("pkg").Type`. Always use standard top-level imports.
- Never remove or downgrade code to fix type errors — upgrade the dependency instead
- All keybindings must be configurable via `DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`
- Check `node_modules` for external API type definitions instead of guessing

## Git Rules

- **Never use** `git add -A` or `git add .` — always add specific files
- **Never use** `git commit --no-verify`, `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`
- Always include `fixes #<number>` or `closes #<number>` in commit messages when there's a related issue
- Never commit unless user asks

## Changelog

Each package has its own `CHANGELOG.md`. New entries go under `## [Unreleased]` in the appropriate subsection (`### Added`, `### Changed`, `### Fixed`, `### Breaking Changes`, `### Removed`). Never modify released version sections. Read the existing `[Unreleased]` section before adding to avoid duplicate subsections.

## Adding a New LLM Provider

Requires changes across multiple packages — see AGENTS.md section "Adding a New LLM Provider" for the full checklist covering: types.ts, provider implementation, stream.ts integration, model generation, tests (11+ test files), coding-agent model resolver, and documentation.

## Releasing

Lockstep versioning — all packages share the same version. Use `npm run release:patch` (fixes/features) or `npm run release:minor` (breaking changes). The script handles version bump, changelog finalization, commit, tag, and publish.
