# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "062dc112f6406394cbe0ff1ebd6524c7c90a6928", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-11-03 14:32 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `062dc11` | 2026-11-03 14:32 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Changements de comportement
- Les jetons de session sont désormais vérifiés avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, `iss`, `aud`). Un jeton HS256 n'est accepté que tant que `JWT_SECRET` est défini (transition). Les stacks de test ne définissent plus `JWT_SECRET`, donc un jeton HS256 y reçoit un 401 sans appel amont. Le démarrage échoue sans `JWT_PUBLIC_KEY` valide (`assertStartupConfiguration()`). Un appelant qui signe encore en HS256 doit passer à EdDSA. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246), bffs-lib 2.7.0 selon la PR)

#### Technique
- Les scripts `stack_secrets.sh` génèrent une paire Ed25519 par run, vérifiée à l'entrée (PEM valides, clé privée Ed25519, paire appariée). `performance_test.sh` s'arrête proprement si `mktemp -d` échoue. (MAIR-680, [#247](https://github.com/mairie360/BFF_Project/pull/247))
- Tests d'intégration sur stack réelle : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman rejouée par newman, rapport junit, porte bloquante de la promotion staging. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Marqueur RGPD dans les journaux : `gdpr-marker.yaml`, `docker-compose-gdpr-marker.yml`, `gdpr_marker_test.sh`. (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172))
- Checklist RGPD sur les pull requests (workflow `gdpr-pr.yml`) et mise à jour de `zod` en 4.6.7. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- CICD monté en v5.2.2 dans `cicd.yml`, `gdpr-pr.yml`, `promote-staging.yml` et `promote-prod.yml`, avec `ANTHROPIC_WORKSPACE_ID` transmis. Test de garde sur la version. (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Images Docker et services de test épinglés par digest, et runtime Node.js passé à 24.22.1 (`Dockerfile`, `development.Dockerfile`, où le conteneur de dev exécute désormais l'étape de build en tant qu'utilisateur `node`). ([#235](https://github.com/mairie360/BFF_Project/pull/235), [#242](https://github.com/mairie360/BFF_Project/pull/242))
- Documentation technique alignée sur CICD v4.4.3 puis v5.2.2. ([#232](https://github.com/mairie360/BFF_Project/pull/232), [#241](https://github.com/mairie360/BFF_Project/pull/241))

## Différence dev → staging (en dev, pas encore en staging)

#### Changements de comportement
- Les jetons de session sont désormais vérifiés avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, `iss`, `aud`). Un jeton HS256 n'est accepté que tant que `JWT_SECRET` est défini (transition). Les stacks de test ne définissent plus `JWT_SECRET`, donc un jeton HS256 y reçoit un 401 sans appel amont. Le démarrage échoue sans `JWT_PUBLIC_KEY` valide (`assertStartupConfiguration()`). Un appelant qui signe encore en HS256 doit passer à EdDSA. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246), bffs-lib 2.7.0 selon la PR)

#### Technique
- Les scripts `stack_secrets.sh` génèrent une paire Ed25519 par run, vérifiée à l'entrée (PEM valides, clé privée Ed25519, paire appariée). `performance_test.sh` s'arrête proprement si `mktemp -d` échoue. (MAIR-680, [#247](https://github.com/mairie360/BFF_Project/pull/247))
- Tests d'intégration sur stack réelle : `docker-compose-integration.yml`, `integration_test.sh`, collection Postman rejouée par newman, rapport junit, porte bloquante de la promotion staging. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Marqueur RGPD dans les journaux : `gdpr-marker.yaml`, `docker-compose-gdpr-marker.yml`, `gdpr_marker_test.sh`. (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172))
- Checklist RGPD sur les pull requests (workflow `gdpr-pr.yml`) et mise à jour de `zod` en 4.6.7. (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177))
- CICD monté en v5.2.2 dans `cicd.yml`, `gdpr-pr.yml`, `promote-staging.yml` et `promote-prod.yml`, avec `ANTHROPIC_WORKSPACE_ID` transmis. Test de garde sur la version. (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241))
- Images Docker et services de test épinglés par digest, et runtime Node.js passé à 24.22.1 (`Dockerfile`, `development.Dockerfile`, où le conteneur de dev exécute désormais l'étape de build en tant qu'utilisateur `node`). ([#235](https://github.com/mairie360/BFF_Project/pull/235), [#242](https://github.com/mairie360/BFF_Project/pull/242))
- Documentation technique alignée sur CICD v4.4.3 puis v5.2.2. ([#232](https://github.com/mairie360/BFF_Project/pull/232), [#241](https://github.com/mairie360/BFF_Project/pull/241))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
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
