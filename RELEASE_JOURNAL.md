# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod": "dfbdc37e4c8ba5e329bb6c3b875bf5271df7871b", "prod_tag": "v1.0.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-10-21 09:32 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.0.0 | `dfbdc37` | — |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `7a11803` | 2026-10-21 09:32 UTC |

## Ajouté sur main depuis la dernière release prod (v1.0.0)

#### Nouveautés
- Télémétrie OpenTelemetry : le BFF exporte ses traces et ses métriques HTTP en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, la télémétrie reste désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte de l'API appelée sont exportés, jamais d'URL, de query string, d'en-tête, d'identifiant ni d'IP. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI documente une réponse `429` avec l'en-tête `Retry-After` sur les opérations projets et tâches, lorsque Project API ou Core API signale une limite de débit atteinte. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Changements de comportement
- Un push sur `main` ne déploie plus ni staging ni prod : `cicd.yml` s'arrête à `release-dev`. Staging et prod se lancent à la main via `promote-staging.yml` puis `promote-prod.yml` (`-f sha=SHA` pour un commit donné), avec l'approbation des environnements `Staging` et `Prod`. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))

#### Technique
- Contrats OpenAPI amont : `@mairie360/core-api-openapi` passe à `2.2.0` et `@mairie360/project-api-openapi` à `1.2.0`. Les images des stacks de test et `database` / `liquibase-migrations` sont alignées sur leurs versions de prod (`database` 3.3.0). (MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230))
- CI : mairie360/CICD passe de v4.2.1 à v4.4.3 via Renovate ([#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#223](https://github.com/mairie360/BFF_Project/pull/223)). `cicd.yml` ne se déclenche sur push que pour `main`, et les secrets du journal de release sont transmis. (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218), [#230](https://github.com/mairie360/BFF_Project/pull/230))
- `follow-redirects` passe à 1.16.1 dans le lockfile pour corriger deux avis `npm audit` (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c). ([#228](https://github.com/mairie360/BFF_Project/pull/228))
- Documentation technique (FR/EN), `CLAUDE.md` et `renovate.json` mis à jour pour la télémétrie et la promotion. ([#180](https://github.com/mairie360/BFF_Project/pull/180), [#228](https://github.com/mairie360/BFF_Project/pull/228))

## Différence dev → staging (en dev, pas encore en staging)

_Rien._

## Différence staging → prod (en staging, pas encore en prod)

#### Nouveautés
- Télémétrie OpenTelemetry : le BFF exporte ses traces et ses métriques HTTP en OTLP vers `OTEL_EXPORTER_OTLP_ENDPOINT`. Sans cette variable, la télémétrie reste désactivée. Seuls la méthode, le statut, la route paramétrée et l'hôte de l'API appelée sont exportés, jamais d'URL, de query string, d'en-tête, d'identifiant ni d'IP. (MAIR-504, [#180](https://github.com/mairie360/BFF_Project/pull/180))
- Le contrat OpenAPI documente une réponse `429` avec l'en-tête `Retry-After` sur les opérations projets et tâches, lorsque Project API ou Core API signale une limite de débit atteinte. (MAIR-568, [#215](https://github.com/mairie360/BFF_Project/pull/215))

#### Changements de comportement
- Un push sur `main` ne déploie plus ni staging ni prod : `cicd.yml` s'arrête à `release-dev`. Staging et prod se lancent à la main via `promote-staging.yml` puis `promote-prod.yml` (`-f sha=SHA` pour un commit donné), avec l'approbation des environnements `Staging` et `Prod`. (MAIR-494, [#228](https://github.com/mairie360/BFF_Project/pull/228))

#### Technique
- Contrats OpenAPI amont : `@mairie360/core-api-openapi` passe à `2.2.0` et `@mairie360/project-api-openapi` à `1.2.0`. Les images des stacks de test et `database` / `liquibase-migrations` sont alignées sur leurs versions de prod (`database` 3.3.0). (MAIR-612, [#230](https://github.com/mairie360/BFF_Project/pull/230))
- CI : mairie360/CICD passe de v4.2.1 à v4.4.3 via Renovate ([#216](https://github.com/mairie360/BFF_Project/pull/216), [#219](https://github.com/mairie360/BFF_Project/pull/219), [#220](https://github.com/mairie360/BFF_Project/pull/220), [#223](https://github.com/mairie360/BFF_Project/pull/223)). `cicd.yml` ne se déclenche sur push que pour `main`, et les secrets du journal de release sont transmis. (MAIR-571, [#218](https://github.com/mairie360/BFF_Project/pull/218), [#230](https://github.com/mairie360/BFF_Project/pull/230))
- `follow-redirects` passe à 1.16.1 dans le lockfile pour corriger deux avis `npm audit` (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c). ([#228](https://github.com/mairie360/BFF_Project/pull/228))
- Documentation technique (FR/EN), `CLAUDE.md` et `renovate.json` mis à jour pour la télémétrie et la promotion. ([#180](https://github.com/mairie360/BFF_Project/pull/180), [#228](https://github.com/mairie360/BFF_Project/pull/228))

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-10-21 09:40 UTC | staging | — | `7a11803` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39577867631) |
| 2026-10-21 09:32 UTC | dev | — | `7a11803` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39577253428) |
| 2026-10-21 01:38 UTC | dev | — | `3872bdb` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39528039459) |
| 2026-10-20 18:12 UTC | staging | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 17:56 UTC | dev | — | `b643e72` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39469975837) |
| 2026-10-20 13:07 UTC | dev | — | `1c2e664` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427404719) |
| 2026-10-20 13:05 UTC | dev | — | `2b5c84c` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39427122187) |
| 2026-10-19 20:13 UTC | dev | — | `59f59dc` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39316556025) |
<!-- release-journal-history:end -->
