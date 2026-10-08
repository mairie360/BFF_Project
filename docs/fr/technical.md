# BFF_Project — Documentation technique

[Présentation du module](module.md) · [English](../en/technical.md) · [README](../../README.md)

## Architecture et traitement des requêtes

Serveur Express 5.2.1 écrit en TypeScript. Les schémas Zod et leur registre OpenAPI décrivent les objets échangés; les routeurs adaptent les services amont aux besoins des interfaces.

`src/app.ts` (l’application Express, importée par les tests) installe les en-têtes de sécurité partagés de `@mairie360/bffs-lib` (`securityHeaders`, `apiOnlyHeaders()`), puis, sur les routeurs liés à la session, `noStore`, `requireBearer` et le contexte utilisateur obtenu auprès de BFF User ; `src/index.ts` charge `.env`, vérifie la configuration et écoute (`PORT`, 4001 par défaut). Chaque appel amont reçoit ses options de la bibliothèque (`asCaller(service, req)`, `withoutSession(service)` pour les sondes), qui transmet explicitement l’en-tête `Authorization` de l’appelant, et passe par `callUpstream`. Les routeurs Project utilisent les helpers de normalisation et les clients générés de Project API et Core API via `src/services/projectData.ts`. Chaque adresse amont est relue à chaque appel depuis `<SERVICE>_URL` (+ `<SERVICE>_PORT` facultatif) par `baseUrl` de la bibliothèque partagée ; il n’y a aucune valeur par défaut `localhost`.

## Données et persistance

Le BFF ne possède aucune base. Visibilité, membres, projets, tâches et collaboration (commentaires et historique) sont lus et écrits via le contrat OpenAPI de Project API 1.0.0, et l’annuaire des personnes assignables vient de Core API (`GET /api/v1/user/`). Project API calcule elle-même la visibilité : un projet inaccessible à l’appelant répond 404. Ses listes sont paginées (100 éléments par défaut) : le BFF demande des pages de 500 et lit toutes les pages jusqu’au `total` renvoyé par Project API (projets, tâches et membres d’un projet, commentaires et historique d’une tâche). Project API écrit elle-même l’historique des tâches, le BFF ne l’écrit donc jamais.

Désactiver l’accès SQL change les capacités et la persistance; ce mode ne constitue pas une validation d’un déploiement complet. Les identifiants publics et statuts sont normalisés par les helpers, tandis que certains champs de projet sont dérivés des tâches.

## Installation et lancement local

Utiliser Node.js 24 pour reproduire les jobs de CI et npm avec le fichier de verrouillage versionné. Les versions des autres jobs et de Docker sont précisées plus bas.

Les dépendances privées `@mairie360/*` nécessitent un accès GitHub Packages. Configurer `NODE_AUTH_TOKEN` dans l’environnement avec un jeton autorisé à lire ces packages, conformément à `.npmrc`. Ne pas enregistrer la valeur dans Git.

```bash
npm ci
```

Créer `.env` à la racine. Exemple de configuration HTTP locale à adapter aux services démarrés:

```dotenv
PORT=4001
USER_BFF_URL=http://localhost:4000
PROJECT_API_URL=http://localhost:3001
CORE_API_URL=localhost
CORE_API_PORT=3000
```

Aucune variable de base de données n’est nécessaire : le BFF ne dialogue qu’avec BFF User, Project API et Core API. `.env` est chargé par `import 'dotenv/config'`, première ligne de `src/index.ts`. Le serveur refuse de démarrer si `USER_BFF_URL`, `PROJECT_API_URL` ou `CORE_API_URL` est absente ou invalide, en nommant chaque variable fautive.

```bash
npm run start
```

`PORT` vaut `4001` par défaut, le port documenté de ce BFF.

Vérifier le processus puis consulter la documentation interactive:

```bash
curl --fail --silent --show-error http://localhost:4001/health
```

Interface Swagger: `http://localhost:4001/docs`. Spécification JSON: `/openapi.json`, avec l’alias `/swagger.json`. `/health` vérifie le processus; `/check_apis` est un diagnostic distinct des dépendances.

## Configuration

Les valeurs ci-dessous sont des exemples locaux ou des comportements explicitement indiqués, pas des identifiants de production.

