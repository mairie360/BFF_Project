import 'dotenv/config';
import axios from "axios";
import { getProjectAPIMairie360 } from "@mairie360/project-api-openapi/endpoints/projectAPIMairie360";
import { getAuthorizationHeader } from "../auth/token";

function getProjectApiBaseUrl(): string {
  const explicitBaseUrl = process.env.PROJECT_API_BASE_PATH?.trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, "");

  const configuredHost = (process.env.PROJECT_API_URL ?? "localhost").trim().replace(/\/+$/, "");
  const host = /^https?:\/\//i.test(configuredHost) ? configuredHost : `http://${configuredHost}`;
  const configuredPort = process.env.PROJECT_API_PORT?.trim();

  return configuredPort && !new URL(host).port ? `${host}:${configuredPort}` : host;
}

// 1. Axios instance dedicated to Project API
export const projectApiAxios = axios.create({
  baseURL: getProjectApiBaseUrl(),
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Forwards the caller's session of the current session-bound request. The availability probe of
// /check_apis runs outside any session, so it never carries an Authorization header.
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

// 2. Inject the instance into the orval-generated client
const projectClient = getProjectAPIMairie360(projectApiAxios);

export default projectClient;
