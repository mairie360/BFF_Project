# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Backend-For-Frontend (Express 5 + TypeScript) that sits between the `Projects_Web_Service`
frontend and upstream services. It composes/normalizes data so the frontend can render list,
grid and Kanban views, and enforces per-session permissions. Upstreams:

- **Project API** (Rust) — via the generated client `@mairie360/project-api-openapi`.
- **BFF User** (`USER_BFF_URL`, `/me`) — session → user identity, roles and groups.
- **Core API** — the directory of assignable people (`listDirectoryUsers`), and `GET /check_apis`.
- **No database.** The BFF holds no `pg` pool: visibility, membership, tasks and collaboration all come
  from Project API. `src/services/projectData.ts` is the single place that talks to the two APIs.

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

### Everything goes through the APIs

`src/services/projectData.ts` is the only data layer:

- `getProjectBundle(projectId)` → `GET /api/v1/projects/{id}/` (project + tasks + members); Project API
  computes visibility, so a project the caller may not see gives a 404, which the service maps to `null`.
- `listVisibleProjects()`, `updateProjectRecord`, `setProjectClosed`, `getTaskCollaboration`,
  `addTaskComment`, `appendTaskHistory` → the matching Project API operations.
- `listAssignableUsers(user)` → Core API `GET /api/v1/user/` restricted to the caller's groups.
- `getProjectPermissions` / `getTaskPermissions` derive the rights from the role plus what Project API
  exposes; pass `visible`/`assignedUserId` when a bundle has already been read to avoid re-reading it.

Project API **0.5.0** is the minimum: it is the release that publishes GET project, PATCH project,
PATCH task and the collaboration routes the BFF needs.

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
All the `*Map` tables are in `project_helpers.ts`. Mapping is lossy in
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
are logged and become a generic 500. Every route documents its error statuses with
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

- `tests/projects.upstream-mocks.test.ts` — the whole app against Project API, Core API and BFF User
  mocks: session resolution, reads, writes, permissions, error mapping, `/check_apis`.
- `tests/upstream-contracts.test.ts` — pins package versions and the consumed operations.
- `projectClient` reads `PROJECT_API_BASE_PATH` at import, so the suite sets it then `await import('../src/app')`;
  `USER_BFF_URL` and `*_API_URL`/`*_API_PORT` are read per request and set in `beforeEach`.
- Jest's coverage threshold is 60 % on branches, functions, lines and statements.

## Pull request reviewers

Every PR requests a review from the whole team, minus its author: `CarolinHugo`, `LAURETbenjamin`, `MathTek` and `Quentintnrl` (`gh pr create … --reviewer CarolinHugo,LAURETbenjamin,MathTek`). `.github/CODEOWNERS` makes GitHub request them automatically as well.
