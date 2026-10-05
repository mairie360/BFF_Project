import { getBffUser } from '@mairie360/bff-user-openapi/endpoints/bffUser';
import axios from 'axios';

// The caller's session is resolved by BFF User, through the operations of its published contract
// (@mairie360/bff-user-openapi). The base URL, the timeout and the session are passed on every call.
const userBffAxios = axios.create({ headers: { Accept: 'application/json' } });

export const userBffApi = getBffUser(userBffAxios);
