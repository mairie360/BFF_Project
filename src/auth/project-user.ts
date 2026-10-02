import 'dotenv/config';
import { isAxiosError } from 'axios';
import { buildErrorResponse, HttpError } from '@mairie360/bffs-lib';
import type { NextFunction, Request, Response } from 'express';
import { userBffClient } from '../clients/userBffClient';
import { getAuthorizationHeader, getBearerToken } from './token';

export const PROJECT_ROLES = ['Admin', 'Maire', 'Responsable', 'User', 'Guest'] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export type ProjectUserContext = {
  id: number;
  name: string;
  email: string;
  role: ProjectRole;
  roles: ProjectRole[];
  groups: Array<{ id?: number; name: string }>;
};

type UserBffResponse = {
  user?: {
    id?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    name?: unknown;
    email?: unknown;
    role?: unknown;
    roles?: unknown;
  };
  groups?: unknown;
  roles?: unknown;
};

const roleAliases: Record<string, ProjectRole> = {
  admin: 'Admin',
  administrateur: 'Admin',
  administrator: 'Admin',
  maire: 'Maire',
  mayor: 'Maire',
  responsable: 'Responsable',
  manager: 'Responsable',
  user: 'User',
  utilisateur: 'User',
  employe: 'User',
  employee: 'User',
  guest: 'Guest',
  invite: 'Guest',
};

function normalizeRole(value: unknown): ProjectRole | null {
  if (typeof value !== 'string') return null;

  const key = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^role/, '');

  return roleAliases[key] ?? null;
}

function roleValue(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return (value as { name?: unknown }).name;
  }
  return value;
}

function resolveRoles(body: UserBffResponse): ProjectRole[] {
  const rawRoles = [
    body.user?.role,
    ...(Array.isArray(body.user?.roles) ? body.user.roles : []),
    ...(Array.isArray(body.roles) ? body.roles : []),
  ];
  const resolved = new Set(
    rawRoles
      .map(roleValue)
      .map(normalizeRole)
      .filter((role): role is ProjectRole => role !== null),
  );

  return PROJECT_ROLES.filter((role) => resolved.has(role));
}

function readJwtUserId(token: string | undefined): number | null {
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as {
      sub?: unknown;
      user_id?: unknown;
      id?: unknown;
    };
    const candidate = payload.sub ?? payload.user_id ?? payload.id;
    const userId = Number(candidate);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

function normalizeGroups(value: unknown): ProjectUserContext['groups'] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((group) => {
    if (typeof group === 'string' && group.trim()) {
      return [{ name: group.trim() }];
    }
    if (typeof group !== 'object' || group === null) return [];

    const raw = group as { id?: unknown; name?: unknown };
    if (typeof raw.name !== 'string' || !raw.name.trim()) return [];
    const id = Number(raw.id);
    return [{
      ...(Number.isInteger(id) && id > 0 ? { id } : {}),
      name: raw.name.trim(),
    }];
  });
}

/**
 * BFF User base URL. The local default only applies outside production: a production BFF without
 * USER_BFF_URL must fail loudly instead of silently resolving sessions against localhost.
 */
export function getUserBffUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.USER_BFF_URL?.trim();
  if (!configured) {
    if (env.NODE_ENV === 'production') {
      console.error('[BFF Project] USER_BFF_URL is not configured');
      throw new HttpError(502, 'The user service is unavailable.');
    }
    return 'http://localhost:4000';
  }
  const url = new URL(/^https?:\/\//i.test(configured) ? configured : `http://${configured}`);
  return url.toString().replace(/\/+$/, '');
}

export async function loadProjectUserContext(): Promise<ProjectUserContext> {
  const authorization = getAuthorizationHeader();
  if (!authorization) throw new HttpError(401, 'Missing session.');

  let body: UserBffResponse;
  try {
    const response = await userBffClient.getMe({
      baseURL: getUserBffUrl(),
      headers: { Authorization: authorization },
      timeout: 5_000,
    });
    body = response.data as UserBffResponse;
  } catch (error) {
    if (!isAxiosError(error)) throw error;
    const status = error.response?.status;
    if (status === undefined) throw new HttpError(502, 'The user service is unavailable.');
    if (status === 401) throw new HttpError(401, 'The session has expired.');
    throw new HttpError(502, 'The user context is unavailable.');
  }

  // axios laisse le corps brut quand il n'est pas du JSON analysable.
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(502, 'The user context is unavailable.');
  }
  const roles = resolveRoles(body);
  const role = roles[0] ?? 'Guest';
  const explicitId = Number(body.user?.id);
  const id = Number.isInteger(explicitId) && explicitId > 0
    ? explicitId
    : readJwtUserId(getBearerToken());

  if (!id) {
    throw new HttpError(401, 'Unable to identify the signed-in user.');
  }

  const firstName = typeof body.user?.first_name === 'string' ? body.user.first_name.trim() : '';
  const lastName = typeof body.user?.last_name === 'string' ? body.user.last_name.trim() : '';
  const explicitName = typeof body.user?.name === 'string' ? body.user.name.trim() : '';
  const email = typeof body.user?.email === 'string' ? body.user.email.trim() : '';

  return {
    id,
    name: explicitName || `${firstName} ${lastName}`.trim() || `Utilisateur ${id}`,
    email,
    role,
    roles: roles.length > 0 ? roles : ['Guest'],
    groups: normalizeGroups(body.groups),
  };
}

export function isGlobalProjectRole(role: ProjectRole): boolean {
  return role === 'Admin' || role === 'Maire';
}

export function canManageProjects(role: ProjectRole): boolean {
  return isGlobalProjectRole(role) || role === 'Responsable';
}

export async function projectUserContextMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    res.locals.projectUser = await loadProjectUserContext();
    return next();
  } catch (error) {
    // Only the messages of the HttpErrors raised above are meant for the client.
    const failure = error instanceof HttpError ? error : new HttpError(502, 'The user context is unavailable.');
    return res.status(failure.status).json(buildErrorResponse(failure.code, failure.message));
  }
}

export function getProjectUserContext(res: Response): ProjectUserContext {
  const context = res.locals.projectUser as ProjectUserContext | undefined;
  if (!context) throw new HttpError(401, 'Missing user context.');
  return context;
}
