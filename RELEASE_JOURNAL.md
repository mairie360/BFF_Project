# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "59f59dc1f54ee4c2144a968f737259edce4e0678", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "updated": {"dev": "2026-10-19 20:13 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `dfbdc37` | — |
| dev | — | `59f59dc` | 2026-10-19 20:13 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Le BFF exporte des traces (span serveur nommé d'après la route, appels aux APIs amont) et des métriques HTTP en OTLP vers le collecteur défini par `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, ou avec `OTEL_SDK_DISABLED=true`, la télémétrie est désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du BFF, jamais une URL, une query string, un en-tête, un identifiant ou une IP. Le nom du service vaut `bff-project` par défaut et se surcharge avec `OTEL_SERVICE_NAME`. `OTEL_RESOURCE_ATTRIBUTES` porte des attributs comme `service.version` ou `deployment.environment.name`. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))

#### Changements de comportement
- Le contrat OpenAPI du BFF (`contracts/openapi.json`, `contracts/bff.d.ts`) documente désormais une réponse `429` (`ErrorResponse`) sur les opérations projets et tâches. Elle signale que la limite de débit de la Project API ou de la Core API est atteinte ; l'appelant doit réessayer après le délai de l'en-tête `Retry-After` (en secondes). Le diff est tronqué : le détail des routes concernées n'est pas entièrement visible. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Les dépendances de contrats passent sur leurs versions prod : `@mairie360/core-api-openapi` 2.1.0 et `@mairie360/project-api-openapi` 1.1.0. Les fixtures de tests et les stacks docker-compose sont ajustées en conséquence. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))
- CI : 3 montées de version du workflow `mairie360/CICD` (v4.2.1 → v4.3.1) et transmission des secrets `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK` pour l'étape de journal des releases. (MAIR-571, [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#218](https://github.com/mairie360/BFF_Project/pull/218))

## Différence dev → staging (en dev, pas encore en staging)

#### Nouveautés
- Le BFF exporte des traces (span serveur nommé d'après la route, appels aux APIs amont) et des métriques HTTP en OTLP vers le collecteur défini par `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, ou avec `OTEL_SDK_DISABLED=true`, la télémétrie est désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du BFF, jamais une URL, une query string, un en-tête, un identifiant ou une IP. Le nom du service vaut `bff-project` par défaut et se surcharge avec `OTEL_SERVICE_NAME`. `OTEL_RESOURCE_ATTRIBUTES` porte des attributs comme `service.version` ou `deployment.environment.name`. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))

#### Changements de comportement
- Le contrat OpenAPI du BFF (`contracts/openapi.json`, `contracts/bff.d.ts`) documente désormais une réponse `429` (`ErrorResponse`) sur les opérations projets et tâches. Elle signale que la limite de débit de la Project API ou de la Core API est atteinte ; l'appelant doit réessayer après le délai de l'en-tête `Retry-After` (en secondes). Le diff est tronqué : le détail des routes concernées n'est pas entièrement visible. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- Les dépendances de contrats passent sur leurs versions prod : `@mairie360/core-api-openapi` 2.1.0 et `@mairie360/project-api-openapi` 1.1.0. Les fixtures de tests et les stacks docker-compose sont ajustées en conséquence. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))
- CI : 3 montées de version du workflow `mairie360/CICD` (v4.2.1 → v4.3.1) et transmission des secrets `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK` pour l'étape de journal des releases. (MAIR-571, [#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#218](https://github.com/mairie360/BFF_Project/pull/218))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
