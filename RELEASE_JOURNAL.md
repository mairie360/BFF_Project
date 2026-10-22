# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "b068de7ad69118493d43e19612c69ae2b7e2d4bc", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-10-22 09:07 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `b068de7` | 2026-10-22 09:07 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Technique
- Aucun changement de comportement visible pour les agents, le front ou les appelants de l'API : les modifications portent sur les tests d'intégration, la CI et la documentation. Le diff de #234 est tronqué, donc la fin du fichier `docker-compose-integration.yml` et le contenu complet de la collection Postman n'ont pas pu être vérifiés.
- Ajout d'un test d'intégration sur stack réelle : `./integration_test.sh` lance `docker-compose-integration.yml` et rejoue `tests/postman/collection.json` avec newman (parcours projets et tâches, `--bail`). Le workflow `promote-staging.yml` exige désormais ce test comme porte `integration_tests` avant la promotion en staging. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Mise à jour du workflow réutilisable mairie360/CICD de v4.4.3 à v4.5.0 dans `cicd.yml`, `promote-staging.yml` et `promote-prod.yml`. Correction de la documentation, qui citait v4.4.0 au lieu de v4.4.3 (docs en/fr). (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234) ; MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence dev → staging (en dev, pas encore en staging)

#### Technique
- Aucun changement de comportement visible pour les agents, le front ou les appelants de l'API : les modifications portent sur les tests d'intégration, la CI et la documentation. Le diff de #234 est tronqué, donc la fin du fichier `docker-compose-integration.yml` et le contenu complet de la collection Postman n'ont pas pu être vérifiés.
- Ajout d'un test d'intégration sur stack réelle : `./integration_test.sh` lance `docker-compose-integration.yml` et rejoue `tests/postman/collection.json` avec newman (parcours projets et tâches, `--bail`). Le workflow `promote-staging.yml` exige désormais ce test comme porte `integration_tests` avant la promotion en staging. (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234))
- Mise à jour du workflow réutilisable mairie360/CICD de v4.4.3 à v4.5.0 dans `cicd.yml`, `promote-staging.yml` et `promote-prod.yml`. Correction de la documentation, qui citait v4.4.0 au lieu de v4.4.3 (docs en/fr). (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234) ; MAIR-612, [#232](https://github.com/mairie360/BFF_Project/pull/232))

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
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
