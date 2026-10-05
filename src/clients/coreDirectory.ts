import { getCoreAPIMairie360 } from '@mairie360/core-api-openapi/endpoints/coreAPIMairie360';
import type { DirectoryUser } from '@mairie360/core-api-openapi/model';
import { baseUrl, HttpError, INVALID_SESSION_MESSAGE } from '@mairie360/bffs-lib';
import axios, { type AxiosRequestConfig } from 'axios';
import { getAuthorizationHeader } from '../auth/token';

// The directory of agents comes from Core API, through the operations of its published contract
// (@mairie360/core-api-openapi): the BFF no longer reads the users and group_members tables.
const coreApiAxios = axios.create({ timeout: 5_000, headers: { Accept: 'application/json' } });

const coreApi = getCoreAPIMairie360(coreApiAxios);

/** Options of a call on behalf of the caller of the current session-bound request. */
function coreOptions(): AxiosRequestConfig {
  const authorization = getAuthorizationHeader();
  if (!authorization) throw new HttpError(401, INVALID_SESSION_MESSAGE);
  // CORE_API_URL (+ CORE_API_PORT) is read on every call: 503 when it is missing.
  return { baseURL: baseUrl('CORE_API'), headers: { Authorization: authorization } };
}

/** Non-archived agents, optionally restricted to some groups. */
export async function listDirectoryUsers(
  filters: { groupIds?: number[] } = {},
): Promise<DirectoryUser[]> {
  const { data } = await coreApi.listDirectoryUsers(
    filters.groupIds?.length ? { group_ids: filters.groupIds.join(',') } : {},
    coreOptions(),
  );

  return data.users;
}

/** Availability probe of `/check_apis`: never forwards a session. */
export async function checkCoreApi(): Promise<void> {
  await coreApi.health({ baseURL: baseUrl('CORE_API'), timeout: 5_000 });
}
