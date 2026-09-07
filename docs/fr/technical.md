# BFF_Project — Documentation technique

[Présentation du module](module.md) · [English](../en/technical.md) · [README](../../README.md)

Documentation du code versionné au 7 septembre 2026, basée sur `d7dd4cb30e26`. Les commandes ci-dessous décrivent les vérifications à effectuer; elles ne certifient pas un déploiement distant.

## Architecture et traitement des requêtes

Serveur Express 5.2.1 écrit en TypeScript. Les schémas Zod et leur registre OpenAPI décrivent les objets échangés; les routeurs adaptent les services amont aux besoins des interfaces.

`src/app.ts` installe le contexte de jeton puis le contexte utilisateur obtenu auprès de BFF User. Les routeurs Project utilisent les helpers de normalisation, le client Project et le dépôt SQL. Le client HTTP transmet l’autorisation de la requête; `PROJECT_API_BASE_PATH` est prioritaire sur l’hôte et le port séparés.

## Données et persistance

Le module combine Project API et PostgreSQL. Le dépôt SQL gère notamment visibilité, membres, projets, tâches et collaboration. Les commentaires et une partie de l’historique utilisent `tasks.custom_fields`; l’historique de statut peut venir de `task_history`. Avec `PROJECT_DB_ACCESS=disabled`, la collaboration utilise un repli mémoire perdu au redémarrage.

Désactiver l’accès SQL change les capacités et la persistance; ce mode ne constitue pas une validation d’un déploiement complet. Les identifiants publics et statuts sont normalisés par les helpers, tandis que certains champs de projet sont dérivés des tâches.

## Installation et lancement local

Utiliser Node.js 22 pour reproduire le job de contrats et npm avec le fichier de verrouillage versionné. Les versions des autres jobs et de Docker sont précisées plus bas.

Les dépendances privées `@mairie360/*` nécessitent un accès GitHub Packages. Configurer `NODE_AUTH_TOKEN` dans l’environnement avec un jeton autorisé à lire ces packages, conformément à `.npmrc`. Ne pas enregistrer la valeur dans Git.

```bash
npm ci
```

Créer `.env` à la racine. Exemple de configuration HTTP locale à adapter aux services démarrés:

```dotenv
PORT=4001
USER_BFF_URL=http://localhost:4000
PROJECT_API_BASE_PATH=http://localhost:3001
PROJECT_API_URL=localhost
PROJECT_API_PORT=3001
CORE_API_URL=localhost
CORE_API_PORT=3000
```

Compléter `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` pour une base existante contenant les tables attendues par les dépôts SQL. Ces variables et les éventuels secrets listés ci-dessous restent à fournir; l’exemple HTTP ne prépare ni schéma ni données.

```bash
npm run start
```

`PORT` est obligatoire pour ce BFF; cet exemple utilise `4001`.

Vérifier le processus puis consulter la documentation interactive:

```bash
curl --fail --silent --show-error http://localhost:4001/health
```

Interface Swagger: `http://localhost:4001/docs`. Spécification JSON: `/openapi.json`, avec l’alias `/swagger.json`. `/health` vérifie le processus; `/check_apis` est un diagnostic distinct des dépendances.

## Configuration

Les valeurs ci-dessous sont des exemples locaux ou des comportements explicitement indiqués, pas des identifiants de production.

| Variable ou priorité | Exemple / repli indiqué | Rôle |
| --- | --- | --- |
| `PORT` | 4001 | Port de cet exemple local. |
| `USER_BFF_URL` | http://localhost:4000 | Service de session, route `/me`. |
| `PROJECT_API_BASE_PATH` | http://localhost:3001 | Adresse explicite prioritaire; les chemins `/api/v1/...` viennent du client. |
| `PROJECT_API_URL` / `PROJECT_API_PORT` | localhost / 3001 | Adresse alternative et paramètres de diagnostic. |
| `CORE_API_URL` / `CORE_API_PORT` | localhost / 3000 | Configuration du client Core et du diagnostic. |
| `PROJECT_DB_ACCESS` | enabled | Seule la valeur `disabled` désactive l’accès SQL. |
| `DB_HOST` / `DB_PORT` | localhost / 5432 | Connexion PostgreSQL des dépôts SQL. |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | — | Base, compte et secret à fournir pour le schéma partagé attendu. |

## Routes et contrat de données

Inventaire extrait de `contracts/openapi.json`. Les paramètres entre accolades sont remplacés par des identifiants réels. Les types détaillés, champs requis, réponses et exemples éventuels sont définis dans ce contrat; les statuts du tableau sont ceux déclarés, sans prétendre lister toutes les erreurs de transport ou de validation.

| Méthode | Chemin | Corps déclaré | Statuts déclarés |
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

## Session, permissions et erreurs

`/projects-page` et `/projects` exigent un Bearer et un contexte utilisateur valide. Les rôles reconnus sont `Admin`, `Maire`, `Responsable`, `User`, `Guest`; visibilité et modifications passent par les règles serveur et les permissions renvoyées. Les appels de contexte utilisateur et du client Project ont un délai de 5 secondes.

## Synchronisation et vérifications

```bash
npm run contracts:generate
npm run contracts:check
npm test -- --runInBand
npm run lint
npm run build
```

`contracts:generate` exporte le registre runtime dans `contracts/openapi.json` et régénère `contracts/bff.d.ts`. `contracts:check` échoue si le contrat ou les types sont périmés. Exécuter ensuite `npm run contracts:sync` dans chaque web service associé et livrer les modifications de contrat ensemble.

Le générateur de types est fixé à `openapi-typescript@7.10.1` dans `scripts/contracts.mjs` et s’exécute via npm. Pour une modification uniquement documentaire, vérifier les liens, l’exactitude des deux langues et `git diff --check`; ne pas régénérer les contrats sans modification de leur source.

## CI/CD et exécution Docker

Le job `contracts.yml` utilise Node.js 22, `actions/checkout@v7` et `actions/setup-node@v7`. Il s’exécute sur push, pull request et lancement manuel; il installe avec `npm ci`, contrôle les contrats et lance les tests dédiés.

`cicd.yml` appelle `mairie360/CICD/.github/workflows/BFFs-cicd.yml@v1.13.2`, avec `cicd_version: v1.13.2` et `node_version: "22"`. Les étapes réutilisables et les environnements GitHub déterminent les contrôles, publications et déploiements effectifs.

Le Dockerfile utilise encore `node:20-alpine` pour la construction et l’exécution; la commande de l’image est `["npx", "tsx", "dist/index.js"]`. Cette version est distincte du job de contrats Node.js 22.

Avant un lancement Docker, vérifier les variables de service, les secrets de build et les réseaux dans les fichiers du dépôt. Une CI verte valide ses jobs; elle ne prouve pas la disponibilité des services métier dans un environnement distant.

## Diagnostic

Si le contexte utilisateur échoue, vérifier BFF User avant Project API. Si les vues divergent, contrôler les permissions, les identifiants et le mode `PROJECT_DB_ACCESS`. `npm run mock:project-api` fournit un serveur local de développement; ce serveur ne remplace pas les données réelles. Le script `pretest` vérifie les types avec `tsconfig.test.json` avant Jest.

## Repères dans le dépôt

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

Compléments historiques: [CONTRACT.md](../../CONTRACT.md). Les besoins proposés doivent rester distincts du comportement effectivement implémenté.