| Variable ou priorité | Exemple / repli indiqué | Rôle |
| --- | --- | --- |
| `PORT` | 4001 (défaut) | Port d’écoute. |
| `TRUST_PROXY` | absent (aucun proxy de confiance) | Réglage Express `trust proxy` (`true`, un nombre de sauts ou des adresses/sous-réseaux séparés par des virgules), pour que `req.ip` soit le vrai client derrière l’ingress. |
| `USER_BFF_URL` / `USER_BFF_PORT` | http://localhost:4000 / — | Service de session, route `/me` et sonde de `/check_apis`. Obligatoire. |
| `PROJECT_API_URL` / `PROJECT_API_PORT` | http://localhost:3001 / — | Project API, pour les appels et la sonde de `/check_apis`. Obligatoire. |
| `CORE_API_URL` / `CORE_API_PORT` | localhost / 3000 | Core API (annuaire et sonde de `/check_apis`). Obligatoire. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | non défini (télémétrie désactivée) | Collecteur OpenTelemetry de l’instance, par ex. `http://otel-collector:4318` : les traces et les métriques HTTP y sont exportées en OTLP (MAIR-504). Seuls la méthode, le statut, la route paramétrée et l’hôte appelé sortent du BFF, jamais une URL, une query string, un en-tête, un identifiant ou une IP. |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | `bff-project` ; non défini | Remplacent le nom du service ; attributs de ressource supplémentaires comme `service.version=<tag de l’image>,deployment.environment.name=prod`. `OTEL_SDK_DISABLED=true` désactive la télémétrie. |

Chaque `<SERVICE>_URL` est un hôte ou une URL (schéma facultatif, `http` par défaut) ; `<SERVICE>_PORT` ne s’applique que si l’URL ne porte pas de port (`http://project-api:3001`, comme le chart Helm le définit, garde 3001). Ces variables sont obligatoires : le démarrage échoue sans elles, et une requête qui devrait joindre un service non configuré répond 503. `PROJECT_API_BASE_PATH` n’existe plus : utiliser `PROJECT_API_URL`.

## Routes et contrat de données

Inventaire extrait de `contracts/openapi.json`. Les paramètres entre accolades sont remplacés par des identifiants réels. Les types détaillés, champs requis, réponses et exemples éventuels sont définis dans ce contrat; les statuts du tableau sont ceux déclarés, sans prétendre lister toutes les erreurs de transport ou de validation.

| Méthode | Chemin | Corps déclaré | Statuts déclarés |
| --- | --- | --- | --- |
| GET | `/health` | — | 200 |
| GET | `/check_apis` | — | 200, 502 |
| PATCH | `/projects/{projectId}/close` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| POST | `/projects` | application/json | 201, 400, 401, 403, 500, 502, 503 |
| POST | `/projects/{projectId}/tasks` | application/json | 201, 400, 401, 403, 404, 500, 502, 503 |
| DELETE | `/projects/{projectId}` | — | 204, 400, 401, 403, 404, 500, 502, 503 |
| PATCH | `/projects/{projectId}` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| GET | `/projects/{projectId}` | — | 200, 400, 401, 404, 500, 502, 503 |
| DELETE | `/projects/{projectId}/tasks/{taskId}` | — | 204, 400, 401, 403, 404, 500, 502, 503 |
| PATCH | `/projects/{projectId}/tasks/{taskId}` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| POST | `/projects/{projectId}/duplicate` | — | 201, 400, 401, 403, 404, 500, 502, 503 |
| PATCH | `/projects/{projectId}/tasks/{taskId}/status` | application/json | 200, 400, 401, 403, 404, 500, 502, 503 |
| GET | `/projects-page` | — | 200, 400, 401, 500, 502, 503 |
| GET | `/projects/{projectId}/tasks/{taskId}/collaboration` | — | 200, 400, 401, 403, 404, 500, 502, 503 |
| POST | `/projects/{projectId}/tasks/{taskId}/comments` | application/json | 201, 400, 401, 403, 404, 500, 502, 503 |

## Session, permissions et erreurs

`/projects-page` et `/projects` exigent un en-tête `Authorization: Bearer <token>` (seul identifiant accepté : les cookies, `x-session-token` et les autres schémas sont ignorés ; le proxy des fronts transforme le cookie `accessToken` en cet en-tête) et un contexte utilisateur valide. Sans Bearer, ils répondent 401 avant tout appel amont, et chaque réponse porte `Cache-Control: no-store`. L’en-tête de l’appelant, normalisé en `Bearer <token>`, est transmis à BFF User, Project API et Core API ; `/health` et `/check_apis` ne le transmettent jamais. Quand `/me` de BFF User ne renvoie pas `user.id`, l’identifiant de l’appelant est lu dans le `sub` du jeton que BFF User vient d’accepter. Les rôles reconnus sont `Admin`, `Maire`, `Responsable`, `User`, `Guest`; visibilité et modifications passent par les règles serveur et les permissions renvoyées. Les appels à BFF User, Project API et Core API ont un délai de 5 secondes ; les lectures idempotentes (`GET`) de Project API et Core API sont retentées une fois en l’absence de réponse ou sur 502, 503 ou 504, jamais les écritures.

