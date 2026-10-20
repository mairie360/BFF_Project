# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "2b5c84cd008c5e5fa147c6416556451f333963a8", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "updated": {"dev": "2026-10-20 13:05 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `dfbdc37` | — |
| dev | — | `2b5c84c` | 2026-10-20 13:05 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Le BFF exporte des traces et des métriques HTTP OpenTelemetry en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Les traces couvrent le span serveur nommé d'après la route et les spans des handlers, et les appels aux APIs amont portent `traceparent`. Seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du BFF : aucune URL, query string, en-tête, identifiant ou IP. Sans cette variable, la télémétrie est désactivée. `OTEL_SERVICE_NAME` (par défaut `bff-project`), `OTEL_RESOURCE_ATTRIBUTES` et `OTEL_SDK_DISABLED` sont aussi pris en charge. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI du BFF (`contracts/openapi.json`) documente désormais une réponse `429` (`ErrorResponse`) sur les opérations projets et tâches, quand la limite de débit de la Project API ou de la Core API est atteinte. Le client doit réessayer après le délai indiqué dans l'en-tête `Retry-After`, en secondes. Le diff est tronqué : le détail des routes concernées n'est pas visible. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Contrats amont : `@mairie360/core-api-openapi` est passé à 2.1.0 puis à `0.0.0-dev-30d9bb5`, et `@mairie360/project-api-openapi` à 1.1.0 puis à `0.0.0-dev-be2b410`. Les images `core-api` et `project-api` des stacks de test suivent, et les fixtures de test sont adaptées. (MAIR-568, MAIR-575, [#215](https://github.com/mairie360/BFF_Project/pull/215), [#222](https://github.com/mairie360/BFF_Project/pull/222))
- CI : le workflow `mairie360/CICD` passe de v4.2.1 à v4.3.1 en trois mises à jour Renovate. Les secrets du journal des releases (`ANTHROPIC_API_KEY`, `RELEASE_APP_ID`, `RELEASE_APP_PK`) sont transmis au workflow. (MAIR-571, [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#218](https://github.com/mairie360/BFF_Project/pull/218))

## Différence dev → staging (en dev, pas encore en staging)

#### Nouveautés
- Le BFF exporte des traces et des métriques HTTP OpenTelemetry en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Les traces couvrent le span serveur nommé d'après la route et les spans des handlers, et les appels aux APIs amont portent `traceparent`. Seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du BFF : aucune URL, query string, en-tête, identifiant ou IP. Sans cette variable, la télémétrie est désactivée. `OTEL_SERVICE_NAME` (par défaut `bff-project`), `OTEL_RESOURCE_ATTRIBUTES` et `OTEL_SDK_DISABLED` sont aussi pris en charge. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI du BFF (`contracts/openapi.json`) documente désormais une réponse `429` (`ErrorResponse`) sur les opérations projets et tâches, quand la limite de débit de la Project API ou de la Core API est atteinte. Le client doit réessayer après le délai indiqué dans l'en-tête `Retry-After`, en secondes. Le diff est tronqué : le détail des routes concernées n'est pas visible. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Contrats amont : `@mairie360/core-api-openapi` est passé à 2.1.0 puis à `0.0.0-dev-30d9bb5`, et `@mairie360/project-api-openapi` à 1.1.0 puis à `0.0.0-dev-be2b410`. Les images `core-api` et `project-api` des stacks de test suivent, et les fixtures de test sont adaptées. (MAIR-568, MAIR-575, [#215](https://github.com/mairie360/BFF_Project/pull/215), [#222](https://github.com/mairie360/BFF_Project/pull/222))
- CI : le workflow `mairie360/CICD` passe de v4.2.1 à v4.3.1 en trois mises à jour Renovate. Les secrets du journal des releases (`ANTHROPIC_API_KEY`, `RELEASE_APP_ID`, `RELEASE_APP_PK`) sont transmis au workflow. (MAIR-571, [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#218](https://github.com/mairie360/BFF_Project/pull/218))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-20 13:05 UTC | dev | — | `2b5c84c` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427122187) |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
