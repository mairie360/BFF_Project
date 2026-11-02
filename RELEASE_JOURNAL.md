# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "70b79fd4eb49594951a0f5b4cf738c9404a2fc16", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-11-02 22:59 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `70b79fd` | 2026-11-02 22:59 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Changements de comportement
- Le conteneur de développement `development.Dockerfile` exécute désormais l'étape de build avec l'utilisateur `node` (`chown -R node:node /app` puis `USER node`) au lieu de root : les écritures dans `/app` depuis ce conteneur se font avec `node`. L'image de production n'est pas concernée. (ef94461, [#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique
- Node.js passe de `24` à `24.22.1` dans `contracts.yml` et `cicd.yml`, et `Dockerfile` et `development.Dockerfile` utilisent `node:24.22.1-alpine` épinglé par digest (correctifs de sécurité d'octobre 2026). ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- Le pin de mairie360/CICD passe de v4.5.0 à v5.2.2 dans `cicd.yml`, `promote-staging.yml` et `promote-prod.yml`, et `gdpr-pr.yml` appelle v5.2.2 ; `ANTHROPIC_WORKSPACE_ID` est transmis avec `ANTHROPIC_API_KEY`. Un test jest `tests/mair-771-cicd-version.test.ts` vérifie l'alignement des versions (au moins v4.12.0). (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Nouveau workflow `gdpr-pr.yml` qui vérifie la checklist RGPD de chaque PR (section « Personal data » et inventaire), épinglé dans le diff sur v4.12.0 ; `zod` passe de 4.6.2 à 4.6.7 et `renovate.json` suit aussi `gdpr-pr.yml`. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Test du marqueur de données personnelles dans les journaux : ajout de `gdpr-marker.yaml`, `docker-compose-gdpr-marker.yml` et `gdpr_marker_test.sh`, ignorés par `.dockerignore` et `.gitignore`. Aucun changement de code applicatif. (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172))
- Tests d'intégration sur stack réelle : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman `tests/postman/` rejouée par newman, test jest `tests/integration-collection.test.ts`, et porte `integration_tests` de la promotion staging. Les workflows de CI passent de v4.4.3 à v4.5.0 dans cette PR. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Documentation : `docs/en/technical.md` et `docs/fr/technical.md` citent CICD v4.4.3 au lieu de v4.4.0. (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence dev → staging (en dev, pas encore en staging)

#### Changements de comportement
- Le conteneur de développement `development.Dockerfile` exécute désormais l'étape de build avec l'utilisateur `node` (`chown -R node:node /app` puis `USER node`) au lieu de root : les écritures dans `/app` depuis ce conteneur se font avec `node`. L'image de production n'est pas concernée. (ef94461, [#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique
- Node.js passe de `24` à `24.22.1` dans `contracts.yml` et `cicd.yml`, et `Dockerfile` et `development.Dockerfile` utilisent `node:24.22.1-alpine` épinglé par digest (correctifs de sécurité d'octobre 2026). ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- Le pin de mairie360/CICD passe de v4.5.0 à v5.2.2 dans `cicd.yml`, `promote-staging.yml` et `promote-prod.yml`, et `gdpr-pr.yml` appelle v5.2.2 ; `ANTHROPIC_WORKSPACE_ID` est transmis avec `ANTHROPIC_API_KEY`. Un test jest `tests/mair-771-cicd-version.test.ts` vérifie l'alignement des versions (au moins v4.12.0). (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Nouveau workflow `gdpr-pr.yml` qui vérifie la checklist RGPD de chaque PR (section « Personal data » et inventaire), épinglé dans le diff sur v4.12.0 ; `zod` passe de 4.6.2 à 4.6.7 et `renovate.json` suit aussi `gdpr-pr.yml`. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Test du marqueur de données personnelles dans les journaux : ajout de `gdpr-marker.yaml`, `docker-compose-gdpr-marker.yml` et `gdpr_marker_test.sh`, ignorés par `.dockerignore` et `.gitignore`. Aucun changement de code applicatif. (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172))
- Tests d'intégration sur stack réelle : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman `tests/postman/` rejouée par newman, test jest `tests/integration-collection.test.ts`, et porte `integration_tests` de la promotion staging. Les workflows de CI passent de v4.4.3 à v4.5.0 dans cette PR. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Documentation : `docs/en/technical.md` et `docs/fr/technical.md` citent CICD v4.4.3 au lieu de v4.4.0. (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
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
