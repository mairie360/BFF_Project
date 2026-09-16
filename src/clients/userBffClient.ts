import { getBffUser } from '@mairie360/bff-user-openapi/endpoints/bffUser';
import axios from 'axios';

// La session de l'appelant est résolue par BFF User, via les opérations de son contrat publié
// (@mairie360/bff-user-openapi).
const userBffAxios = axios.create({ headers: { Accept: 'application/json' } });

export const userBffClient = getBffUser(userBffAxios);

export default userBffClient;
