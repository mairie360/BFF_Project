# Journal des releases — BFF_Project

<!-- release-journal-state {"dev": "df493215837c594160058b8c7800e1388c9806d5", "prod": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "prod_tag": "v1.1.0", "staging": "7a1180347136345128f6e55101ee5a9d8d56ec2e", "updated": {"dev": "2026-11-03 14:11 UTC", "prod": "2026-10-21 10:10 UTC", "staging": "2026-10-21 09:40 UTC"}} -->
> Tenu à jour par la CI (`mairie360/CICD`, action `release/release-journal`) à chaque passage en dev, staging et prod. Ne pas modifier à la main : le fichier est réécrit au passage suivant.

| Environnement | Version | Commit | Mis à jour |
| --- | --- | --- | --- |
| prod | v1.1.0 | `7a11803` | 2026-10-21 10:10 UTC |
| staging | — | `7a11803` | 2026-10-21 09:40 UTC |
| dev | — | `df49321` | 2026-11-03 14:11 UTC |

## Ajouté sur main depuis la dernière release prod (v1.1.0)

#### Changements de comportement

- Les jetons de session sont désormais vérifiés avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, contrôle de `iss` et `aud`). HS256 n'est accepté que tant que `JWT_SECRET` est défini (période de transition) : hors transition, un jeton HS256 reçoit 401 avant tout appel amont. Un appelant doit présenter un jeton signé par Core. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))
- Le BFF refuse de démarrer sans `JWT_PUBLIC_KEY`, ou si cette clé est mal formée (`assertStartupConfiguration()`). (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))

#### Corrections

- Un jeton HS256 signé avec le secret partagé par 12 services permettait de forger un jeton administrateur. Avant : accepté. Maintenant : refusé avec 401 sans appel amont, sauf pendant la transition où `JWT_SECRET` est défini. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))

#### Technique

- MAIR-680 : tests EdDSA et tests de refus (HS256, autre clé, absence d'`aud`), clé Ed25519 générée à chaque run par `stack_secrets.sh`, images core-api `dev-3b40c2a` et project-api `dev-4e63d9b` dans les stacks de test, scripts de test qui signent les jetons (le détail des stacks n'est pas vérifiable : diff tronqué).
- Épinglage par digest des images de test et des actions GitHub (Renovate, [#242](https://github.com/mairie360/BFF_Project/pull/242)) et passage des workflows à CICD v5.2.2 avec `ANTHROPIC_WORKSPACE_ID` (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241)).
- Images Node.js passées en 24.22.1 par digest, et `development.Dockerfile` exécute les étapes de build en tant que `node` (correctif de sécurité, [#235](https://github.com/mairie360/BFF_Project/pull/235)) ; `zod` passe de 4.6.2 à 4.6.7 ([#177](https://github.com/mairie360/BFF_Project/pull/177)).
- Stack de tests d'intégration newman sur les images réelles (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234)), stack de marqueur RGPD dans les journaux (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172)), checklist RGPD des PR (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177)) ; aucun de ces changements ne modifie le comportement du service.
- Documentation mise à jour (versions CICD, [#232](https://github.com/mairie360/BFF_Project/pull/232) ; [#241](https://github.com/mairie360/BFF_Project/pull/241) ; [#234](https://github.com/mairie360/BFF_Project/pull/234)).

## Différence dev → staging (en dev, pas encore en staging)

#### Changements de comportement

- Les jetons de session sont désormais vérifiés avec la clé publique Ed25519 de Core (`JWT_PUBLIC_KEY`, EdDSA sous le `kid` de Core, contrôle de `iss` et `aud`). HS256 n'est accepté que tant que `JWT_SECRET` est défini (période de transition) : hors transition, un jeton HS256 reçoit 401 avant tout appel amont. Un appelant doit présenter un jeton signé par Core. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))
- Le BFF refuse de démarrer sans `JWT_PUBLIC_KEY`, ou si cette clé est mal formée (`assertStartupConfiguration()`). (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))

#### Corrections

- Un jeton HS256 signé avec le secret partagé par 12 services permettait de forger un jeton administrateur. Avant : accepté. Maintenant : refusé avec 401 sans appel amont, sauf pendant la transition où `JWT_SECRET` est défini. (MAIR-680, [#246](https://github.com/mairie360/BFF_Project/pull/246))

#### Technique

- MAIR-680 : tests EdDSA et tests de refus (HS256, autre clé, absence d'`aud`), clé Ed25519 générée à chaque run par `stack_secrets.sh`, images core-api `dev-3b40c2a` et project-api `dev-4e63d9b` dans les stacks de test, scripts de test qui signent les jetons (le détail des stacks n'est pas vérifiable : diff tronqué).
- Épinglage par digest des images de test et des actions GitHub (Renovate, [#242](https://github.com/mairie360/BFF_Project/pull/242)) et passage des workflows à CICD v5.2.2 avec `ANTHROPIC_WORKSPACE_ID` (MAIR-771, [#241](https://github.com/mairie360/BFF_Project/pull/241)).
- Images Node.js passées en 24.22.1 par digest, et `development.Dockerfile` exécute les étapes de build en tant que `node` (correctif de sécurité, [#235](https://github.com/mairie360/BFF_Project/pull/235)) ; `zod` passe de 4.6.2 à 4.6.7 ([#177](https://github.com/mairie360/BFF_Project/pull/177)).
- Stack de tests d'intégration newman sur les images réelles (MAIR-262, [#234](https://github.com/mairie360/BFF_Project/pull/234)), stack de marqueur RGPD dans les journaux (MAIR-290, [#172](https://github.com/mairie360/BFF_Project/pull/172)), checklist RGPD des PR (MAIR-295, [#177](https://github.com/mairie360/BFF_Project/pull/177)) ; aucun de ces changements ne modifie le comportement du service.
- Documentation mise à jour (versions CICD, [#232](https://github.com/mairie360/BFF_Project/pull/232) ; [#241](https://github.com/mairie360/BFF_Project/pull/241) ; [#234](https://github.com/mairie360/BFF_Project/pull/234)).

## Différence staging → prod (en staging, pas encore en prod)

_Rien._

## Historique des passages

<!-- release-journal-history:start -->
| Date | Environnement | Version | Commit | Run |
| --- | --- | --- | --- | --- |
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
