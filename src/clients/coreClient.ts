import { getCoreAPIMairie360 } from '@mairie360/core-api-openapi/endpoints/coreAPIMairie360';
import axios from 'axios';

// Core API (directory of agents, availability probe) is only called through the operations of its published
// contract (@mairie360/core-api-openapi). The base URL, the timeout and the caller's session are passed on
// every call (`asCaller` / `withoutSession` from @mairie360/bffs-lib).
const coreApiAxios = axios.create({ headers: { Accept: 'application/json' } });

export const coreApi = getCoreAPIMairie360(coreApiAxios);
