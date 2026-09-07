# BFF_Project — Présentation du module

[Documentation technique](technical.md) · [English](../en/module.md) · [README](../../README.md)

Préparer les projets, tâches et informations de collaboration pour le suivi du travail municipal. Le BFF construit des réponses adaptées aux vues liste, tableau et Kanban, avec les permissions de la session.

## Public et utilité

Les agents affectés aux tâches, les responsables de projets et les administrateurs du périmètre municipal.

Domaine fonctionnel: Projets et tâches.

## Fonctions disponibles

- Page projets paginée avec résumé, membres, filtres et colonnes Kanban.
- Création, modification, duplication, clôture et suppression de projets; gestion des tâches et de leurs statuts.
- Détails de tâches, commentaires, historique et permissions adaptées au rôle.

## Parcours type

1. Résoudre la session avec BFF User et charger `/projects-page`.
2. Ouvrir un projet pour consulter ses tâches et les actions autorisées.
3. Effectuer une mutation puis utiliser les données renvoyées et recharger le contexte concerné.

## Place dans Mairie360

Dépôts associés: [Projects_Web_Service](https://github.com/mairie360/Projects_Web_Service).

Ce dépôt contient le serveur BFF et son contrat. Les web services associés portent les écrans; le BFF adapte les données et les règles serveur nécessaires à ces écrans.

## Données et état actuel

Le module combine Project API et PostgreSQL. Le dépôt SQL gère notamment visibilité, membres, projets, tâches et collaboration. Les commentaires et une partie de l’historique utilisent `tasks.custom_fields`; l’historique de statut peut venir de `task_history`. Avec `PROJECT_DB_ACCESS=disabled`, la collaboration utilise un repli mémoire perdu au redémarrage.

## Périmètre et limites

Désactiver l’accès SQL change les capacités et la persistance; ce mode ne constitue pas une validation d’un déploiement complet. Les identifiants publics et statuts sont normalisés par les helpers, tandis que certains champs de projet sont dérivés des tâches.

## Pour développer ou exploiter ce module

Le [guide technique](technical.md) détaille architecture, configuration, routes, session, persistance, tests et CI/CD. Il décrit les sources de vérité et les étapes de synchronisation des contrats avec les dépôts associés.
