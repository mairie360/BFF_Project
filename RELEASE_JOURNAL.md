# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "1c2e6646885128c6442f398ccb5d64a29d81fc9c", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "updated": {"dev": "2026-10-20 13:07 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `dfbdc37` | — |
| dev | — | `1c2e664` | 2026-10-20 13:07 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Le BFF peut exporter des traces et des métriques HTTP OpenTelemetry (OTLP) vers le collecteur indiqué par `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, ou avec `OTEL_SDK_DISABLED=true`, la télémétrie est désactivée. Le nom du service vaut `bff-project` par défaut et se règle avec `OTEL_SERVICE_NAME` et `OTEL_RESOURCE_ATTRIBUTES`. Selon la documentation, seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du BFF, jamais d'URL, de query string, d'en-tête, d'identifiant ni d'IP. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI du BFF (`contracts/openapi.json`) documente une réponse `429` (`ErrorResponse`) sur les opérations projets et tâches, quand la limite de débit de la Project API ou de la Core API est atteinte, avec un délai de réessai dans l'en-tête `Retry-After` (en secondes). Le diff est tronqué : l'effet sur le code d'exécution n'est pas visible au-delà du contrat. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Contrats amont : `@mairie360/core-api-openapi` et `@mairie360/project-api-openapi` sont d'abord passés aux versions prod 2.1.0 / 1.1.0, puis repassés aux builds dev `0.0.0-dev-30d9bb5` / `0.0.0-dev-be2b410`. Les images `core-api` et `project-api` des stacks de test et de développement sont alignées en conséquence, avec les fixtures de test associées. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215) ; MAIR-575, [#222](https://github.com/mairie360/BFF_Project/pull/222))
- CI :
  - 4 mises à jour du workflow réutilisable `mairie360/CICD`, de v4.2.1 à v4.3.2 ([#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#223](https://github.com/mairie360/BFF_Project/pull/223)).
  - Transmission des secrets `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK` pour le journal des releases. (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218))

## Différence dev → staging (en dev, pas encore en staging)

#### Nouveautés
- Le BFF peut exporter des traces et des métriques HTTP OpenTelemetry (OTLP) vers le collecteur indiqué par `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, ou avec `OTEL_SDK_DISABLED=true`, la télémétrie est désactivée. Le nom du service vaut `bff-project` par défaut et se règle avec `OTEL_SERVICE_NAME` et `OTEL_RESOURCE_ATTRIBUTES`. Selon la documentation, seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du BFF, jamais d'URL, de query string, d'en-tête, d'identifiant ni d'IP. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI du BFF (`contracts/openapi.json`) documente une réponse `429` (`ErrorResponse`) sur les opérations projets et tâches, quand la limite de débit de la Project API ou de la Core API est atteinte, avec un délai de réessai dans l'en-tête `Retry-After` (en secondes). Le diff est tronqué : l'effet sur le code d'exécution n'est pas visible au-delà du contrat. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Contrats amont : `@mairie360/core-api-openapi` et `@mairie360/project-api-openapi` sont d'abord passés aux versions prod 2.1.0 / 1.1.0, puis repassés aux builds dev `0.0.0-dev-30d9bb5` / `0.0.0-dev-be2b410`. Les images `core-api` et `project-api` des stacks de test et de développement sont alignées en conséquence, avec les fixtures de test associées. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215) ; MAIR-575, [#222](https://github.com/mairie360/BFF_Project/pull/222))
- CI :
  - 4 mises à jour du workflow réutilisable `mairie360/CICD`, de v4.2.1 à v4.3.2 ([#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#223](https://github.com/mairie360/BFF_Project/pull/223)).
  - Transmission des secrets `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK` pour le journal des releases. (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-20 13:07 UTC | dev | — | `1c2e664` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427404719) |
| 2026-10-20 13:05 UTC | dev | — | `2b5c84c` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427122187) |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
