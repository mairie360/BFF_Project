import axios from "axios";
import { baseUrl } from "@mairie360/bffs-lib";
import { getProjectAPIMairie360 } from "@mairie360/project-api-openapi/endpoints/projectAPIMairie360";
import { getAuthorizationHeader } from "../auth/token";

// 1. Axios instance dedicated to Project API: instance-level timeout and headers only. The base URL is
// not frozen at import: it is read from PROJECT_API_URL (+ PROJECT_API_PORT) on every call.
export const projectApiAxios = axios.create({
  timeout: 5000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Per call: the base URL (503 when PROJECT_API_URL is missing or invalid), and the caller's session of the
// current session-bound request. The availability probe of /check_apis runs outside any session, so it
// never carries an Authorization header.
projectApiAxios.interceptors.request.use(
  (config) => {
    config.baseURL ??= baseUrl("PROJECT_API");
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
