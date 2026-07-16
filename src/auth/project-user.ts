import 'dotenv/config';
import type { NextFunction, Request, Response } from 'express';
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

function getUserBffUrl(): string {
  return (process.env.USER_BFF_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}

export class ProjectIdentityError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ProjectIdentityError';
  }
}

export async function loadProjectUserContext(): Promise<ProjectUserContext> {
  const authorization = getAuthorizationHeader();
  if (!authorization) throw new ProjectIdentityError(401, 'Session manquante.');

  let response: globalThis.Response;
  try {
    response = await fetch(`${getUserBffUrl()}/me`, {
      headers: { Accept: 'application/json', Authorization: authorization },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new ProjectIdentityError(502, 'Le service utilisateur est indisponible.');
  }

  if (response.status === 401) {
    throw new ProjectIdentityError(401, 'La session a expiré.');
  }
  if (!response.ok) {
    throw new ProjectIdentityError(502, 'Le contexte utilisateur est indisponible.');
  }

  const body = (await response.json()) as UserBffResponse;
  const roles = resolveRoles(body);
  const role = roles[0] ?? 'Guest';
  const explicitId = Number(body.user?.id);
  const id = Number.isInteger(explicitId) && explicitId > 0
    ? explicitId
    : readJwtUserId(getBearerToken());

  if (!id) {
    throw new ProjectIdentityError(401, 'Impossible d’identifier l’utilisateur connecté.');
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
    const status = error instanceof ProjectIdentityError ? error.status : 502;
    const message = error instanceof Error ? error.message : 'Le contexte utilisateur est indisponible.';
    return res.status(status).json({
      error: {
        code: status === 401 ? 'UNAUTHORIZED' : 'BAD_GATEWAY',
        message,
        details: [],
      },
    });
  }
}

export function getProjectUserContext(res: Response): ProjectUserContext {
  const context = res.locals.projectUser as ProjectUserContext | undefined;
  if (!context) throw new ProjectIdentityError(401, 'Contexte utilisateur manquant.');
  return context;
}
