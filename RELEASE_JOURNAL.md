# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "b643e720f51e25126c93bb0286ec1bfd427327c5", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "updated": {"dev": "2026-10-20 17:56 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `dfbdc37` | — |
| dev | — | `b643e72` | 2026-10-20 17:56 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Le BFF émet de la télémétrie OpenTelemetry (service `bff-project`) : traces (span serveur nommé d'après la route, spans des handlers, appels amont portant `traceparent`) et métriques HTTP exportées en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, la télémétrie reste désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte amont sont exportés, jamais une URL, une query string, un en-tête, un identifiant ou une IP. Les variables `OTEL_SERVICE_NAME` et `OTEL_RESOURCE_ATTRIBUTES` permettent de configurer le service, et `OTEL_SDK_DISABLED=true` coupe la télémétrie. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI du BFF (`contracts/openapi.json`) documente une réponse `429` (`ErrorResponse`) sur les routes de projets et de tâches. Elle signale que la limite de débit de Project API ou de Core API est atteinte, avec un nouvel essai à faire après le délai de l'en-tête `Retry-After` (secondes). Le diff est tronqué : le détail des routes concernées n'est pas entièrement visible. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Alignement des contrats amont et des images des stacks de test :
  - `@mairie360/core-api-openapi` passe en 2.1.0, puis `0.0.0-dev-30d9bb5`, puis `0.0.0-staging.b900797` ;
  - `@mairie360/project-api-openapi` passe en 1.1.0, puis `0.0.0-dev-be2b410` ;
  - les images `core-api` et `project-api` des fichiers `docker-compose*.yml` suivent ces versions.

  Seules les fixtures de test sont adaptées. (MAIR-568, MAIR-575, MAIR-600, [#215](https://github.com/mairie360/BFF_Project/pull/215), [#222](https://github.com/mairie360/BFF_Project/pull/222), [#225](https://github.com/mairie360/BFF_Project/pull/225))
- CI : workflow `mairie360/CICD` mis à jour de v4.2.1 à v4.3.2 en 4 bumps Renovate. Les secrets `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK` sont transmis à l'étape de journal des releases. (MAIR-571, [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#218](https://github.com/mairie360/BFF_Project/pull/218), [#223](https://github.com/mairie360/BFF_Project/pull/223))

## Différence dev → staging (en dev, pas encore en staging)

#### Nouveautés
- Le BFF émet de la télémétrie OpenTelemetry (service `bff-project`) : traces (span serveur nommé d'après la route, spans des handlers, appels amont portant `traceparent`) et métriques HTTP exportées en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, la télémétrie reste désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte amont sont exportés, jamais une URL, une query string, un en-tête, un identifiant ou une IP. Les variables `OTEL_SERVICE_NAME` et `OTEL_RESOURCE_ATTRIBUTES` permettent de configurer le service, et `OTEL_SDK_DISABLED=true` coupe la télémétrie. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI du BFF (`contracts/openapi.json`) documente une réponse `429` (`ErrorResponse`) sur les routes de projets et de tâches. Elle signale que la limite de débit de Project API ou de Core API est atteinte, avec un nouvel essai à faire après le délai de l'en-tête `Retry-After` (secondes). Le diff est tronqué : le détail des routes concernées n'est pas entièrement visible. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Alignement des contrats amont et des images des stacks de test :
  - `@mairie360/core-api-openapi` passe en 2.1.0, puis `0.0.0-dev-30d9bb5`, puis `0.0.0-staging.b900797` ;
  - `@mairie360/project-api-openapi` passe en 1.1.0, puis `0.0.0-dev-be2b410` ;
  - les images `core-api` et `project-api` des fichiers `docker-compose*.yml` suivent ces versions.

  Seules les fixtures de test sont adaptées. (MAIR-568, MAIR-575, MAIR-600, [#215](https://github.com/mairie360/BFF_Project/pull/215), [#222](https://github.com/mairie360/BFF_Project/pull/222), [#225](https://github.com/mairie360/BFF_Project/pull/225))
- CI : workflow `mairie360/CICD` mis à jour de v4.2.1 à v4.3.2 en 4 bumps Renovate. Les secrets `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK` sont transmis à l'étape de journal des releases. (MAIR-571, [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#218](https://github.com/mairie360/BFF_Project/pull/218), [#223](https://github.com/mairie360/BFF_Project/pull/223))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-20 17:56 UTC | dev | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 13:07 UTC | dev | — | `1c2e664` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427404719) |
| 2026-10-20 13:05 UTC | dev | — | `2b5c84c` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427122187) |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
