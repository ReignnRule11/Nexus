# Project Nexus

Connect with purpose.

Project Nexus is a social coordination platform. The intended product combines identity, social discovery, messaging, communities, content, and an AI social agent. The initial audience is technology builders and communities.

## Current development status

This repository contains the application scaffold, identity, authentication, social graph, chronological content APIs, and private media storage.

The following are **not implemented**:

- product UI beyond the landing page
- messaging
- communities and channels
- notifications
- moderation
- search engine
- AI features
- ranking or recommendation

Do not treat this repository as a working product.

## Architecture

TypeScript modular monolith using Next.js App Router.

Current layout:

- `app/` — routes, layouts, and HTTP handlers
- `lib/` — shared application utilities (server-only configuration and Prisma client live here)
- `prisma/` — schema and versioned migrations
- `tests/` — unit and component tests
- `e2e/` — Playwright end-to-end tests

Future domain modules (identity behavior, social graph, content, messaging, communities, notifications, moderation, AI) will be added as real implementations, not empty placeholders.

## Technology stack

- Next.js (App Router)
- React
- TypeScript (strict)
- npm
- Prisma 7
- PostgreSQL 15
- ESLint
- Vitest
- Playwright
- Tailwind CSS (styling only; no product UI yet)

## Prerequisites

- Node.js 20 or later
- npm 10 or later
- PostgreSQL 15 or later, when database access is required

## Installation

```bash
npm install
```

`postinstall` generates the Prisma Client into `lib/generated/prisma`.

## Environment setup

Copy the example environment file:

```bash
cp .env.example .env.local
```

`.env.example` contains empty placeholders only:

- `DATABASE_URL`
- `AUTH_SECRET`
- `STORAGE_DRIVER`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `USER_LLM_API_KEY`
- `USER_LLM_BASE_URL`
- `USER_LLM_MODEL`

Leave these empty until a later phase requires them. Do not invent credentials. Do not copy keys from the agent runtime or any other environment.

When a PostgreSQL instance is available, set `DATABASE_URL` to that instance and apply migrations:

```bash
npm run db:validate
npm run db:migrate
```

Do not point tests at a production database.

PostgreSQL integration tests run only when `DATABASE_URL` points at a dedicated `nexus_test` database. Without that, they are skipped.

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

Prisma:

```bash
npm run db:generate
npm run db:validate
npm run db:migrate
```

## Health endpoints

- `GET /api/health` reports process-level application status only.
- `GET /api/health/db` reports PostgreSQL readiness. If `DATABASE_URL` is missing, it returns HTTP 503 with `not_configured`. It does not claim the database is healthy unless a real connection succeeds.

## Security note

- Never commit `.env`, `.env.local`, or files containing secrets.
- Server secrets must stay server-side. Do not prefix them with `NEXT_PUBLIC_`.
- Prisma Client and `DATABASE_URL` are server-only.
- Session rows store `token_hash`, not plaintext session secrets.
- LLM keys, if used later, must be supplied by the project operator as `USER_LLM_*` values. Do not reuse platform or agent keys.

## Current MVP status

Phase 07 private media storage and post attachments. Messaging, communities, notifications, and later product phases have not started.
