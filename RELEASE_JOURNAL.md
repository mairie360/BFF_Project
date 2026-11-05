# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "dda8c7b7b514464c0d17d92575ae7bd34dc126be", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-11-05 03:14 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `dda8c7b` | 2026-11-05 03:14 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Changements de comportement

- Authentification des sessions : le BFF vérifie désormais les jetons avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, `iss` et `aud`). Un jeton HS256 est refusé (401, sans appel amont) tant que `JWT_SECRET` n'est pas défini, ce qui ne vaut plus que pour la transition ; le démarrage échoue sans clé ou avec une clé mal formée (`assertStartupConfiguration()`). Les appelants qui signent en HS256 doivent passer à EdDSA. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))
- Image de développement (`development.Dockerfile`) : le conteneur exécute désormais l'application sous l'utilisateur `node` et non root, `/app` lui appartient. ([#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique

- Node.js passe à 24.22.1 (`Dockerfile`, `development.Dockerfile`, `contracts.yml`, `cicd.yml`), correctif de sécurité des runtimes d'octobre 2026, avec des images épinglées par digest ([#235](https://github.com/mairie360/BFF_Project/pull/235)). Les images `node`, `postgres`, `redis`, `curlimages/curl`, `grafana/k6`, `postman/newman`, `zaproxy` et les actions `checkout` et `setup-node` sont épinglées par digest ([#242](https://github.com/mairie360/BFF_Project/pull/242), [#249](https://github.com/mairie360/BFF_Project/pull/249)). `zod` passe de 4.6.2 à 4.6.7 ([#177](https://github.com/mairie360/BFF_Project/pull/177)).
- Workflows CI/CD : `mairie360/CICD` passe de v4.4.3 à v4.5.0 ([#234](https://github.com/mairie360/BFF_Project/pull/234)), puis à v5.2.2 ([#241](https://github.com/mairie360/BFF_Project/pull/241)), puis à v5.3.1 ([#245](https://github.com/mairie360/BFF_Project/pull/245)). Une checklist RGPD sur les PR ([#177](https://github.com/mairie360/BFF_Project/pull/177)), un test du marqueur de logs ([#172](https://github.com/mairie360/BFF_Project/pull/172)) et une simulation RGPD ([#245](https://github.com/mairie360/BFF_Project/pull/245)) sont ajoutés aux contrôles de promotion.
- Tests d'intégration sur la stack réelle (`integration_test.sh`, `docker-compose-integration.yml`, collection Postman avec `newman`) : bloquent la promotion staging en cas d'échec ([#234](https://github.com/mairie360/BFF_Project/pull/234)). Tests jest ajoutés pour MAIR-771 et MAIR-680 ([#241](https://github.com/mairie360/BFF_Project/pull/241), [#246](https://github.com/mairie360/BFF_Project/pull/246)).
- `stack_secrets.sh` génère une paire Ed25519 par run et refuse une paire qui n'est pas Ed25519 ou qui ne correspond pas ; `performance_test.sh` s'arrête si `mktemp -d` échoue ([#247](https://github.com/mairie360/BFF_Project/pull/247)).
- Documentation FR et EN mise à jour pour les versions CICD ([#232](https://github.com/mairie360/BFF_Project/pull/232), [#241](https://github.com/mairie360/BFF_Project/pull/241)).

## Différence dev → staging (en dev, pas encore en staging)

#### Changements de comportement

- Authentification des sessions : le BFF vérifie désormais les jetons avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, `iss` et `aud`). Un jeton HS256 est refusé (401, sans appel amont) tant que `JWT_SECRET` n'est pas défini, ce qui ne vaut plus que pour la transition ; le démarrage échoue sans clé ou avec une clé mal formée (`assertStartupConfiguration()`). Les appelants qui signent en HS256 doivent passer à EdDSA. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))
- Image de développement (`development.Dockerfile`) : le conteneur exécute désormais l'application sous l'utilisateur `node` et non root, `/app` lui appartient. ([#235](https://github.com/mairie360/BFF_Project/pull/235))

#### Technique

- Node.js passe à 24.22.1 (`Dockerfile`, `development.Dockerfile`, `contracts.yml`, `cicd.yml`), correctif de sécurité des runtimes d'octobre 2026, avec des images épinglées par digest ([#235](https://github.com/mairie360/BFF_Project/pull/235)). Les images `node`, `postgres`, `redis`, `curlimages/curl`, `grafana/k6`, `postman/newman`, `zaproxy` et les actions `checkout` et `setup-node` sont épinglées par digest ([#242](https://github.com/mairie360/BFF_Project/pull/242), [#249](https://github.com/mairie360/BFF_Project/pull/249)). `zod` passe de 4.6.2 à 4.6.7 ([#177](https://github.com/mairie360/BFF_Project/pull/177)).
- Workflows CI/CD : `mairie360/CICD` passe de v4.4.3 à v4.5.0 ([#234](https://github.com/mairie360/BFF_Project/pull/234)), puis à v5.2.2 ([#241](https://github.com/mairie360/BFF_Project/pull/241)), puis à v5.3.1 ([#245](https://github.com/mairie360/BFF_Project/pull/245)). Une checklist RGPD sur les PR ([#177](https://github.com/mairie360/BFF_Project/pull/177)), un test du marqueur de logs ([#172](https://github.com/mairie360/BFF_Project/pull/172)) et une simulation RGPD ([#245](https://github.com/mairie360/BFF_Project/pull/245)) sont ajoutés aux contrôles de promotion.
- Tests d'intégration sur la stack réelle (`integration_test.sh`, `docker-compose-integration.yml`, collection Postman avec `newman`) : bloquent la promotion staging en cas d'échec ([#234](https://github.com/mairie360/BFF_Project/pull/234)). Tests jest ajoutés pour MAIR-771 et MAIR-680 ([#241](https://github.com/mairie360/BFF_Project/pull/241), [#246](https://github.com/mairie360/BFF_Project/pull/246)).
- `stack_secrets.sh` génère une paire Ed25519 par run et refuse une paire qui n'est pas Ed25519 ou qui ne correspond pas ; `performance_test.sh` s'arrête si `mktemp -d` échoue ([#247](https://github.com/mairie360/BFF_Project/pull/247)).
- Documentation FR et EN mise à jour pour les versions CICD ([#232](https://github.com/mairie360/BFF_Project/pull/232), [#241](https://github.com/mairie360/BFF_Project/pull/241)).

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-11-05 03:14 UTC | dev | — | `dda8c7b` | [run](https://github.com/mairie360/BFF_Project/actions/runs/41959913610) |
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
