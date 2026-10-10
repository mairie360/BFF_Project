# BFF_Project — Technical documentation

[Module overview](module.md) · [Français](../fr/technical.md) · [README](../../README.md)

## Architecture and request handling

Express 5.2.1 server written in TypeScript. Zod schemas and their OpenAPI registry describe exchanged objects; routers adapt upstream services to interface needs.

`src/app.ts` (the Express app, imported by the tests) installs the shared security headers of `@mairie360/bffs-lib` (`securityHeaders`, `apiOnlyHeaders()`), then, on the session-bound routers, `noStore`, `requireSession` and the user context obtained from BFF User; `src/index.ts` loads `.env`, checks the configuration and listens (`PORT`, 4001 by default). Project routers use normalization helpers and the generated Project API and Core API clients through `src/services/projectData.ts`: every upstream call gets its options from the lib (`asCaller(service, req)`, `withoutSession(service)` for the probes), which forwards the caller's `Authorization` header explicitly, and goes through `callUpstream`. Every upstream address is read on every call from `<SERVICE>_URL` (+ optional `<SERVICE>_PORT`) through the shared lib's `baseUrl`; there is no `localhost` default.

## Data and persistence

The BFF owns no database. Visibility, membership, projects, tasks and collaboration (comments and history) are read from and written to Project API 1.0.0 through its OpenAPI contract, and the assignable-user directory comes from Core API (`GET /api/v1/user/`). Project API computes visibility itself: a project the caller may not see answers 404. Its lists are paginated (100 items by default): the BFF asks for pages of 500 and reads every page until the `total` Project API returns (projects, project tasks and members, task comments and history). Project API records the task history itself, so the BFF never writes it.

Public identifiers and statuses are normalized by helpers, while some project fields are derived from tasks.

## Installation and local startup

Use Node.js 24 to reproduce the CI jobs and npm with the committed lockfile. Other job and Docker versions are detailed below.

Private `@mairie360/*` dependencies require GitHub Packages access. Set `NODE_AUTH_TOKEN` in the environment to a token allowed to read these packages, as configured in `.npmrc`. Do not commit its value.

```bash
npm ci
```

Create `.env` in the repository root. Local HTTP configuration example to adapt to the running services:

```dotenv
PORT=4001
USER_BFF_URL=http://localhost:4000
PROJECT_API_URL=http://localhost:3001
CORE_API_URL=localhost
CORE_API_PORT=3000
```

No database variable is needed: the BFF only talks to BFF User, Project API and Core API. `.env` is loaded by `import 'dotenv/config'`, the first line of `src/index.ts`. The server refuses to start when `USER_BFF_URL`, `PROJECT_API_URL` or `CORE_API_URL` is missing or invalid, naming every faulty variable.

```bash
npm run start
```

`PORT` defaults to `4001`, the documented port of this BFF.

Check the process, then open the interactive documentation:

```bash
curl --fail --silent --show-error http://localhost:4001/health
```

Swagger UI: `http://localhost:4001/docs`. JSON specification: `/openapi.json`, with `/swagger.json` as an alias. `/health` checks the process; `/check_apis` is a separate dependency diagnostic.

## Configuration

Values below are local examples or explicitly described behavior, not production credentials.

| Variable or precedence | Example / stated fallback | Purpose |
| --- | --- | --- |
| `PORT` | 4001 (default) | Listening port. |
| `TRUST_PROXY` | unset (no proxy trusted) | Express `trust proxy` setting (`true`, a hop count or comma-separated addresses/subnets), so that `req.ip` is the real client behind the ingress. |
| `USER_BFF_URL` / `USER_BFF_PORT` | http://localhost:4000 / — | Session service, `/me` route and `/check_apis` probe. Required. |
| `PROJECT_API_URL` / `PROJECT_API_PORT` | http://localhost:3001 / — | Project API, for the calls and the `/check_apis` probe. Required. |
| `CORE_API_URL` / `CORE_API_PORT` | localhost / 3000 | Core API (directory and `/check_apis` probe). Required. |

Each `<SERVICE>_URL` is a host or a URL (scheme optional, `http` by default); `<SERVICE>_PORT` only applies when the URL carries no port (`http://project-api:3001`, as the Helm chart sets it, keeps 3001). These variables are required: startup fails without them, and a request that would reach an unconfigured service answers 503. `PROJECT_API_BASE_PATH` no longer exists: use `PROJECT_API_URL`.

