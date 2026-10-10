# Project Nexus

Connect with purpose.

Project Nexus is a social coordination platform. The intended product combines identity, social discovery, messaging, communities, content, and an AI social agent. The initial audience is technology builders and communities.

## Current development status

This repository currently contains the application scaffold only.

The following are **not implemented**:

- authentication
- user profiles
- database schema or connectivity
- follow/unfollow
- blocking
- feed
- posts, comments, and reactions
- messaging
- communities and channels
- notifications
- moderation
- AI features

Do not treat this repository as a working product.

## Architecture

TypeScript modular monolith using Next.js App Router.

Current layout:

- `app/` — routes, layouts, and HTTP handlers
- `lib/` — shared application utilities (server-only configuration lives here)
- `tests/` — unit and component tests
- `e2e/` — Playwright end-to-end tests

Future domain modules (identity, social graph, content, messaging, communities, notifications, moderation, AI) will be added as real implementations, not empty placeholders.

## Technology stack

- Next.js (App Router)
- React
- TypeScript (strict)
- npm
- ESLint
- Vitest
- Playwright
- Tailwind CSS (styling only; no product UI yet)

PostgreSQL is planned. No database is connected in this phase.

## Prerequisites

- Node.js 20 or later
- npm 10 or later

## Installation

```bash
npm install
```

## Environment setup

Copy the example environment file:

```bash
cp .env.example .env.local
```

`.env.example` contains empty placeholders only:

- `DATABASE_URL`
- `AUTH_SECRET`
- `USER_LLM_API_KEY`
- `USER_LLM_BASE_URL`
- `USER_LLM_MODEL`

Leave these empty until a later phase requires them. Do not invent credentials. Do not copy keys from the agent runtime or any other environment.

## Commands

Development:

```bash
npm run dev
```

Unit tests:

```bash
npm run test
```

End-to-end tests (requires Playwright browsers):

```bash
npm run test:e2e
```

Lint:

```bash
npm run lint
```

Typecheck:

```bash
npm run typecheck
```

Production build:

```bash
npm run build
```

## Security note

- Never commit `.env`, `.env.local`, or files containing secrets.
- Server secrets must stay server-side. Do not prefix them with `NEXT_PUBLIC_`.
- LLM keys, if used later, must be supplied by the project operator as `USER_LLM_*` values. Do not reuse platform or agent keys.
- The health endpoint reports process-level application status only. It does not claim database, AI, storage, or realtime health.

## Current MVP status

Phase 02 scaffold. Product MVP work has not started.
