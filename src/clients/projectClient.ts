import axios from 'axios';
import { getProjectAPIMairie360 } from '@mairie360/project-api-openapi/endpoints/projectAPIMairie360';

// Project API is only called through the operations of its published contract
// (@mairie360/project-api-openapi). Instance-level headers only: the base URL, the timeout and the caller's
// session are passed on every call (`asCaller` / `withoutSession` from @mairie360/bffs-lib).
const projectApiAxios = axios.create({ headers: { 'Content-Type': 'application/json' } });

export const projectApi = getProjectAPIMairie360(projectApiAxios);
