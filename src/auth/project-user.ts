import { asCaller, authorization, callUpstream, HttpError, unverifiedSubject } from '@mairie360/bffs-lib';
import type { NextFunction, Request, Response } from 'express';
import { userBffApi } from '../clients/userBffClient';

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

export async function loadProjectUserContext(req: Pick<Request, 'headers'>): Promise<ProjectUserContext> {
  // 401 before any upstream call when the request carries no Bearer token, 503 when USER_BFF_URL is missing;
  // a BFF User 401 (rejected session) is relayed, any other failure becomes a 502.
  const { data } = await callUpstream('USER_BFF', () => userBffApi.getMe(asCaller('USER_BFF', req, 5_000)), { declared: [401] });
  const body = data as UserBffResponse;

  // axios keeps the raw body when it is not parsable JSON.
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(502, 'The USER_BFF answer is invalid.');
  }
  const roles = resolveRoles(body);
  const role = roles[0] ?? 'Guest';
  const explicitId = Number(body.user?.id);
  // BFF User has just accepted this token, so its `sub` is only read (unverified) to identify the caller
  // when /me does not return `user.id` (optional in its contract).
  const id = Number.isInteger(explicitId) && explicitId > 0
    ? explicitId
    : unverifiedSubject(authorization(req));

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

/** Resolves the caller's session once per request; failures end in the app's `errorHandler`. */
export async function projectUserContextMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.locals.projectUser = await loadProjectUserContext(req);
    next();
  } catch (error) {
    next(error);
  }
}

export function getProjectUserContext(res: Response): ProjectUserContext {
  const context = res.locals.projectUser as ProjectUserContext | undefined;
  if (!context) throw new HttpError(401, 'Missing user context.');
  return context;
}
