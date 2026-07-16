import 'dotenv/config';
import axios from "axios";
import { getProjectApi } from "@mairie360/project-api-openapi/endpoints/projectApi";
import { getAuthorizationHeader } from "../auth/token";

function getProjectApiBaseUrl(): string {
  const explicitBaseUrl = process.env.PROJECT_API_BASE_PATH?.trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, "");

  const configuredHost = (process.env.PROJECT_API_URL ?? "localhost").trim().replace(/\/+$/, "");
  const host = /^https?:\/\//i.test(configuredHost) ? configuredHost : `http://${configuredHost}`;
  const configuredPort = process.env.PROJECT_API_PORT?.trim();

  return configuredPort && !new URL(host).port ? `${host}:${configuredPort}` : host;
}

// 1. Créer l'instance Axios dédiée au service distant
export const projectApiAxios = axios.create({
  baseURL: getProjectApiBaseUrl(),
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Intercepteur pour injecter automatiquement le token
projectApiAxios.interceptors.request.use(
  (config) => {
    const authorization = getAuthorizationHeader();
    if (!config.headers.Authorization && authorization) {
      config.headers.Authorization = authorization;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 2. Injecter l'instance dans le code généré par Orval
const projectClient = getProjectApi(projectApiAxios);

export default projectClient;