Les erreurs utilisent l’enveloppe commune à tous les BFFs, `ErrorResponse` de `@mairie360/bffs-lib` (`{ error: { code, message, details } }`, `code` déduit du statut : `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INTERNAL_ERROR`, `BAD_GATEWAY`...). Une validation échouée répond 400 `Validation failed` (`parseRequest` / `validationError` de la bibliothèque) avec une entrée `details` par valeur invalide, `{ path, message }`, où `path` commence par `body.`, `params.` ou `query.`. 401 pour une session absente ou refusée, 502 si BFF User, Project API ou Core API est injoignable ou répond en 5xx, 503 si l’une de leurs URL n’est pas configurée. Un 4xx amont n’est conservé, avec un message générique, que si la route déclare ce statut ; tout autre statut amont (501 compris) devient 502. Ni le corps amont ni le détail réseau ne sont renvoyés, et une erreur imprévue produit un 500 générique journalisé. Une route inconnue répond un 404 JSON et un corps JSON mal formé un 400 dans la même enveloppe au lieu de la page HTML d’Express. Les corps sont validés avant tout appel amont : `<` et `>` sont refusés dans les titres, descriptions, étiquettes et commentaires, et les personnes sont désignées par un identifiant public (`user-<id>`; un `responsibleId` vide signifie personne); `/projects-page` refuse un `dueBefore`/`dueAfter` qui n’est pas une date. `/check_apis` (`checkApis` de la bibliothèque) sonde indépendamment le `/health` de Core API, Project API et BFF User, sans session et avec les mêmes `<SERVICE>_URL` + `<SERVICE>_PORT` que les vrais appels (relus à chaque requête ; un amont non configuré est `Unreachable`). Il répond `{ status, core_api, project_api, user_bff }` (`CheckApisResponse`), 200 si chaque amont est `Connected`, 502 sinon.

Les identifiants publics sont lus avec leur seul préfixe : `project-<id>`, `task-<id>` et `user-<id>`. Toute autre valeur (`user-5` comme projet, `abc12`, `project-5x`) répond 400.

## Écritures, membres et données persistées

- `PATCH /projects/{projectId}` est partiel. Les membres ne sont réécrits que si `assigneeIds` est envoyé, à partir de l’état fusionné : `responsibleId` s’il est envoyé, sinon le responsable actuel (le premier membre), plus `assigneeIds`. Un `responsibleId` envoyé seul ajoute ce membre sans en retirer aucun. Sans ces deux champs, les membres ne sont pas modifiés.
- Project API ne stocke que le nom, la description, le statut et les membres d’un projet. `priority`, `labels` et `dueDate` sont acceptés par `POST /projects` et `PATCH /projects/{projectId}` mais non persistés : chaque écriture répond l’état relu dans Project API, où priorité, avancement et échéance sont dérivés des tâches et `labels` est vide. Le statut du projet est persisté via la correspondance de Project API (`todo`/`in-progress` → Active, `review` → Suspended, `done` → Completed), donc `todo` revient en `in-progress`.
- `createdAt` (projets et tâches) reste obligatoire dans le contrat mais Project API ne l’expose pas : le BFF y met l’heure de la réponse. Les réponses de tâche ne portent plus le `updatedAt` inventé (facultatif dans le contrat).
- Project API n’offre pas de création atomique. `POST /projects` et `POST /projects/{projectId}/duplicate` créent le projet, puis ses membres, son statut et ses tâches un appel à la fois ; si l’une de ces étapes échoue, le BFF supprime le projet créé (au mieux, avec un log si la suppression échoue aussi) avant de répondre l’erreur, pour qu’une nouvelle tentative ne laisse pas de doublon partiel.
- Chaque garde d’accès lit le bundle du projet une seule fois et le transmet à la route ; une écriture le relit ensuite une fois pour répondre. `/projects-page` applique la recherche et le filtre de statut à la liste des projets avant de lire le moindre bundle, puis lit les bundles restants 5 par 5 ; les bundles de tous les projets retenus restent nécessaires aux filtres de priorité et d’échéance, au résumé et aux compteurs Kanban.

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

