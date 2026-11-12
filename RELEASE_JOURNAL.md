# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "599b001e242b489d3079c1f2ab3f0c1e745c50f6", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "599b001e242b489d3079c1f2ab3f0c1e745c50f6", "updated": {"dev": "2026-11-12 13:18 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-11-12 18:58 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `599b001` | 2026-11-12 18:58 UTC |
| dev | — | `599b001` | 2026-11-12 13:18 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

- fix(deps): MAIR-816 Release dev: align internal versions and deploy (#253) ([#253](https://github.com/mairie360/BFF_Project/pull/253))
- chore(deps): pin node.js to c86ecea (#249) ([#249](https://github.com/mairie360/BFF_Project/pull/249))
- feat: MAIR-497 GDPR - Usage simulation and AI review of logs and database before prod ([#245](https://github.com/mairie360/BFF_Project/pull/245))
- fix: MAIR-680 [Audit 23/10] Toutes les APIs et BFFs : remplacer le secret JWT HS256 partagé par 12 services (A1) ([#247](https://github.com/mairie360/BFF_Project/pull/247))
- fix: MAIR-680 [Audit 23/10] Toutes les APIs et BFFs : remplacer le secret JWT HS256 partagé par 12 services (A1) ([#246](https://github.com/mairie360/BFF_Project/pull/246))
- chore(deps): pin dependencies (#242) ([#242](https://github.com/mairie360/BFF_Project/pull/242))
- ci: MAIR-771 APIs, BFFs, Database : monter CICD en v5.2.2 pour activer les contrôles RGPD (#241) ([#241](https://github.com/mairie360/BFF_Project/pull/241))
- fix: MAIR-290 Détecter les données personnelles dans les journaux avec un test du marqueur (#172) ([#172](https://github.com/mairie360/BFF_Project/pull/172))
- ci: MAIR-295 Ajouter une checklist RGPD aux PR et des rappels d'échéances automatiques (#177) ([#177](https://github.com/mairie360/BFF_Project/pull/177))
- fix(security): patch Node.js runtime and toolchain (#235) ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- feat: MAIR-262 Tests d'intégration - Tests de fonctionnement des APIs, tests métier des BFFs et tests de régression (#234) ([#234](https://github.com/mairie360/BFF_Project/pull/234))
- docs: MAIR-612 Release prod: align internal versions and deploy (#232) ([#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence dev → staging (en dev, pas encore en staging)

_Rien._

## Différence staging → prod (en staging, pas encore en prod)

- fix(deps): MAIR-816 Release dev: align internal versions and deploy (#253) ([#253](https://github.com/mairie360/BFF_Project/pull/253))
- chore(deps): pin node.js to c86ecea (#249) ([#249](https://github.com/mairie360/BFF_Project/pull/249))
- feat: MAIR-497 GDPR - Usage simulation and AI review of logs and database before prod ([#245](https://github.com/mairie360/BFF_Project/pull/245))
- fix: MAIR-680 [Audit 23/10] Toutes les APIs et BFFs : remplacer le secret JWT HS256 partagé par 12 services (A1) ([#247](https://github.com/mairie360/BFF_Project/pull/247))
- fix: MAIR-680 [Audit 23/10] Toutes les APIs et BFFs : remplacer le secret JWT HS256 partagé par 12 services (A1) ([#246](https://github.com/mairie360/BFF_Project/pull/246))
- chore(deps): pin dependencies (#242) ([#242](https://github.com/mairie360/BFF_Project/pull/242))
- ci: MAIR-771 APIs, BFFs, Database : monter CICD en v5.2.2 pour activer les contrôles RGPD (#241) ([#241](https://github.com/mairie360/BFF_Project/pull/241))
- fix: MAIR-290 Détecter les données personnelles dans les journaux avec un test du marqueur (#172) ([#172](https://github.com/mairie360/BFF_Project/pull/172))
- ci: MAIR-295 Ajouter une checklist RGPD aux PR et des rappels d'échéances automatiques (#177) ([#177](https://github.com/mairie360/BFF_Project/pull/177))
- fix(security): patch Node.js runtime and toolchain (#235) ([#235](https://github.com/mairie360/BFF_Project/pull/235))
- feat: MAIR-262 Tests d'intégration - Tests de fonctionnement des APIs, tests métier des BFFs et tests de régression (#234) ([#234](https://github.com/mairie360/BFF_Project/pull/234))
- docs: MAIR-612 Release prod: align internal versions and deploy (#232) ([#232](https://github.com/mairie360/BFF_Project/pull/232))

> Résumé Claude indisponible pour ce passage : listes brutes des commits.

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
| 2026-11-12 18:58 UTC | staging | — | `599b001` | [run](https://github.com/mairie360/BFF_Project/actions/runs/43284378796) |
| 2026-11-12 13:18 UTC | dev | — | `599b001` | [run](https://github.com/mairie360/BFF_Project/actions/runs/43225199790) |
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
