import type { GetMeResponseView } from '@mairie360/core-api-openapi/model';
import { asCaller, callUpstream, HttpError, sessionRoles, sessionUserId } from '@mairie360/bffs-lib';
import type { NextFunction, Request, Response } from 'express';
import { coreApi } from '../clients/coreClient';

export const PROJECT_ROLES = ['Admin', 'Maire', 'Responsable', 'User', 'Guest'] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Identity of the caller in Core: read only by the routes that show or filter by it. */
export type ProjectUserProfile = {
  name: string;
  email: string;
  groups: Array<{ id?: number; name: string }>;
};

export type ProjectUserContext = {
  id: number;
  role: ProjectRole;
  roles: ProjectRole[];
  /** Name and groups from Core API `GET /api/v1/user/me/`, read at most once per request and only when called. */
  profile: () => Promise<ProjectUserProfile>;
};

/** Core API `GET /api/v1/user/me/` as read here: every field is checked before use. */
type CoreMe = Partial<Record<keyof GetMeResponseView, unknown>>;

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

/** The project roles among `names`, ordered from the widest (Admin) to the narrowest (Guest). */
function resolveRoles(names: readonly unknown[]): ProjectRole[] {
  const resolved = new Set(names.map(normalizeRole).filter((role): role is ProjectRole => role !== null));
  return PROJECT_ROLES.filter((role) => resolved.has(role));
}

/** Names of the roles Core lists (`roles`, or the deprecated `role` of an older Core). */
function coreRoleNames(me: CoreMe): unknown[] {
  return Array.isArray(me.roles) ? me.roles : [me.role];
}

function normalizeGroups(value: unknown): ProjectUserProfile['groups'] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((group) => {
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
 * The caller's Core profile. 401 before any call without a Bearer token, 503 when CORE_API_URL is missing; a Core
 * 401 (rejected session) is relayed, any other failure becomes a 502. Read from Core directly, never through BFF
 * User (MAIR-525). Idempotent read: retried once on a transient failure.
 */
async function readCoreMe(req: Request): Promise<CoreMe> {
  const { data } = await callUpstream('CORE_API', () => coreApi.getMe(asCaller('CORE_API', req, 5_000)), { declared: [401], retry: true });
  const body: unknown = data;
  // axios keeps the raw body when it is not parsable JSON.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(502, 'The CORE_API answer is invalid.');
  }
  return body as CoreMe;
}

function toProfile(me: CoreMe, id: number): ProjectUserProfile {
  const firstName = typeof me.first_name === 'string' ? me.first_name.trim() : '';
  const lastName = typeof me.last_name === 'string' ? me.last_name.trim() : '';
  return {
    name: `${firstName} ${lastName}`.trim() || `Utilisateur ${id}`,
    email: typeof me.email === 'string' ? me.email.trim() : '',
    groups: normalizeGroups(me.groups),
  };
}

/**
 * The caller's context. Their roles come from the verified token (`roles` claim, MAIR-529) without any call; for a
 * token issued before that claim, from Core's profile, which is then kept for `profile()`. The id is the `sub` of the
 * token `requireSession` verified (MAIR-474), never an id read from an answer.
 */
export async function loadProjectUserContext(req: Request): Promise<ProjectUserContext> {
  const id = sessionUserId(req);
  let me: Promise<CoreMe> | undefined;
  const readMe = () => (me ??= readCoreMe(req));
  const claimRoles = sessionRoles(req);
  const roles = resolveRoles(claimRoles ?? coreRoleNames(await readMe()));

  return {
    id,
    role: roles[0] ?? 'Guest',
    roles: roles.length > 0 ? roles : ['Guest'],
    profile: async () => toProfile(await readMe(), id),
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
