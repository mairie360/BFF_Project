# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "6ef273847e34b54464b42baf886230d8a0a732e5", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-11-04 18:26 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `6ef2738` | 2026-11-04 18:26 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Changements de comportement

- Session JWT : le BFF ne vérifie plus les jetons avec le secret HS256 partagé, mais avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, contrôles `iss` / `aud`, `@mairie360/bffs-lib` 2.7.0). Avant : un jeton HS256 signé avec `JWT_SECRET` était accepté. Maintenant : il reçoit un 401 sans appel amont, sauf tant que `JWT_SECRET` reste défini (transition). Le démarrage échoue sans `JWT_PUBLIC_KEY` ou avec une clé mal formée, donc tout déploiement doit fournir la clé publique. Les appelants qui forgent des jetons HS256 cessent d'être acceptés. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))
- Conteneur de développement : `development.Dockerfile` exécute les étapes de build et le conteneur sous l'utilisateur `node` au lieu de root. ([#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique

- Tests d'intégration sur stack réelle : `docker-compose-integration.yml`, `integration_test.sh` et une collection Postman rejouée par newman. C'est la porte `integration_tests` de la promotion staging, qui bloque la promotion en cas d'échec. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Simulation RGPD avant prod : `gdpr-simulation.yaml`, `docker-compose-gdpr-simulation.yml` et `gdpr_simulation_test.sh`, qui rejouent des parcours avec des personas fictifs, purgent et vérifient la base, puis analysent les journaux ; dépend de Database#222. (MAIR-497, [#245](https://github.com/mairie360/BFF_Project/pull/245))
- Contrôles RGPD : workflows `cicd.yml`, `gdpr-pr.yml`, `promote-staging.yml` et `promote-prod.yml` alignés sur mairie360/CICD v5.2.2, `ANTHROPIC_WORKSPACE_ID` transmis, et test de garde `tests/mair-771-cicd-version.test.ts`. (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Checklist RGPD des PR : nouveau workflow `gdpr-pr.yml` qui contrôle la section « Données personnelles » de la description. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Test du marqueur de journaux (MAIR-290) : `gdpr-marker.yaml`, `docker-compose-gdpr-marker.yml` et `gdpr_marker_test.sh` vérifient qu'aucune donnée du marqueur n'apparaît dans les logs. Le code de journalisation était déjà sur main. ([#172](https://github.com/mairie360/BFF_Project/pull/172))
- Dépendances et images épinglées : `actions/checkout`, `actions/setup-node`, `curlimages/curl`, `grafana/k6`, `node`, `postgres`, `postman/newman`, `redis` et `zaproxy/zap-stable` épinglés par digest, et `zod` passé de 4.6.2 à 4.6.7. ([#242](https://github.com/mairie360/BFF_Project/pull/242), [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Node.js 24.22.1 : `Dockerfile`, `development.Dockerfile`, `contracts.yml` et `cicd.yml` pinnés sur cette version, avec digest. ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- Scripts de stack : `stack_secrets.sh` refuse une paire de clés qui n'est pas une paire Ed25519 valide, et `performance_test.sh` s'arrête si `mktemp -d` échoue. (MAIR-680, [#247](https://github.com/mairie360/BFF_Project/pull/247))
- Documentation : versions de CICD et de Node.js mises à jour dans `docs/en/technical.md` et `docs/fr/technical.md`. (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence dev → staging (en dev, pas encore en staging)

#### Changements de comportement

- Session JWT : le BFF ne vérifie plus les jetons avec le secret HS256 partagé, mais avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, contrôles `iss` / `aud`, `@mairie360/bffs-lib` 2.7.0). Avant : un jeton HS256 signé avec `JWT_SECRET` était accepté. Maintenant : il reçoit un 401 sans appel amont, sauf tant que `JWT_SECRET` reste défini (transition). Le démarrage échoue sans `JWT_PUBLIC_KEY` ou avec une clé mal formée, donc tout déploiement doit fournir la clé publique. Les appelants qui forgent des jetons HS256 cessent d'être acceptés. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))
- Conteneur de développement : `development.Dockerfile` exécute les étapes de build et le conteneur sous l'utilisateur `node` au lieu de root. ([#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique

- Tests d'intégration sur stack réelle : `docker-compose-integration.yml`, `integration_test.sh` et une collection Postman rejouée par newman. C'est la porte `integration_tests` de la promotion staging, qui bloque la promotion en cas d'échec. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Simulation RGPD avant prod : `gdpr-simulation.yaml`, `docker-compose-gdpr-simulation.yml` et `gdpr_simulation_test.sh`, qui rejouent des parcours avec des personas fictifs, purgent et vérifient la base, puis analysent les journaux ; dépend de Database#222. (MAIR-497, [#245](https://github.com/mairie360/BFF_Project/pull/245))
- Contrôles RGPD : workflows `cicd.yml`, `gdpr-pr.yml`, `promote-staging.yml` et `promote-prod.yml` alignés sur mairie360/CICD v5.2.2, `ANTHROPIC_WORKSPACE_ID` transmis, et test de garde `tests/mair-771-cicd-version.test.ts`. (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Checklist RGPD des PR : nouveau workflow `gdpr-pr.yml` qui contrôle la section « Données personnelles » de la description. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Test du marqueur de journaux (MAIR-290) : `gdpr-marker.yaml`, `docker-compose-gdpr-marker.yml` et `gdpr_marker_test.sh` vérifient qu'aucune donnée du marqueur n'apparaît dans les logs. Le code de journalisation était déjà sur main. ([#172](https://github.com/mairie360/BFF_Project/pull/172))
- Dépendances et images épinglées : `actions/checkout`, `actions/setup-node`, `curlimages/curl`, `grafana/k6`, `node`, `postgres`, `postman/newman`, `redis` et `zaproxy/zap-stable` épinglés par digest, et `zod` passé de 4.6.2 à 4.6.7. ([#242](https://github.com/mairie360/BFF_Project/pull/242), [#177](https://github.com/mairie360/BFF_Project/pull/177))
- Node.js 24.22.1 : `Dockerfile`, `development.Dockerfile`, `contracts.yml` et `cicd.yml` pinnés sur cette version, avec digest. ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- Scripts de stack : `stack_secrets.sh` refuse une paire de clés qui n'est pas une paire Ed25519 valide, et `performance_test.sh` s'arrête si `mktemp -d` échoue. (MAIR-680, [#247](https://github.com/mairie360/BFF_Project/pull/247))
- Documentation : versions de CICD et de Node.js mises à jour dans `docs/en/technical.md` et `docs/fr/technical.md`. (MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-11-04 18:26 UTC | dev | — | `6ef2738` | [run](https://github.com/mairie360/BFF_Project/actions/runs/41883056590) |
| 2026-11-03 14:32 UTC | dev | — | `062dc11` | [run](https://github.com/mairie360/BFF_Project/actions/runs/41654043871) |
| 2026-11-03 14:11 UTC | dev | — | `df49321` | [run](https://github.com/mairie360/BFF_Project/actions/runs/41650540244) |
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
