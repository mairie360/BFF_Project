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

Single test: `npx jest tests/projects.upstream-mocks.test.ts` or `npx jest -t "never retries a write"`.
Note `npx jest` skips the `pretest` typecheck — run `npm test` (or `tsc -p tsconfig.test.json`) to catch type errors.
CI runs tests with `--runInBand`.

`PORT` defaults to `4001`. `src/app.ts` exports the Express app (the tests import it); `src/index.ts` starts with
`import 'dotenv/config'` and, under `require.main === module`, calls the lib's
`assertConfigured(UPSTREAM_SERVICES)` then `listen`: startup fails when `USER_BFF_URL`, `PROJECT_API_URL` or
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

`app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY))`, the lib's `securityHeaders` and
`apiOnlyHeaders()` (strict `default-src 'none'` everywhere but `/docs`), then the session-bound routers
(`/projects-page`, `/projects*`) get, in order:

1. `noStore` (`Cache-Control: no-store`) and `requireSession` from `@mairie360/bffs-lib` (>= 1.2.0, MAIR-474) —
   401 before any upstream call without an `Authorization: Bearer <token>` header (the only credential accepted)
   verified with `JWT_SECRET` (HS256, `exp`, positive `sub`); `src/index.ts` refuses to start without it.
2. `projectUserContextMiddleware` (`src/auth/project-user.ts`) — calls BFF User `/me` through
   `callUpstream('USER_BFF', …, { declared: [401] })`, normalizes roles via `roleAliases`, takes the user id from the
   verified token (`sessionUserId`, never from an answer), and stores a
   `ProjectUserContext` on `res.locals.projectUser`. Read it with `getProjectUserContext(res)`.

There is no request-scoped storage: every upstream call receives the request explicitly. Routes build a
`Caller` with `callerOf(req, ERROR_STATUSES)` (`src/services/projectData.ts`) and pass it down; each call gets
its axios options from the lib's `asCaller(service, req)` (base URL, 5s timeout, caller's `Authorization`).

`/health` and `/check_apis` are unauthenticated and never forward the caller's header.

### Everything goes through the APIs

`src/services/projectData.ts` is the only data layer:

- `projectCall(caller, (options) => projectApi.op(..., options), retry?)` wraps every Project API call in the
  lib's `callUpstream('PROJECT_API', …)`; `retry` is set on idempotent GETs only. The `*OnApi` writers of
  `project_helpers.ts` use it too.
- `getProjectBundle(caller, projectId)` → `GET /api/v1/projects/{id}/` (project + tasks + members); Project API
  computes visibility, so a project the caller may not see gives a 404, which the service maps to `null`.
- Project API lists are paginated (`limit`/`offset`, 100 by default, 500 max, with a `total`): `readAllPages`
  asks for pages of 500 and reads until every total is reached, so callers always get complete lists. The bundle
  pages its tasks and, past the 100 embedded members, reads them from `GET …/users/` (`listProjectUsers`).
- `listProjectsPage(caller, params)` → `GET /api/v1/projects/` once per `/projects-page` (MAIR-474): Project API
  filters (`search`, `status`, `priority`, `due_before`, `due_after`), pages, aggregates the tasks of each project and
  counts every match per status and priority (`summary`). The BFF maps its statuses (`todo` ↔ `Error`,
  `in-progress` ↔ `Active`, `review` ↔ `Suspended`, `done` ↔ `Completed`) and priorities (`high` covers `Urgent`,
  stored `High`); the Kanban columns count every match but list the ids of the page only.
- `updateProjectRecord`, `setProjectClosed`, `getTaskCollaboration`,
  `addTaskComment` → the matching Project API operations. Project API writes the task history itself (database
  trigger, MAIR-393): the BFF never writes it.
- `listAssignableUsers(caller, user)` → Core API `GET /api/v1/user/` restricted to the caller's groups.
- `getProjectTask(caller, projectId, taskId)` → `GET /api/v1/projects/{id}/tasks/{taskId}/` (MAIR-474): the task
  guards (`project_access.ts`: view, management, status update, comment) read the task alone, never the bundle
  with every task of the project, and the task writes answer from `getTaskWithMembers` (the task + the members
  that name its assignee, in parallel). The project guards still read the bundle.
- `getProjectPermissions(user, visible)` / `getTaskPermissions(user, assignedUserId)` are pure: they derive the
  rights from the role and the bundle or task already read by the guards.

Project API `dev-5f825ca` (`@mairie360/project-api-openapi` `0.0.0-dev-5f825ca`) is the minimum: the aggregated, filtered projects list and the single task read (MAIR-474), and the archived tasks (MAIR-502, Database `dev-99f6127`).

### OpenAPI is generated from the code, in two places that must stay in sync

- `src/openapi-registry.ts` — the single source of truth for all Zod schemas + the `OpenAPIRegistry`.
- Each route module calls `registry.registerPath({...})` at import time and also uses the schemas for
  runtime validation through the lib's `parseRequest(schema, value, 'body' | 'params' | 'query')`.
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
`src/app.ts`, and routes never write errors themselves: they **throw** (Express 5 forwards async rejections).

