# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "ef94461aae949c80313d87fe09b771fe6c49c28e", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-10-23 12:22 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `ef94461` | 2026-10-23 12:22 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Changements de comportement

- Le conteneur de développement (`development.Dockerfile`) exécute désormais ses étapes de build puis `npm run start` sous l'utilisateur `node` au lieu de root, `/app` étant attribué à `node:node`. (vérifié dans le diff, [#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique

- Node.js passe à 24.22.1 (correctifs de sécurité d'octobre 2026) dans les images `Dockerfile` et `development.Dockerfile`, épinglées par digest, et dans les workflows `contracts.yml` et `cicd.yml`. ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- Ajout de la suite de tests d'intégration (MAIR-262) : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman rejouée par newman et test jest `tests/integration-collection.test.ts`. En CI, le job `integration_tests` bloque désormais la promotion staging en cas d'échec ; sans effet sur l'API ni l'interface. ([#234](https://github.com/mairie360/BFF_Project/pull/234))
- `cicd.yml`, `promote-staging.yml` et `promote-prod.yml` passent à mairie360/CICD v4.5.0, donc la promotion prod utilise aussi cette version. ([#234](https://github.com/mairie360/BFF_Project/pull/234))
- Documentation : la référence mairie360/CICD passe de v4.4.0 à v4.4.3 dans les docs FR et EN (MAIR-612). ([#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence dev → staging (en dev, pas encore en staging)

#### Changements de comportement

- Le conteneur de développement (`development.Dockerfile`) exécute désormais ses étapes de build puis `npm run start` sous l'utilisateur `node` au lieu de root, `/app` étant attribué à `node:node`. (vérifié dans le diff, [#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique

- Node.js passe à 24.22.1 (correctifs de sécurité d'octobre 2026) dans les images `Dockerfile` et `development.Dockerfile`, épinglées par digest, et dans les workflows `contracts.yml` et `cicd.yml`. ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- Ajout de la suite de tests d'intégration (MAIR-262) : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman rejouée par newman et test jest `tests/integration-collection.test.ts`. En CI, le job `integration_tests` bloque désormais la promotion staging en cas d'échec ; sans effet sur l'API ni l'interface. ([#234](https://github.com/mairie360/BFF_Project/pull/234))
- `cicd.yml`, `promote-staging.yml` et `promote-prod.yml` passent à mairie360/CICD v4.5.0, donc la promotion prod utilise aussi cette version. ([#234](https://github.com/mairie360/BFF_Project/pull/234))
- Documentation : la référence mairie360/CICD passe de v4.4.0 à v4.4.3 dans les docs FR et EN (MAIR-612). ([#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
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
