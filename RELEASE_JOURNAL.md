# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "6c889301930fd48ad13826d842532b869a6e33db", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-11-03 01:37 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `6c88930` | 2026-11-03 01:37 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Changements de comportement
- `development.Dockerfile` : l'image de développement exécute désormais `npm run start` et les étapes de build avec l'utilisateur `node` (`chown -R node:node /app` puis `USER node`) au lieu de l'utilisateur par défaut de l'image. Cela ne touche que le conteneur de développement. (sans clé Jira, [#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique
- Images Docker épinglées par digest dans les `docker-compose*.yml` (postgres, redis, curl, k6, newman, zap, node) et actions GitHub `actions/checkout` et `actions/setup-node` épinglées par SHA ; `zod` passe de 4.6.2 à 4.6.7 ; Node.js passe à 24.22.1 dans les jobs de CI et les `Dockerfile`. (sans clé Jira, [#242](https://github.com/mairie360/BFF_Project/pull/242) et [#235](https://github.com/mairie360/BFF_Project/pull/235))
- Workflows CI : `cicd.yml`, `promote-staging.yml`, `promote-prod.yml` et `gdpr-pr.yml` appellent mairie360/CICD en v5.2.2 (avant v4.5.0 ou v4.12.0), `ANTHROPIC_WORKSPACE_ID` est transmis, et un test jest garde la cohérence de version. (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Nouveau workflow `gdpr-pr.yml` qui vérifie la checklist RGPD de chaque PR, avec la règle `renovate.json` associée. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Tests d'intégration sur la stack réelle : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman newman, et porte `integration_tests` avant la promotion staging ; CICD passe en v4.5.0 dans ce commit. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Test de marqueur RGPD sur les journaux (`docker-compose-gdpr-marker.yml`, `gdpr-marker.yaml`, `gdpr_marker_test.sh`) ; le diff est tronqué, je n'ai pas pu vérifier l'intégralité de `gdpr_marker_test.sh` ni de `tests/projects.upstream-mocks.test.ts`. (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172))
- Documentation : `docs/en/technical.md` et `docs/fr/technical.md` mis à jour pour CICD et Node.js 24.22.1, et `CLAUDE.md` décrit les tests d'intégration. (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence dev → staging (en dev, pas encore en staging)

#### Changements de comportement
- `development.Dockerfile` : l'image de développement exécute désormais `npm run start` et les étapes de build avec l'utilisateur `node` (`chown -R node:node /app` puis `USER node`) au lieu de l'utilisateur par défaut de l'image. Cela ne touche que le conteneur de développement. (sans clé Jira, [#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique
- Images Docker épinglées par digest dans les `docker-compose*.yml` (postgres, redis, curl, k6, newman, zap, node) et actions GitHub `actions/checkout` et `actions/setup-node` épinglées par SHA ; `zod` passe de 4.6.2 à 4.6.7 ; Node.js passe à 24.22.1 dans les jobs de CI et les `Dockerfile`. (sans clé Jira, [#242](https://github.com/mairie360/BFF_Project/pull/242) et [#235](https://github.com/mairie360/BFF_Project/pull/235))
- Workflows CI : `cicd.yml`, `promote-staging.yml`, `promote-prod.yml` et `gdpr-pr.yml` appellent mairie360/CICD en v5.2.2 (avant v4.5.0 ou v4.12.0), `ANTHROPIC_WORKSPACE_ID` est transmis, et un test jest garde la cohérence de version. (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Nouveau workflow `gdpr-pr.yml` qui vérifie la checklist RGPD de chaque PR, avec la règle `renovate.json` associée. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Tests d'intégration sur la stack réelle : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman newman, et porte `integration_tests` avant la promotion staging ; CICD passe en v4.5.0 dans ce commit. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Test de marqueur RGPD sur les journaux (`docker-compose-gdpr-marker.yml`, `gdpr-marker.yaml`, `gdpr_marker_test.sh`) ; le diff est tronqué, je n'ai pas pu vérifier l'intégralité de `gdpr_marker_test.sh` ni de `tests/projects.upstream-mocks.test.ts`. (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172))
- Documentation : `docs/en/technical.md` et `docs/fr/technical.md` mis à jour pour CICD et Node.js 24.22.1, et `CLAUDE.md` décrit les tests d'intégration. (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-11-03 01:37 UTC | dev | — | `6c88930` | [run](https://github.com/mairie360/BFF_Project/actions/runs/41560423666) |
| 2026-11-02 22:59 UTC | dev | — | `70b79fd` | [run](https://github.com/mairie360/BFF_Project/actions/runs/41540009067) |
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
