# BFF_Project

Prepare projects, tasks and collaboration information for tracking municipal work. The BFF builds responses for list, table and Kanban views using the session’s permissions.

Préparer les projets, tâches et informations de collaboration pour le suivi du travail municipal. Le BFF construit des réponses adaptées aux vues liste, tableau et Kanban, avec les permissions de la session.

## Documentation

| Language / Langue | Module | Technical / Technique |
| --- | --- | --- |
| English | [Module overview](docs/en/module.md) | [Technical documentation](docs/en/technical.md) |
| Français | [Présentation du module](docs/fr/module.md) | [Documentation technique](docs/fr/technical.md) |

The sections below are a quick reference in English; the French version of the setup, the routes and the checks is in [docs/fr/technical.md](docs/fr/technical.md).

Les sections ci-dessous sont un aide-mémoire en anglais ; leur version française (installation, routes, vérifications) est dans [docs/fr/technical.md](docs/fr/technical.md).

## Quick start

Node.js 26 and read access to the GitHub Packages of `mairie360` (`NODE_AUTH_TOKEN`, `read:packages`) are needed for the private `@mairie360/*` packages.

```bash
export NODE_AUTH_TOKEN=<token with read:packages>
npm ci
# create .env with the variables below
npm run start
```

The BFF listens on port `4001`: `GET /health` checks the process, `GET /check_apis` its upstreams, `/docs` serves Swagger UI and `/openapi.json` the contract.

Configuration (local example, every upstream is required: there is no `localhost` default):

```dotenv
PORT=4001
PROJECT_API_URL=http://localhost:3001
CORE_API_URL=localhost
CORE_API_PORT=3000
# Core's Ed25519 public key (MAIR-680), required: paste the public key of the Core you run against.
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n<base64 of Core's public key>\n-----END PUBLIC KEY-----"
```

## Routes

Generated contract: [`contracts/openapi.json`](contracts/openapi.json) (24 operations), published on every release as `@mairie360/bff-project-openapi` for the front.

| Method | Path | Summary |
| --- | --- | --- |
| `GET` | `/health` | Check the health of the BFF |
| `GET` | `/check_apis` | Checks that Core API and Project API are reachable |
| `PATCH` | `/projects/{projectId}/close` | Close or suspend a project |
| `POST` | `/projects` | Create a project |
| `POST` | `/projects/{projectId}/tasks` | Create a new task in an existing project |
| `DELETE` | `/projects/{projectId}` | Delete an existing project |
| `PATCH` | `/projects/{projectId}` | Partially update a project |
| `GET` | `/projects/{projectId}` | Get the detail of a project |
| `DELETE` | `/projects/{projectId}/tasks/{taskId}` | Delete an existing task of a project |
| `PATCH` | `/projects/{projectId}/tasks/{taskId}` | Update an existing task of a project |
| `POST` | `/projects/{projectId}/duplicate` | Duplicate a project |
| `PATCH` | `/projects/{projectId}/tasks/{taskId}/status` | Update the status of an existing task of a project |
| `GET` | `/projects-page` | Load the projects page |
| `GET` | `/projects/{projectId}/tasks/{taskId}/collaboration` | Read the comments and the history of a task |
| `POST` | `/projects/{projectId}/tasks/{taskId}/comments` | Add a comment to a task |
| `GET` | `/projects/{projectId}/archived-tasks` | Lists the archived tasks of a project |
| `GET` | `/projects/{projectId}/statuses` | Lists the task statuses of a project |
| `POST` | `/projects/{projectId}/statuses` | Adds a task status to a project |
| `PATCH` | `/projects/{projectId}/statuses/{statusId}` | Renames, recolours, moves or recategorizes a task status |
| `DELETE` | `/projects/{projectId}/statuses/{statusId}` | Deletes a task status |
| `GET` | `/project-templates` | Lists the project templates |
| `POST` | `/project-templates` | Creates a project template |
| `PATCH` | `/project-templates/{templateId}` | Updates a project template |
| `DELETE` | `/project-templates/{templateId}` | Deletes a project template |

## Upstream contracts

The BFF calls its upstreams through these published packages (never through a local checkout); bumping one of them is how an upstream change reaches this BFF:

- `@mairie360/core-api-openapi`
- `@mairie360/project-api-openapi`

## Commands

```bash
npm run lint                 # eslint
npm test                     # jest: unit, route and upstream-mock tests
npm run contracts:generate   # regenerate contracts/ after a route, schema or status change
npm run contracts:check      # CI gate: fails when contracts/ is stale
```

Docker stacks, one at a time (they need `NODE_AUTH_TOKEN` and pull access to `ghcr.io/mairie360`):

- `./integration_test.sh`: newman collection against the stack of `docker-compose-integration.yml`
- `./security_test.sh`: OWASP ZAP scan of `/openapi.json` (`docker-compose-security.yml`)
- `./performance_test.sh`: k6 load test (`docker-compose-performance.yml`)
- `./gdpr_marker_test.sh`: GDPR marker check (`docker-compose-gdpr-marker.yml`)
- `./gdpr_simulation_test.sh`: GDPR erasure simulation (`docker-compose-gdpr-simulation.yml`)

CI is the reusable `mairie360/CICD` workflow called by `.github/workflows/cicd.yml`.

## Contracts and background / Contrats et compléments

- [CONTRACT.md](CONTRACT.md)
- [contracts/openapi.json](contracts/openapi.json)
