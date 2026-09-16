import { getCoreApi } from '@mairie360/core-api-openapi/endpoints/coreApi';
import type { DirectoryUser } from '@mairie360/core-api-openapi/model';
import axios, { type AxiosRequestConfig } from 'axios';
import { getAuthorizationHeader } from '../auth/token';

// L'annuaire des agents vient de Core API, par les opérations de son contrat publié
// (@mairie360/core-api-openapi) : le BFF n'interroge plus les tables users et group_members.
const coreApiAxios = axios.create({ timeout: 5_000, headers: { Accept: 'application/json' } });

const coreApi = getCoreApi(coreApiAxios);

function normalizeBaseUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

/** URL relue à chaque appel : les variables d'environnement peuvent changer sans redémarrage. */
function coreOptions(): AxiosRequestConfig {
  const url = new URL(normalizeBaseUrl(process.env.CORE_API_URL ?? 'localhost'));
  if (!url.port && process.env.CORE_API_PORT) url.port = process.env.CORE_API_PORT;
  const authorization = getAuthorizationHeader();

  return {
    baseURL: url.toString().replace(/\/+$/, ''),
    ...(authorization ? { headers: { Authorization: authorization } } : {}),
  };
}

/** Agents non archivés, éventuellement restreints à des groupes. */
export async function listDirectoryUsers(
  filters: { groupIds?: number[] } = {},
): Promise<DirectoryUser[]> {
  const { data } = await coreApi.listDirectoryUsers(
    filters.groupIds?.length ? { group_ids: filters.groupIds.join(',') } : {},
    coreOptions(),
  );

  return data.users;
}

export async function checkCoreApi(): Promise<void> {
  await coreApi.health({ ...coreOptions(), timeout: 5_000 });
}
