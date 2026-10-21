# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "3872bdb960cca6e93a5bb3d81fdf8c355cbe0f6e", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "b643e720f51e25126c93bb0286ec1bfd427327c5", "updated": {"dev": "2026-10-21 01:38 UTC", "staging": "2026-10-20 18:12 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `b643e72` | 2026-10-20 18:12 UTC |
| dev | — | `3872bdb` | 2026-10-21 01:38 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Le BFF exporte des traces et des métriques HTTP en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, la télémétrie reste désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du service : jamais d'URL, de query string, d'en-tête, d'identifiant ni d'IP. Les variables `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` et `OTEL_SDK_DISABLED` sont documentées. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- La spécification OpenAPI documente désormais une réponse `429` avec l'en-tête `Retry-After` sur les routes projets et tâches, lorsque Project API ou Core API atteint sa limite de débit. Le diff visible ne montre que le contrat : le comportement réel de `src/openapi-registry.ts` ne peut pas être vérifié (diff tronqué). (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Changements de comportement
- Un push sur `main` ne publie plus que dev : `cicd.yml` s'arrête à `release-dev`. Staging et prod ne se déclenchent plus automatiquement ; ils passent par les workflows manuels `promote-staging.yml` et `promote-prod.yml`, avec une entrée facultative `sha`. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))

#### Technique
- `mairie360/CICD` passe de v4.2.2 à v4.4.0 via les PR Renovate v4.2.2, v4.3.0, v4.3.1 et v4.3.2, puis la PR 228 ; `promote-*.yml` sont épinglés sur la même version. (#216, #219, #220, #223, #228)
- Le job de release de CICD v4.3.1 réécrit `RELEASE_JOURNAL.md` sur `main`. `cicd.yml` transmet désormais `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK`. (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218))
- `@mairie360/core-api-openapi` et `@mairie360/project-api-openapi` passent de builds prod (2.1.0 et 1.1.0) à des builds dev (MAIR-575, [#222](https://github.com/mairie360/BFF_Project/pull/222)), puis `core-api-openapi` à un build staging (MAIR-600, [#225](https://github.com/mairie360/BFF_Project/pull/225)) ; les images des stacks de test et `docker-compose.yml` suivent.
- Les fixtures de tests sont alignées sur les contrats 2.1.0 et 1.1.0 (`role` obligatoire, `todo` et `review` ajoutés), sans changement de code source. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))
- Documentation, `CLAUDE.md` et `renovate.json` mis à jour pour la promotion et le suivi des trois workflows. Le lockfile n'est pas dans le diff fourni, donc la mise à jour de `follow-redirects` annoncée dans la PR 228 n'est pas vérifiable ici.

## Différence dev → staging (en dev, pas encore en staging)

#### Nouveautés
- Nouveau workflow `promote-staging.yml`, lancé à la main (`gh workflow run promote-staging.yml`, avec `-f sha=SHA` pour un commit donné). Il n'accepte que des commits de `main` et ne tourne qu'un à la fois par cible. La documentation indique qu'il refuse un commit sans image `dev-<sha>` ni run vert sur `main`, puis lance les tests ZAP et k6 sur cette image. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))

#### Changements de comportement
- Un push sur `main` ne déclenche plus que `release-dev` : les runs ne restent plus en attente sur les environnements `Staging` et `Prod`. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))

#### Technique
- `cicd.yml` passe de `mairie360/CICD` v4.3.2 à v4.4.0 (`cicd_version` compris). (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))
- Ajout de `promote-prod.yml`, épinglé sur la même version de CICD, avec l'environnement `Prod` et un verrou par cible. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))
- `renovate.json` couvre les trois fichiers workflow ; `CLAUDE.md` et les docs FR/EN décrivent la promotion. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))

## Différence staging → prod (en staging, pas encore en prod)

#### Nouveautés
- Le BFF exporte des traces et des métriques HTTP en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, la télémétrie reste désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte appelé sortent du service. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- La spécification OpenAPI documente une réponse `429` avec l'en-tête `Retry-After` sur les routes projets et tâches, lorsque Project API ou Core API atteint sa limite de débit. Le comportement réel du code ne peut pas être vérifié (diff tronqué). (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- `cicd.yml` et les workflows de promotion pointent sur `mairie360/CICD` v4.4.0 ; le job de release de CICD réécrit `RELEASE_JOURNAL.md` sur `main`, et `cicd.yml` transmet `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK`. (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218), [#228](https://github.com/mairie360/BFF_Project/pull/228))
- `@mairie360/core-api-openapi` passe au build staging `0.0.0-staging.b900797` et `@mairie360/project-api-openapi` reste sur le build dev `0.0.0-dev-be2b410` ; les images des stacks de test suivent. (MAIR-600, [#225](https://github.com/mairie360/BFF_Project/pull/225), MAIR-575, [#222](https://github.com/mairie360/BFF_Project/pull/222))
- Les fixtures de tests sont alignées sur les contrats 2.1.0 et 1.1.0 (`role` obligatoire, `todo` et `review` ajoutés), sans changement de code source. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-21 01:38 UTC | dev | — | `3872bdb` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39528039459) |
| 2026-10-20 18:12 UTC | staging | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 17:56 UTC | dev | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 13:07 UTC | dev | — | `1c2e664` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427404719) |
| 2026-10-20 13:05 UTC | dev | — | `2b5c84c` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427122187) |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
