# BFF_Project — Technical documentation

[Module overview](module.md) · [Français](../fr/technical.md) · [README](../../README.md)

Documentation of the versioned code as of 7 September 2026, based on `d7dd4cb30e26`. Commands below describe checks to run; they do not certify a remote deployment.

## Architecture and request handling

Express 5.2.1 server written in TypeScript. Zod schemas and their OpenAPI registry describe exchanged objects; routers adapt upstream services to interface needs.

`src/app.ts` installs the token context and then the user context obtained from BFF User. Project routers use normalization helpers, the Project client and the SQL repository. The HTTP client forwards request authorization; `PROJECT_API_BASE_PATH` takes precedence over separate host and port settings.

## Data and persistence

The module combines Project API and PostgreSQL. The SQL repository handles visibility, membership, projects, tasks and collaboration. Comments and some history use `tasks.custom_fields`; status history can come from `task_history`. With `PROJECT_DB_ACCESS=disabled`, collaboration uses an in-memory fallback lost on restart.

Disabling SQL access changes capabilities and persistence; that mode does not validate a full deployment. Public identifiers and statuses are normalized by helpers, while some project fields are derived from tasks.

## Installation and local startup

Use Node.js 22 to reproduce the contract job and npm with the committed lockfile. Other job and Docker versions are detailed below.

Private `@mairie360/*` dependencies require GitHub Packages access. Set `NODE_AUTH_TOKEN` in the environment to a token allowed to read these packages, as configured in `.npmrc`. Do not commit its value.

```bash
npm ci
```

Create `.env` in the repository root. Local HTTP configuration example to adapt to the running services:

```dotenv
PORT=4001
USER_BFF_URL=http://localhost:4000
PROJECT_API_BASE_PATH=http://localhost:3001
PROJECT_API_URL=localhost
PROJECT_API_PORT=3001
CORE_API_URL=localhost
CORE_API_PORT=3000
```

Also set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` for an existing database containing the tables expected by the SQL repositories. These variables and any secrets listed below still need to be supplied; the HTTP example prepares neither schema nor data.

```bash
npm run start
```

`PORT` is required by this BFF; this example uses `4001`.

Check the process, then open the interactive documentation:

```bash
curl --fail --silent --show-error http://localhost:4001/health
```

Swagger UI: `http://localhost:4001/docs`. JSON specification: `/openapi.json`, with `/swagger.json` as an alias. `/health` checks the process; `/check_apis` is a separate dependency diagnostic.

## Configuration

Values below are local examples or explicitly described behavior, not production credentials.

| Variable or precedence | Example / stated fallback | Purpose |
| --- | --- | --- |
| `PORT` | 4001 | Port used by this local example. |
| `USER_BFF_URL` | http://localhost:4000 | Session service, `/me` route. |
| `PROJECT_API_BASE_PATH` | http://localhost:3001 | Explicit base address takes precedence; `/api/v1/...` paths come from the client. |
| `PROJECT_API_URL` / `PROJECT_API_PORT` | localhost / 3001 | Alternative address and diagnostic settings. |
| `CORE_API_URL` / `CORE_API_PORT` | localhost / 3000 | Core client and diagnostic configuration. |
| `PROJECT_DB_ACCESS` | enabled | Only `disabled` disables SQL access. |
| `DB_HOST` / `DB_PORT` | localhost / 5432 | SQL repository PostgreSQL connection. |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | — | Database, account and secret to supply for the expected shared schema. |

## Routes and data contract

Inventory extracted from `contracts/openapi.json`. Replace brace parameters with real identifiers. Detailed types, required fields, responses and any examples are defined in that contract; table statuses are the declared statuses, not an exhaustive list of transport or validation errors.

| Method | Path | Declared body | Declared statuses |
| --- | --- | --- | --- |
| GET | `/health` | — | 200 |
| GET | `/check_apis` | — | 200, 502 |
| PATCH | `/projects/{projectId}/close` | application/json | 200, 403 |
| POST | `/projects` | application/json | 201, 400 |
| POST | `/projects/{projectId}/tasks` | application/json | 201, 400, 404 |
| DELETE | `/projects/{projectId}` | — | 204, 404 |
| PATCH | `/projects/{projectId}` | application/json | 200, 400, 404 |
| GET | `/projects/{projectId}` | — | 200, 404 |
| DELETE | `/projects/{projectId}/tasks/{taskId}` | — | 204, 404 |
| PATCH | `/projects/{projectId}/tasks/{taskId}` | application/json | 200, 400, 404 |
| POST | `/projects/{projectId}/duplicate` | — | 201, 404 |
| PATCH | `/projects/{projectId}/tasks/{taskId}/status` | application/json | 200, 400, 404 |
| GET | `/projects-page` | — | 200, 500 |
| GET | `/projects/{projectId}/tasks/{taskId}/collaboration` | — | 200, 403 |
| POST | `/projects/{projectId}/tasks/{taskId}/comments` | application/json | 201, 403 |

## Session, permissions and errors

`/projects-page` and `/projects` require a Bearer token and a valid user context. Recognized roles are `Admin`, `Maire`, `Responsable`, `User`, `Guest`; visibility and changes use server rules and returned permissions. User-context calls and the Project client have a 5-second timeout.

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

The `contracts.yml` job uses Node.js 22, `actions/checkout@v7` and `actions/setup-node@v7`. It runs on pushes, pull requests and manual dispatch; it installs with `npm ci`, checks contracts and runs the associated tests.

`cicd.yml` calls `mairie360/CICD/.github/workflows/BFFs-cicd.yml@v1.13.2`, with `cicd_version: v1.13.2` and `node_version: "22"`. Reusable steps and GitHub environments determine actual checks, publications and deployments.

The Dockerfile currently uses `node:20-alpine` for build and runtime; the image command is `["npx", "tsx", "dist/index.js"]`. That version is separate from the Node.js 22 contract job.

Before running Docker, check service variables, build secrets and networks in the repository files. Green CI validates its jobs; it does not prove business-service availability in a remote environment.

## Troubleshooting

If user context fails, check BFF User before Project API. If views disagree, check permissions, identifiers and `PROJECT_DB_ACCESS`. `npm run mock:project-api` supplies a local development server; it does not replace real data. The `pretest` script checks types using `tsconfig.test.json` before Jest.

## Repository reference

- [src/app.ts](../../src/app.ts)
- [src/auth/token.ts](../../src/auth/token.ts)
- [src/auth/project-user.ts](../../src/auth/project-user.ts)
- [src/routes/Project/project_helpers.ts](../../src/routes/Project/project_helpers.ts)
- [src/routes/Project/project_access.ts](../../src/routes/Project/project_access.ts)
- [src/repositories/projectRepository.ts](../../src/repositories/projectRepository.ts)
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
