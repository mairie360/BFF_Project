# Bff_Template_Repo

## 🏗️ Dépôt Modèle pour Backend for Frontend (BFF)

Ce dépôt sert de point de départ pour créer une application BFF (Backend for Frontend) destinée à interagir avec différents microservices.

---

## ✨ Fonctionnalités

- Serveur basé sur **Express.js**
- Développement en **TypeScript** pour une meilleure sécurité et expérience
- Gestion des variables d’environnement avec **dotenv**
- Route de vérification de santé (health check) intégrée
- Support **Docker** pour la conteneurisation
- Gestion basique des erreurs

---

## ⚠️ Important

Avant de lancer l’application, pensez à définir la variable d’environnement `PORT`.

Créez un fichier `.env` à la racine du projet avec le contenu suivant :

```env
PORT=3000
```

## 🚀 Démarrage Rapide

```bash
# Construire l'image Docker
docker build -t bff-template .

# Lancer le conteneur
docker run -p 3000:3000 --env-file .env bff-template