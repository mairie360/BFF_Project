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

`PORT` env var is **required** — `src/index.ts` exits if it is unset. `src/index.ts` starts with
`import 'dotenv/config'` and, under `require.main === module`, calls the lib's
`assertConfigured(UPSTREAM_SERVICES)`: startup fails when `USER_BFF_URL`, `PROJECT_API_URL` or
`CORE_API_URL` is missing or invalid.

### Upstream configuration

Every upstream address is `<SERVICE>_URL` (+ optional `<SERVICE>_PORT`, used only when the URL has no port)
for `USER_BFF`, `PROJECT_API`, `CORE_API`, read **on every call** through the lib's `baseUrl` (no
`localhost` default, no URL frozen at import): a missing one answers 503, declared on every `/projects*`
route. `/check_apis` probes with the same variables. `PROJECT_API_BASE_PATH` no longer exists.

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

`app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY))`, then the session-bound routers
(`/projects-page`, `/projects*`) get, in order:

1. `noStore` (`Cache-Control: no-store`) and `requireBearer` from `@mairie360/bffs-lib` — 401 before any
   upstream call without an `Authorization: Bearer <token>` header (the only credential accepted).
2. `tokenContextMiddleware` (`src/auth/token.ts`) — stores the lib-normalised `authorization(req)` in an
   `AsyncLocalStorage` store; the Project and Core clients read it via `getAuthorizationHeader()`.
3. `projectUserContextMiddleware` (`src/auth/project-user.ts`) — calls BFF User `/me`, normalizes roles via
   `roleAliases`, falls back to the lib's `unverifiedSubject` (token `sub`, only once BFF User accepted the
   token) for the user id, and stores a `ProjectUserContext` on `res.locals.projectUser`. Read it with
   `getProjectUserContext(res)`.

`/health` and `/check_apis` are unauthenticated and never forward the caller's header.

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

Always `{ error: { code, message, details } }`, the envelope shared by every BFF: the `ErrorResponse` schema is
`@mairie360/bffs-lib`'s `ErrorResponseSchema` (registered with `.clone()`, see `openapi-registry.ts`) and `code`
derives from the status (`codeForStatus`). App-level `notFoundHandler` / `errorHandler()` from the lib close
`src/app.ts`. In routes, `sendRouteError` / `handleUnknownError(res, error, ERROR_STATUSES)` (`project_helpers.ts`)
normalizes thrown errors: an upstream 4xx is kept (generic message, via the lib's `mapUpstreamError`) only when
the route's `ERROR_STATUSES` declares it, any other upstream status (5xx, 501, undeclared 4xx) and network
failures become `502 BAD_GATEWAY`, never with the upstream body nor host/port; an `HttpError` keeps its status
and message unless it is an undeclared 4xx (then 502); anything else is logged and becomes a generic 500.
`sendValidationError(res, 'body' | 'params' | 'query', issues)` answers 400 with `details: [{ path, message }]`
(`path` like `body.title`). Every route defines one `ERROR_STATUSES` list and passes it to both
`apiErrorResponses(...)` (`openapi-registry.ts`) and `handleUnknownError`, so the contract and the runtime
cannot drift; the upstream-mock tests fail on any undocumented status. Upstream calls (BFF User fetch, Project API
axios) use a 5s timeout. `/check_apis` probes Core and Project `/health` independently from
`<SERVICE>_URL` + `<SERVICE>_PORT` read per request, like the real calls.

### ZAP / k6 OpenAPI coverage gate

`security_test.sh` / `performance_test.sh` clone `mairie360/CICD` into `cicd-repo/` (gitignored) at
the pinned `cicd_version` (`CICD_VERSION=<branch>` overrides it). ZAP runs its `zap_hooks.py` with
`--hook`: every operation of the served spec must be reached, and non-public ones with a
non-401/403 answer. The spec requires `bearerAuth` at the top level (`openapi.ts`); `/health` and
`/check_apis` set `security: []` in `registerPath`. `load-test.js` builds on `coverage.js` with **one
handler per operation** of `contracts/openapi.json`: a new route without a handler makes k6 abort at
init. Two scenarios: `crud` (2 VUs) runs every handler through `coverage.run()` and carries the gate;
`reads` (ramp to 20 VUs) replays the GET handlers only, so GET handlers read seeded fixtures
(`project-1`, `task-1`), never `state`. Writes use the admin token (sub=1). In `crud`, handlers run
path by path in contract order and, per path, get → put → post → delete → patch, so
`PATCH .../close` runs before `POST /projects`: `prepare()` creates the working project (its tasks
come back in the top-level `taskItems`), POST handlers create the disposable resources the DELETE
handlers remove, and `cleanup()` deletes the working project and its duplicate. Every operation
gets a `p(95)` threshold from its family (`budgetOf`).

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
- `USER_BFF_URL`, `PROJECT_API_URL`/`_PORT` and `CORE_API_URL`/`_PORT` are read per request and set in `beforeEach`;
  deleting one in a test checks the 503 path.
- Jest's coverage threshold is 60 % on branches, functions, lines and statements.

## Pull request reviewers

Every PR requests a review from the whole team, minus its author: `CarolinHugo`, `LAURETbenjamin`, `MathTek` and `Quentintnrl` (`gh pr create … --reviewer CarolinHugo,LAURETbenjamin,MathTek`). `.github/CODEOWNERS` makes GitHub request them automatically as well.
