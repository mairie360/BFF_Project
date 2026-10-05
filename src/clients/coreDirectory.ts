import { getCoreAPIMairie360 } from '@mairie360/core-api-openapi/endpoints/coreAPIMairie360';
import type { DirectoryUser } from '@mairie360/core-api-openapi/model';
import { HttpError, INVALID_SESSION_MESSAGE } from '@mairie360/bffs-lib';
import axios, { type AxiosRequestConfig } from 'axios';
import { getAuthorizationHeader } from '../auth/token';

// The directory of agents comes from Core API, through the operations of its published contract
// (@mairie360/core-api-openapi): the BFF no longer reads the users and group_members tables.
const coreApiAxios = axios.create({ timeout: 5_000, headers: { Accept: 'application/json' } });

const coreApi = getCoreAPIMairie360(coreApiAxios);

function normalizeBaseUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

/** URL read again on every call: the environment may change without a restart. */
function coreBaseUrl(): string {
  const url = new URL(normalizeBaseUrl(process.env.CORE_API_URL ?? 'localhost'));
  if (!url.port && process.env.CORE_API_PORT) url.port = process.env.CORE_API_PORT;
  return url.toString().replace(/\/+$/, '');
}

/** Options of a call on behalf of the caller of the current session-bound request. */
function coreOptions(): AxiosRequestConfig {
  const authorization = getAuthorizationHeader();
  if (!authorization) throw new HttpError(401, INVALID_SESSION_MESSAGE);
  return { baseURL: coreBaseUrl(), headers: { Authorization: authorization } };
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
  await coreApi.health({ baseURL: coreBaseUrl(), timeout: 5_000 });
}
