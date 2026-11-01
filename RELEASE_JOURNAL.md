# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "d9ee4f71561c98c71947e1019f5cdfc7e6c2ddb7", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-11-01 12:35 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `d9ee4f7` | 2026-11-01 12:35 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Technique

- Tests et CI sans effet pour les utilisateurs : stack d'intégration `docker-compose-integration.yml` et `integration_test.sh` qui rejouent `tests/postman/collection.json` avec newman (porte `integration_tests` de la promotion staging, CICD passé en v4.5.0 dans `cicd.yml`, `promote-staging.yml` et `promote-prod.yml`), test de marqueur RGPD sur les journaux (`gdpr_marker_test.sh`, `gdpr-marker.yaml`) et check « GDPR checklist » sur les PR via `.github/workflows/gdpr-pr.yml`. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234) ; MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172) ; MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Dépendances, images et documentation : `zod` passé de 4.6.2 à 4.6.7 ; `Dockerfile` et `development.Dockerfile` basés sur `node:24.22.1-alpine` épinglé par digest, et le conteneur de développement exécute ses étapes avec l'utilisateur `node` ([#235](https://github.com/mairie360/BFF_Project/pull/235)) ; documentation alignée sur CICD v4.4.3 (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232)).

## Différence dev → staging (en dev, pas encore en staging)

#### Technique

- Tests et CI sans effet pour les utilisateurs : stack d'intégration `docker-compose-integration.yml` et `integration_test.sh` qui rejouent `tests/postman/collection.json` avec newman (porte `integration_tests` de la promotion staging, CICD passé en v4.5.0 dans `cicd.yml`, `promote-staging.yml` et `promote-prod.yml`), test de marqueur RGPD sur les journaux (`gdpr_marker_test.sh`, `gdpr-marker.yaml`) et check « GDPR checklist » sur les PR via `.github/workflows/gdpr-pr.yml`. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234) ; MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172) ; MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Dépendances, images et documentation : `zod` passé de 4.6.2 à 4.6.7 ; `Dockerfile` et `development.Dockerfile` basés sur `node:24.22.1-alpine` épinglé par digest, et le conteneur de développement exécute ses étapes avec l'utilisateur `node` ([#235](https://github.com/mairie360/BFF_Project/pull/235)) ; documentation alignée sur CICD v4.4.3 (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232)).

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-11-01 12:35 UTC | dev | — | `d9ee4f7` | [run](https://github.com/mairie360/BFF_Project/actions/runs/41306956380) |
| 2026-10-23 12:22 UTC | dev | — | `ef94461` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39952401205) |
| 2026-10-22 09:07 UTC | dev | — | `b068de7` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39752651631) |
| 2026-10-21 10:10 UTC | prod | v1.1.0 | `7a11803` | [run](https://github.com/mairie360/BFF_Project/actions/runs/39579245193) |
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