## Routes and data contract

Inventory extracted from `contracts/openapi.json`. Replace brace parameters with real identifiers. Detailed types, required fields, responses and any examples are defined in that contract; table statuses are the declared statuses, not an exhaustive list of transport or validation errors.

| Method | Path | Declared body | Declared statuses |
| --- | --- | --- | --- |
| GET | `/health` | — | 200 |
| GET | `/check_apis` | — | 200, 502 |
| PATCH | `/projects/{projectId}/close` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| POST | `/projects` | application/json | 201, 400, 401, 403, 500, 502, 503 |
| POST | `/projects/{projectId}/tasks` | application/json | 201, 400, 401, 403, 404, 500, 502, 503 |
| DELETE | `/projects/{projectId}` | — | 204, 400, 401, 403, 404, 500, 502, 503 |
| PATCH | `/projects/{projectId}` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| GET | `/projects/{projectId}` | — | 200, 400, 401, 404, 500, 502, 503 |
| GET | `/projects/{projectId}/archived-tasks` | `page`, `limit` | 200, 400, 401, 404, 500, 502, 503 |
| DELETE | `/projects/{projectId}/tasks/{taskId}` | — | 204, 400, 401, 403, 404, 500, 502, 503 |
| PATCH | `/projects/{projectId}/tasks/{taskId}` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| POST | `/projects/{projectId}/duplicate` | — | 201, 400, 401, 403, 404, 500, 502, 503 |
| PATCH | `/projects/{projectId}/tasks/{taskId}/status` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| GET | `/projects-page` | — | 200, 400, 401, 500, 502, 503 |
| GET | `/projects/{projectId}/tasks/{taskId}/collaboration` | — | 200, 400, 401, 403, 404, 500, 502, 503 |
| POST | `/projects/{projectId}/tasks/{taskId}/comments` | application/json | 201, 400, 401, 403, 404, 500, 502, 503 |

## Session, permissions and errors