- Validation: `parseRequest` throws 400 `Validation failed` with `details: [{ path, message }]` (`path` like
  `body.title`); `requireProjectIdParam` / `requireTaskParams` (`project_helpers.ts`) throw the same 400 via
  `validationError('params', …)` for ids without their prefix.
- Guards (`project_access.ts`) throw 403/404 `HttpError`s.
- Upstream failures: `callUpstream` relays an upstream 4xx (generic message) only when the route's
  `ERROR_STATUSES` (passed to `callerOf`) declares it; any other status, network failures and unparsable
  answers become `502 BAD_GATEWAY`, never with the upstream body nor host/port; a missing `<SERVICE>_URL` is a
  503; anything unexpected is logged by `errorHandler` and becomes a generic 500.

Every route defines one `ERROR_STATUSES` list and passes it to both `apiErrorResponses(...)`
(`openapi-registry.ts`) and `callerOf`, so the contract and the runtime cannot drift; the upstream-mock tests
fail on any undocumented status. `/check_apis` is the lib's `checkApis` with one probe per upstream
(`core_api`, `project_api`, `user_bff`: their `/health` with `withoutSession(service, 5_000)`, so no session is
forwarded) and the `CheckApisResponse` schema from `checkApisResponseSchema`.

### ZAP / k6 OpenAPI coverage gate

`security_test.sh` / `performance_test.sh` clone `mairie360/CICD` into `cicd-repo/` (gitignored) at
the pinned `cicd_version` (`CICD_VERSION=<branch>` overrides it). ZAP runs its `zap_hooks.py` with
`--hook`: every operation of the served spec must be reached, and non-public ones with a
non-401/403 answer. The spec requires `bearerAuth` at the top level (`openapi.ts`); `/health` and
`/check_apis` set `security: []` in `registerPath`. `load-test.js` builds on `coverage.js` with **one
handler per operation** of `contracts/openapi.json`: a new route without a handler makes k6 abort at
init. Three scenarios: `crud` runs every handler through `coverage.run()` and carries the gate;
`reads` replays the GET handlers only, so GET handlers read seeded rows, never `state`; `page_rush` sends
`GET /projects-page` at a fixed arrival rate. Writes use the admin token (sub=1). MAIR-474: the perf
stack's seeder also runs `init-perf.sql` (Project_API's volume seed: 5 000 projects, 50 000 tasks, agents
`100001`-`102000`, Responsables `103001`-`103100` in 100 teams, hot project `project-12` with 2 000 tasks,
`task-87` with 1 000 comments and history entries); the reads run as the Admin, a seeded Responsable or
agent (tokens signed in k6), and every read checks that it got the seeded rows. Thresholds are strict:
`checks == 100%`, `http_req_failed == 0`, `dropped_iterations == 0`. `K6_PROFILE` (passed by the compose
file) sizes the load: `ci` (default, 30 readers, rush at 30/s) for the 4 vCPU CI runner, `stress` (100
readers, 100/s) by hand. Both scripts source `stack_secrets.sh` (a random `JWT_SECRET` per run, `ADMIN_JWT`
for the ZAP replacer), drop the volumes before and after a run, and `performance_test.sh` pins the stack
to `min(PERF_CPUS, nproc)` CPUs (4 by default). `.zap/rules.tsv` no longer ignores `100000` (server
errors). In `crud`, handlers run
path by path in contract order and, per path, get → put → post → delete → patch, so
`PATCH .../close` runs before `POST /projects`: `prepare()` creates the working project (its tasks
come back in the top-level `taskItems`), POST handlers create the disposable resources the DELETE
handlers remove, and `cleanup()` deletes the working project and its duplicate. Every operation
gets a `p(95)` threshold from its family (`budgetOf`).

## Tests

Tests with contract-driven upstream mocks: the suites import the **whole app** (`src/app.ts`) with the real `project-user.ts`/axios and serve upstreams from
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
- `tests/token-refusals.test.ts` — walks `contracts/openapi.json`: every operation that inherits `bearerAuth` answers
  401 to a missing or forged token (other scheme, garbage, other secret, expired, `alg: none`, swapped payload,
  RS256, non-numeric `sub`) without any upstream call, and gets past the check with a genuine one. The tests sign
  their tokens (`bearer(sub)`, `tests/support/project-fixtures.ts`) with the secret `tests/support/env.ts` sets.
- `USER_BFF_URL`, `PROJECT_API_URL`/`_PORT` and `CORE_API_URL`/`_PORT` are read per request and set in `beforeEach`;
  deleting one in a test checks the 503 path.
- Jest's coverage threshold is 60 % on branches, functions, lines and statements.

## Pull request reviewers

Every PR requests a review from the whole team, minus its author: `CarolinHugo`, `LAURETbenjamin`, `MathTek` and `Quentintnrl` (`gh pr create … --reviewer CarolinHugo,LAURETbenjamin,MathTek`). `.github/CODEOWNERS` makes GitHub request them automatically as well.