Le job `contracts.yml` utilise Node.js 24, `actions/checkout@v7` et `actions/setup-node@v7`. Il s’exécute sur push, pull request et lancement manuel; il installe avec `npm ci`, contrôle les contrats et lance les tests dédiés.

`cicd.yml` appelle `mairie360/CICD/.github/workflows/BFFs-cicd.yml@v3.2.0`, avec `cicd_version: v3.2.0` et `node_version: "24"`. Les étapes réutilisables et les environnements GitHub déterminent les contrôles, publications et déploiements effectifs.

`Dockerfile` et `development.Dockerfile` utilisent `node:24-alpine` épinglé par digest, la même version de Node.js que les jobs de CI ; l’image de production lance `["node", "dist/index.js"]` (bundle esbuild).

`security_test.sh` et `performance_test.sh` testent l’image désignée par `IMAGE_REF`: en CI, l’image que `release-dev` vient de publier, soit l’artefact ensuite promu en staging puis en prod. Quand `IMAGE_REF` est vide (usage local), ils construisent d’abord `bff-project:local` depuis `development.Dockerfile`, ce qui demande `NODE_AUTH_TOKEN` et `./.npmrc`.

`security_test.sh` lance la stack OWASP ZAP de `docker-compose-security.yml`: ZAP rejoue chaque opération de `/openapi.json` avec un JWT admin statique (`sub=1`, HS256, `JWT_SECRET=b"secret"`) et remplit corps et paramètres de chemin avec les exemples du contrat. `init-test.sql` crée les ressources que ces exemples désignent (utilisateurs 1 et 2, `project-1` avec `task-1`, et `project-2` / `task-2` pour les routes DELETE); garder exemples et seed alignés en ajoutant une route.

La stack ZAP porte la gate de couverture OpenAPI de `mairie360/CICD` (`tests/zap/zap_hooks.py`), extraite dans `cicd-repo/` par le job CI et clonée au même endroit par `security_test.sh` / `performance_test.sh` au `cicd_version` épinglé (`CICD_VERSION` le remplace). Après le scan, le hook échoue si une opération du contrat n’a jamais été atteinte, ou si une opération qui exige `bearerAuth` n’a reçu que des 401/403 ; les opérations publiques (`/health`, `/check_apis`) déclarent `security: []` dans leur `registerPath`. Une nouvelle route publique demande `security: []` ; une route authentifiée demande le seed que désignent ses exemples.

La stack k6 porte la même gate via `tests/k6/coverage.js` : `load-test.js` contient un handler par opération de `contracts/openapi.json`, k6 s’arrête à l’init s’il en manque un et échoue sur le seuil `operations_uncovered` si un handler n’envoie pas sa requête. **Ajouter une route implique d’ajouter son handler dans `load-test.js`.** Deux scénarios tournent : `crud` (2 VUs) appelle chaque handler une fois par itération, écritures comprises (en tant qu’admin seedé), sur un projet qu’il crée puis supprime ; `reads` (jusqu’à 20 VUs) ne rejoue que les handlers GET sur `project-1` / `task-1`. Chaque opération a un seuil `p(95)` fixé par sa famille : 50 ms pour `/health`, 300 ms pour `/check_apis`, 500 ms pour les lectures, 800 ms pour les écritures ; `http_req_failed` doit rester sous 1 %.

Avant un lancement Docker, vérifier les variables de service, les secrets de build et les réseaux dans les fichiers du dépôt. Une CI verte valide ses jobs; elle ne prouve pas la disponibilité des services métier dans un environnement distant.

## Diagnostic

Si le contexte utilisateur échoue, vérifier BFF User avant Project API. Si les vues divergent, contrôler les permissions et les identifiants. `npm run mock:project-api` fournit un serveur local de développement; ce serveur ne remplace pas les données réelles. Le script `pretest` vérifie les types avec `tsconfig.test.json` avant Jest.

`tests/projects.upstream-mocks.test.ts` teste l’application complète contre de vrais serveurs HTTP simulant BFF User, Project API et Core API. Leurs contrats sont reconstruits depuis les paquets `@mairie360/bff-user-openapi` (devDependency alignée sur l’image `bff-user` des stacks de test), `@mairie360/project-api-openapi` et `@mairie360/core-api-openapi` installés : les mocks refusent chemins, paramètres et corps absents du contrat amont, et chaque réponse du BFF est validée contre `contracts/openapi.json`. `tests/upstream-contracts.test.ts` fige les versions et les opérations consommées.

## Repères dans le dépôt

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

Compléments historiques: [CONTRACT.md](../../CONTRACT.md). Les besoins proposés doivent rester distincts du comportement effectivement implémenté.
