# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Backend-For-Frontend (Express 5 + TypeScript) that sits between the `Projects_Web_Service`
frontend and upstream services. It composes/normalizes data so the frontend can render list,
grid and Kanban views, and enforces per-session permissions. Upstreams:

- **Project API** (Rust) — via the generated client `@mairie360/project-api-openapi`.
- **BFF User** (`USER_BFF_URL`, `/me`) — session → user identity, roles and groups.
- **Core API** — only probed by `GET /check_apis`.
- **PostgreSQL** (`pg` Pool) — used directly for visibility/permission queries and collaboration.

## Commands

```bash
npm ci                     # install (needs NODE_AUTH_TOKEN, see below)
npm run dev                # tsx watch src/index.ts (alias: npm start)
npm run build              # tsc -> dist/
npm run lint               # eslint . --ext .ts (src/**/*.ts only); lint:fix to autofix
npm test                   # pretest runs `tsc --project tsconfig.test.json`, then jest
npm run mock:project-api   # standalone in-memory Project API for local dev
```

Single test: `npx jest tests/projects.test.ts` or `npx jest -t "returns a projects page payload"`.
Note `npx jest` skips the `pretest` typecheck — run `npm test` (or `tsc -p tsconfig.test.json`) to catch type errors.
CI runs tests with `--runInBand`.

`PORT` env var is **required** — `src/index.ts` exits if it is unset.

### Contracts (run after any route/schema change)

```bash
npm run contracts:generate   # export contracts/openapi.json + regenerate contracts/bff.d.ts
npm run contracts:check      # fails if either is stale (this is what CI enforces)
```

