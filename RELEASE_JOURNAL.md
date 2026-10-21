# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "b643e720f51e25126c93bb0286ec1bfd427327c5", "updated": {"dev": "2026-10-21 09:32 UTC", "staging": "2026-10-20 18:12 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `b643e72` | 2026-10-20 18:12 UTC |
| dev | — | `7a11803` | 2026-10-21 09:32 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Télémétrie OpenTelemetry du BFF : traces (span serveur par route, spans des handlers, `traceparent` vers les API amont) et métriques HTTP exportées en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, rien n'est exporté. Seuls la méthode, le statut, la route paramétrée et l'hôte amont sortent du BFF. Nouvelles variables documentées : `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_SDK_DISABLED`. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))

#### Changements de comportement
- Le contrat OpenAPI documente désormais une réponse `429` (`ErrorResponse`, en-tête `Retry-After` en secondes) sur de nombreuses opérations projets et tâches, avec le message « Project API or Core API rate limit reached ». Un appelant qui se base sur le contrat doit gérer ce code. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Pipeline : `cicd.yml` passe de v4.2.1 à v4.4.3 au fil des PR ; il ne se déclenche plus que sur `push` vers `main`, et les workflows `promote-staging.yml` / `promote-prod.yml` sont ajoutés en dispatch manuel. Renovate a suivi les versions intermédiaires. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228) ; MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230) ; renovate [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#223](https://github.com/mairie360/BFF_Project/pull/223))
- Dépendances : contrats amont passés de builds dev à des versions prod (`@mairie360/core-api-openapi` 2.2.0, `@mairie360/project-api-openapi` 1.2.0 ; intermédiaires 2.1.0 / 1.1.0), stacks de test alignées, `follow-redirects` 1.16.1 dans le lockfile. Les fixtures de tests suivent les nouveaux contrats. (MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230) ; MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))
- Le job de release journal reçoit ses secrets (`ANTHROPIC_API_KEY`, `RELEASE_APP_ID`, `RELEASE_APP_PK`) via `cicd.yml`. (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218))

## Différence dev → staging (en dev, pas encore en staging)

#### Technique
- Pipeline : un push sur `main` ne déclenche plus que la release dev et s'arrête à `release-dev`. Staging et prod passent par les workflows manuels `promote-staging.yml` / `promote-prod.yml`, épinglés sur CICD v4.4.0 puis v4.4.3. `follow-redirects` 1.16.1 est ajouté au lockfile pour débloquer `npm audit`. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228) ; MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230))
- Dépendances : `@mairie360/core-api-openapi` 2.2.0 et `@mairie360/project-api-openapi` 1.2.0 remplacent les builds dev, et les stacks docker-compose passent à core-api 2.2.0, project-api 1.2.0, database et liquibase-migrations 3.3.0. (MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230))

## Différence staging → prod (en staging, pas encore en prod)

#### Nouveautés
- Télémétrie OpenTelemetry du BFF : traces et métriques HTTP exportées en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`, désactivée si la variable est absente. Seuls la méthode, le statut, la route paramétrée et l'hôte amont sortent du BFF. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))

#### Changements de comportement
- Le contrat OpenAPI documente une réponse `429` avec en-tête `Retry-After` sur de nombreuses opérations projets et tâches. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Pipeline : `cicd.yml` passe de v4.2.1 à v4.3.2 via Renovate, et `cicd_version` est aussi suivi dans les workflows de promotion. Le job de release journal reçoit ses secrets. (renovate [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#223](https://github.com/mairie360/BFF_Project/pull/223) ; MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218))
- Dépendances : contrats amont en versions prod (`@mairie360/core-api-openapi` 2.1.0, `@mairie360/project-api-openapi` 1.1.0), fixtures de tests mises à jour, `contracts/bff.d.ts` et `contracts/openapi.json` régénérés. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-21 09:32 UTC | dev | — | `7a11803` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39577253428) |
| 2026-10-21 01:38 UTC | dev | — | `3872bdb` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39528039459) |
| 2026-10-20 18:12 UTC | staging | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 17:56 UTC | dev | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 13:07 UTC | dev | — | `1c2e664` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427404719) |
| 2026-10-20 13:05 UTC | dev | — | `2b5c84c` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427122187) |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
