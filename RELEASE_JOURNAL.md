# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "80fe61f96dd5a5fccc7bdc42677f06f6127b3c90", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-10-21 09:49 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `80fe61f` | 2026-10-21 09:49 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Télémétrie OpenTelemetry : si `OTEL_EXPORTER_OTLP_ENDPOINT` est défini, le BFF exporte en OTLP les traces (span serveur par route, spans des handlers, `traceparent` propagé vers les API amont) et les métriques HTTP. Sans cette variable, rien n'est exporté. Seuls la méthode, le statut, la route paramétrée et l'hôte amont sortent du BFF. Les variables `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` et `OTEL_SDK_DISABLED` sont documentées. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Contrat OpenAPI : les routes documentent désormais une réponse `429` (limite de débit atteinte côté Project API ou Core API) avec l'en-tête `Retry-After` en secondes. Le diff étant tronqué, la liste exacte des routes concernées n'est pas vérifiée. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- CI et déploiement : `cicd.yml` passe à mairie360/CICD v4.4.3 et ne se déclenche sur `push` que pour `main` (MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230)). Les promotions staging et prod deviennent deux workflows manuels, `promote-staging.yml` et `promote-prod.yml` (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228)). Les secrets `ANTHROPIC_API_KEY`, `RELEASE_APP_ID` et `RELEASE_APP_PK` sont transmis au workflow réutilisable (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218)).
- Dépendances : mises à jour Renovate de mairie360/CICD (v4.2.2, v4.3.0, v4.3.1, v4.3.2) (#216, #219, #220, #223), pins des contrats et des images de stacks de test alignés sur les versions de prod (MAIR-575, MAIR-600, MAIR-612, [#222](https://github.com/mairie360/BFF_Project/pull/222), [#225](https://github.com/mairie360/BFF_Project/pull/225), [#230](https://github.com/mairie360/BFF_Project/pull/230)), et `follow-redirects` 1.16.1 dans le lockfile pour `npm audit` (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228)).

## Différence dev → staging (en dev, pas encore en staging)

#### Technique
- Documentation : `docs/en/technical.md` et `docs/fr/technical.md` citent désormais mairie360/CICD v4.4.3 au lieu de v4.4.0 (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232)).

## Différence staging → prod (en staging, pas encore en prod)

#### Nouveautés
- Télémétrie OpenTelemetry : si `OTEL_EXPORTER_OTLP_ENDPOINT` est défini, le BFF exporte en OTLP les traces et les métriques HTTP, sans URL, query string, en-tête, identifiant ni IP. Sans cette variable, rien n'est exporté. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Contrat OpenAPI : les routes documentent désormais une réponse `429` avec l'en-tête `Retry-After`, côté Project API ou Core API. Le diff étant tronqué, la liste exacte des routes n'est pas vérifiée. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Technique
- CI et déploiement : `cicd.yml` passe à mairie360/CICD v4.4.3 et ne se déclenche sur `push` que pour `main` (MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230)). Les promotions staging et prod deviennent deux workflows manuels (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228)). Les secrets de release sont transmis au workflow réutilisable (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218)).
- Dépendances : mises à jour Renovate de mairie360/CICD (#216, #219, #220, #223), `@mairie360/core-api-openapi` et `@mairie360/project-api-openapi` alignés sur 2.2.0 et 1.2.0 avec les images de test correspondantes et `database` / `liquibase-migrations` en 3.3.0 (MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230)), et `follow-redirects` 1.16.1 pour `npm audit` (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228)).

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-21 09:49 UTC | dev | — | `80fe61f` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39579594700) |
| 2026-10-21 09:40 UTC | staging | — | `7a11803` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39577867631) |
| 2026-10-21 09:32 UTC | dev | — | `7a11803` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39577253428) |
| 2026-10-21 01:38 UTC | dev | — | `3872bdb` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39528039459) |
| 2026-10-20 18:12 UTC | staging | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 17:56 UTC | dev | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 13:07 UTC | dev | — | `1c2e664` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427404719) |
| 2026-10-20 13:05 UTC | dev | — | `2b5c84c` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427122187) |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