Type generation is pinned to `openapi-typescript@7.10.1` (invoked via `npm exec` in `scripts/contracts.mjs`).
`contracts:sync` is not a script in *this* repo — it's run from each associated web service's own copy of
`contracts.mjs` (pointed at this BFF's exported `openapi.json` via `BFF_CONTRACT_DIR`) to pull the contract in;
ship those branches together.

### Private dependencies

`@mairie360/*` packages come from GitHub Packages. Set `NODE_AUTH_TOKEN` (a token with `packages:read`)
in the environment; `.npmrc` references it. Never commit the value.

## Architecture

### Request pipeline (`src/app.ts`)

1. `tokenContextMiddleware` (`src/auth/token.ts`) — parses `Bearer` header into an `AsyncLocalStorage`
   store. Downstream clients read it via `getAuthorizationHeader()` and forward it unchanged; there is
   no request object threading for auth.
2. `/projects*` routes additionally get `requireBearerToken` then `projectUserContextMiddleware`
   (`src/auth/project-user.ts`) — calls BFF User `/me`, normalizes roles via `roleAliases`, falls back
   to the JWT `sub`/`user_id`/`id` claim for the user id, and stores a `ProjectUserContext` on
   `res.locals.projectUser`. Read it with `getProjectUserContext(res)`.

`/health` and `/check_apis` are unauthenticated.

### Two data-source modes — `PROJECT_DB_ACCESS`

- **default (enabled):** `src/repositories/projectRepository.ts` queries PostgreSQL directly for
  project/task visibility, assignable users, member sync, and collaboration (comments/history live in
  `tasks.custom_fields` jsonb; status history joins `task_history`).
- **`disabled`:** falls back to the Project API HTTP client and an **in-memory** collaboration store (lost
  on restart). Project API 0.4.1 publishes neither GET project, PATCH task nor any project update, so only
  the project list, deletes and collaboration work; every route that must read a project back answers
  `501 NOT_IMPLEMENTED`. Write routes call `requireDatabaseAccess(feature)` after the permission guards so the
  501 happens **before** any Project API write (no orphan project/task/member). Remove those guards from
  `create_project.ts` / `create_task.ts` once GET project is published again.

Helpers in `project_helpers.ts` (`fetchProjectBundle`, `createTaskOnApi`, `patchTaskOnApi`, …) branch
on `isProjectDatabaseAccessEnabled()`, so most routes are written once and work in both modes.

### OpenAPI is generated from the code, in two places that must stay in sync

- `src/openapi-registry.ts` — the single source of truth for all Zod schemas + the `OpenAPIRegistry`.
- Each route module calls `registry.registerPath({...})` at import time and also uses the schemas for
  runtime `safeParse` validation.
- `src/openapi.ts` imports **every route module** to populate the registry, then builds the document.
- `src/app.ts` mounts **every route module** as an Express router.

**Adding/removing a route means editing both `src/app.ts` and `src/openapi.ts`**, plus regenerating contracts.
`scripts/export-swagger.ts` writes `contracts/openapi.json` and a root `openapi.json` (the publish workflow's artifact path).

### Public ID convention

The BFF never exposes raw numeric ids. It emits strings like `project-1`, `task-1`, `user-1`
(`projectPublicId`/`taskPublicId`/`userPublicId`) and converts back with `parsePublicId()` (takes the
trailing digits). Routes validate params, then `parsePublicId`, then 400 if null.

### Vocabulary mapping (three layers)

BFF (`todo` / `in-progress` / `review` / `done`, `high|medium|low`) ↔ Project API
(`Todo`/`InProgress`/`Completed`/`Error`, `Low|Medium|High`) ↔ DB (`todo`/`in_progress`/`completed`).
All the `*Map` tables are in `project_helpers.ts` and `projectRepository.ts`. Mapping is lossy in
places (e.g. BFF `review` ↔ backend `Error`), and several project-level fields (status, priority,
progress, dueDate) are **derived from a project's tasks**, not stored.

### Permissions & roles

Roles: `Admin`, `Maire`, `Responsable`, `User`, `Guest`. `isGlobalProjectRole` = Admin/Maire (see
everything); `canManageProjects` also includes Responsable. `getProjectPermissions` /
`getTaskPermissions` compute booleans per request (SQL visibility subqueries when DB access is on);
`src/routes/Project/project_access.ts` wraps them into `require*` guards. Every response payload
embeds the resolved `permissions` / `access` block for the frontend.

### Error envelope

Always `{ error: { code, message, details: [] } }` (registered `ApiError` schema). `sendRouteError` /
`mapStatusCode` / `mapErrorCode` in `project_helpers.ts` normalize thrown/axios errors — upstream
400/401/403/404/501 are kept, 5xx and network failures become `502 BAD_GATEWAY`, always with a generic
per-status message (never the upstream body nor host/port); non-axios, non-`UpstreamApiError` errors
(e.g. PostgreSQL) are logged and become a generic 500. Every route documents its error statuses with
`...apiErrorResponses(...)` (`openapi-registry.ts`) — keep it in sync when a route gains a new error path,
the upstream-mock tests fail on any undocumented status. Upstream calls (BFF User fetch, Project API
axios) use a 5s timeout. `/check_apis` probes Core and Project `/health` independently from
`*_API_URL` + `*_API_PORT` read per request.

## Tests

Tests with contract-driven upstream mocks: the suites import the **whole app** with the real `project-user.ts`/axios and serve upstreams from
local HTTP servers (`tests/support/contract-mock-server.ts`). Contracts are rebuilt at test time from the
**installed** `@mairie360/bff-user-openapi` (devDependency, aligned with the `bff-user` image of the test
stacks), `@mairie360/project-api-openapi` and `@mairie360/core-api-openapi` packages
(`tests/support/orval-contract.ts`), so bumping a package is enough to test a new contract. Mocks reject
paths, methods, params and bodies absent from the contract and validate mocked success responses; orval
does not type errors, so mocked error replies need `outOfContract: true`. Every BFF response is checked
against `contracts/openapi.json` (status documented + schema).

- `tests/projects.upstream-mocks.test.ts` — `PROJECT_DB_ACCESS=disabled`, real repository (no SQL in that
  mode): session resolution, error mapping, Project API client helpers, `/check_apis`.
- `tests/projects.database.upstream-mocks.test.ts` — database mode with the repository `jest.mock`ed; asserts
  Project API receives **no** request.
- `tests/upstream-contracts.test.ts` — pins package versions and the consumed operations.
- `projectClient` reads `PROJECT_API_BASE_PATH` at import, so suites set it then `await import('../src/app')`;
  `USER_BFF_URL` and `*_API_URL`/`*_API_PORT` are read per request and set in `beforeEach`.
- The API-mode collaboration store is in-memory per process: use distinct project/task ids per test.
- Known contract bug in `@mairie360/project-api-openapi` 0.4.1: `DELETE .../users/{userId}//` (fixed in
  `Project_API`, where `tests/routing_test.rs` now checks the contract against actix routes); the BFF calls
  `.../users/{user_id}/`, so a test asserts the mock rejects it until the package is republished and bumped.
- `openapi-contract.ts`, `contract-mock-server.ts` and `orval-contract.ts` are shared verbatim with the other
  BFFs (`BFF_user`, `BFF_Calendar`, `BFF_Dashboard`, `BFF_Elearning`, `BFF_Message`); keep the copies identical.

## Toolchain notes

- Node **22** in CI (`contracts.yml`, `cicd.yml`); the Dockerfile builds/runs on `node:20-alpine`.
- Docker runtime command is `npx tsx dist/index.js` (not `node`) because the generated Project API
  client ships `.ts` sources that are resolved at runtime.
- ESLint uses the flat config `eslint.config.cjs` (the `.eslintrc.js` is legacy and ignored).
  `@typescript-eslint/no-explicit-any` is an **error**.
- `docker compose` (see `docker-compose.yml`) brings up redis + a pinned `project-api` image + this
  BFF with `develop.watch` sync; needs the `bff_user_backend` external network and npm build secrets.