`/projects-page` and `/projects` require an `Authorization: Bearer <token>` header (the only credential accepted: cookies, `x-session-token` and other schemes are ignored; the fronts' proxy turns the `accessToken` cookie into this header) and a valid user context. Without a Bearer token, or with one `JWT_SECRET` does not verify (HS256 signature, expiry, positive `sub`; `requireSession` of the lib, MAIR-474), they answer 401 before any upstream call, and every answer carries `Cache-Control: no-store`. The caller's header, normalised to `Bearer <token>`, is forwarded to BFF User, Project API and Core API; `/health` and `/check_apis` never forward it. The caller id is the `sub` of the verified token; BFF User `/me` gives the roles and groups and checks that the session was not revoked. Recognized roles are `Admin`, `Maire`, `Responsable`, `User`, `Guest`; visibility and changes use server rules and returned permissions. Calls to BFF User, Project API and Core API have a 5-second timeout; idempotent Project API and Core API reads (`GET`) are retried once on no answer, 502, 503 or 504, writes never.

Errors use the envelope shared by every BFF, `ErrorResponse` from `@mairie360/bffs-lib` (`{ error: { code, message, details } }`, `code` derived from the status: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INTERNAL_ERROR`, `BAD_GATEWAY`...). Validation failures answer 400 `Validation failed` (the lib's `parseRequest` / `validationError`) with one `details` entry per invalid value, `{ path, message }`, where `path` starts with `body.`, `params.` or `query.`. 401 for a missing or rejected session, 502 when BFF User, Project API or Core API is unreachable or answers 5xx, 503 when one of their URLs is not configured. An upstream 4xx is kept, with a generic message, only when the route declares that status; any other upstream status (including 501) becomes 502. Neither the upstream body nor network details are returned, and an unexpected error becomes a logged generic 500. Unknown routes answer a JSON 404 and a malformed JSON body a 400 in the same envelope instead of the Express HTML page. Bodies are validated before any upstream call: `<` and `>` are refused in titles, descriptions, labels and comments, and people are referenced by a public id (`user-<id>`; an empty `responsibleId` means nobody); `/projects-page` refuses a `dueBefore`/`dueAfter` that is not a date. `/check_apis` (the lib's `checkApis`) probes the `/health` of Core API, Project API and BFF User independently, without a session and with the same `<SERVICE>_URL` + `<SERVICE>_PORT` as the real calls (read per request; an unconfigured upstream is `Unreachable`). It answers `{ status, core_api, project_api, user_bff }` (`CheckApisResponse`), 200 when every upstream is `Connected`, 502 otherwise.

Public ids are parsed with their own prefix only: `project-<id>`, `task-<id>` and `user-<id>`. Any other value (`user-5` as a project, `abc12`, `project-5x`) answers 400.

## Writes, membership and persisted data

- `PATCH /projects/{projectId}` is partial. The members are rewritten only when `assigneeIds` is sent, from the merged state: `responsibleId` when sent, otherwise the current responsible (the first member), plus `assigneeIds`. A `responsibleId` sent alone only adds that member and removes nobody. Without either field, the members are not touched.
- Project API stores only the name, the description, the status and the members of a project. `priority`, `labels` and `dueDate` are accepted by `POST /projects` and `PATCH /projects/{projectId}` but not persisted: every write answers the state re-read from Project API, where priority, progress and due date are derived from the tasks and `labels` is empty. The project status is persisted through the Project API mapping (`todo`/`in-progress` → Active, `review` → Suspended, `done` → Completed), so `todo` comes back as `in-progress`.
- `createdAt` (projects and tasks) is still required by the contract but Project API does not expose it: the BFF fills it with the response time. Task responses no longer carry the invented `updatedAt` (optional in the contract).
- Project API has no atomic creation. `POST /projects` and `POST /projects/{projectId}/duplicate` create the project, then its members, status and tasks one call at a time; when one of those steps fails, the BFF deletes the created project (best effort, logged when the delete fails too) before answering the error, so a retry does not leave a partial duplicate behind.
- A completed task is archived (MAIR-502): `GET /projects/{projectId}` only lists the active tasks, its progress and task counts include the archived ones, and `GET /projects/{projectId}/archived-tasks` pages them (most recently archived first). Duplicating a project copies its active tasks only. `GET /projects/{projectId}/tasks/{taskId}/collaboration` is paged (`page`, `limit` 1-100, 50 by default): the most recent comments (in reading order) and history entries, with `pagination.commentsTotal` / `historyTotal`.
- Each project access guard reads the project bundle once and hands it to the route; a write then re-reads it once to answer. A task guard (collaboration, comment, task update, status, deletion) reads the task alone through `GET /api/v1/projects/{id}/tasks/{taskId}/`, and a task write answers from the task and the project members, never from every task of the project (MAIR-474). `/projects-page` is one Project API call (MAIR-474): `GET /api/v1/projects/` filters (search, status, priority, due dates), pages, aggregates the tasks of each project (count, completed, highest priority, earliest due date) and counts every match per status and priority; no bundle is read. Its Kanban columns count every matching project but list the ids of the current page only, and each project lists its first 5 members (the detail lists them all).

## Synchronization and verification

```bash
npm run contracts:generate
npm run contracts:check
npm test -- --runInBand
npm run lint
npm run build
```

`contracts:generate` exports the runtime registry to `contracts/openapi.json` and regenerates `contracts/bff.d.ts`. `contracts:check` fails when the contract or types are stale. Then run `npm run contracts:sync` in each associated web service and deliver contract changes together.

The type generator is pinned to `openapi-typescript@7.10.1` in `scripts/contracts.mjs` and runs through npm. For documentation-only changes, check links, accuracy in both languages and `git diff --check`; do not regenerate contracts without changing their source.

## CI/CD and Docker execution

The `contracts.yml` job uses Node.js 24, `actions/checkout@v7` and `actions/setup-node@v7`. It runs on pushes, pull requests and manual dispatch; it installs with `npm ci`, checks contracts and runs the associated tests.

`cicd.yml` calls `mairie360/CICD/.github/workflows/BFFs-cicd.yml@v3.2.0`, with `cicd_version: v3.2.0` and `node_version: "24"`. Reusable steps and GitHub environments determine actual checks, publications and deployments.

`Dockerfile` and `development.Dockerfile` use `node:24-alpine` pinned by digest, the same Node.js version as the CI jobs; the production image runs `["node", "dist/index.js"]` (esbuild bundle).

`security_test.sh` and `performance_test.sh` test the image named by `IMAGE_REF`: in CI, the image `release-dev` has just published, the same artifact that is then promoted to staging and prod. When `IMAGE_REF` is empty (local use), they first build `bff-project:local` from `development.Dockerfile`, which needs `NODE_AUTH_TOKEN` and `./.npmrc`.

`security_test.sh` runs the OWASP ZAP stack of `docker-compose-security.yml`: ZAP replays every operation of `/openapi.json` with a static admin JWT (`sub=1`, HS256, `JWT_SECRET=b"secret"`) and fills bodies and path parameters from the contract examples. `init-test.sql` seeds the resources those examples name (users 1 and 2, `project-1` with `task-1`, and `project-2` / `task-2` for the DELETE routes); keep examples and seed in sync when adding a route.

The ZAP stack carries the OpenAPI coverage gate of `mairie360/CICD` (`tests/zap/zap_hooks.py`), checked out as `cicd-repo/` by the CI job and cloned there by `security_test.sh` / `performance_test.sh` at the pinned `cicd_version` (`CICD_VERSION` overrides it). After the scan, the hook fails when an operation of the contract was never reached, or when an operation that requires `bearerAuth` only got 401/403; public operations (`/health`, `/check_apis`) declare `security: []` in their `registerPath`. A new public route needs `security: []`; a new authenticated one needs the seed its examples point to.

The k6 stack carries the same gate through `tests/k6/coverage.js`: `load-test.js` holds one handler per operation of `contracts/openapi.json`, k6 aborts at init when one is missing and fails its `operations_uncovered` threshold when a handler does not send its request. **Adding a route means adding its handler in `load-test.js`.** Two scenarios run: `crud` (2 VUs) calls every handler once per iteration, writes included (as the seeded admin), on a project it creates and deletes; `reads` (ramp to 20 VUs) replays only the GET handlers against `project-1` / `task-1`. Every operation has a `p(95)` threshold set by its family: 50 ms for `/health`, 300 ms for `/check_apis`, 500 ms for reads, 800 ms for writes; `http_req_failed` must stay below 1 %.

Before running Docker, check service variables, build secrets and networks in the repository files. Green CI validates its jobs; it does not prove business-service availability in a remote environment.

## Troubleshooting

If user context fails, check BFF User before Project API. If views disagree, check permissions and identifiers. `npm run mock:project-api` supplies a local development server; it does not replace real data. The `pretest` script checks types using `tsconfig.test.json` before Jest.

`tests/projects.upstream-mocks.test.ts` tests the whole app against real HTTP servers simulating BFF User, Project API and Core API. Their contracts are rebuilt from the installed `@mairie360/bff-user-openapi` (devDependency aligned with the test stacks' `bff-user` image), `@mairie360/project-api-openapi` and `@mairie360/core-api-openapi` packages: the mocks reject paths, parameters and bodies missing from the upstream contract, and every BFF response is validated against `contracts/openapi.json`. `tests/upstream-contracts.test.ts` pins the versions and consumed operations.

## Repository reference

- [src/app.ts](../../src/app.ts)
- [src/auth/project-user.ts](../../src/auth/project-user.ts)
- [src/routes/Project/project_helpers.ts](../../src/routes/Project/project_helpers.ts)
- [src/routes/Project/project_access.ts](../../src/routes/Project/project_access.ts)
- [src/services/projectData.ts](../../src/services/projectData.ts)
- [src/clients/projectClient.ts](../../src/clients/projectClient.ts)
- [scripts/mock-project-api.ts](../../scripts/mock-project-api.ts)
- [tsconfig.test.json](../../tsconfig.test.json)
- [contracts/openapi.json](../../contracts/openapi.json)
- [contracts/bff.d.ts](../../contracts/bff.d.ts)
- [scripts/contracts.mjs](../../scripts/contracts.mjs)
- [package.json](../../package.json)
- [.github/workflows/contracts.yml](../../.github/workflows/contracts.yml)
- [.github/workflows/cicd.yml](../../.github/workflows/cicd.yml)
- [Dockerfile](../../Dockerfile)
- [docker-compose.yml](../../docker-compose.yml)

Historical supplements: [CONTRACT.md](../../CONTRACT.md). Proposed requirements must remain distinct from implemented behavior.
