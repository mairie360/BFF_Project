import axios from "axios";
import { getProjectApi } from "@mairie360/project-api-openapi/endpoints/projectApi";
import { DEFAULT_JWT_TOKEN } from "../config/token"; // <-- Importation de ton fichier TS

// 1. Créer l'instance Axios dédiée au service distant
const apiClientInstance = axios.create({
  baseURL: process.env.PROJECT_API_BASE_PATH || "http://localhost:8080",
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Intercepteur pour injecter automatiquement le token
apiClientInstance.interceptors.request.use(
  (config) => {
    const currentAuth = config.headers.Authorization;

    // Si aucun token n'est fourni par l'appel Orval, on met celui par défaut
    if (!currentAuth && DEFAULT_JWT_TOKEN) {
      config.headers.Authorization = DEFAULT_JWT_TOKEN.startsWith("Bearer ")
        ? DEFAULT_JWT_TOKEN
        : `Bearer ${DEFAULT_JWT_TOKEN}`;
    }

    console.log("Requête sortante vers :", config.baseURL + "" + config.url);
    return config; // <-- TRÈS IMPORTANT : Si cette ligne manque, Axios bloque !
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 2. Injecter l'instance dans le code généré par Orval
const projectClient = getProjectApi(apiClientInstance);

console.log("Project API Base Path:", process.env.PROJECT_API_BASE_PATH);

export default projectClient;
