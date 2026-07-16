import type { Response } from 'express';
import { canManageProjects, getProjectUserContext, isGlobalProjectRole, type ProjectUserContext } from '../../auth/project-user';
import { getProjectPermissions, getTaskPermissions, listAssignableUsers } from '../../repositories/projectRepository';

function sendAccessError(res: Response, status: 403 | 404, message: string): null {
  res.status(status).json({
    error: {
      code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
      message,
      details: [],
    },
  });
  return null;
}

export function requireManagerRole(res: Response): ProjectUserContext | null {
  const user = getProjectUserContext(res);
  if (!canManageProjects(user.role)) {
    return sendAccessError(res, 403, 'Le rôle Responsable, Maire ou Admin est requis.');
  }
  return user;
}

export async function requireAssignableUsers(
  res: Response,
  user: ProjectUserContext,
  publicUserIds: string[],
): Promise<boolean> {
  if (isGlobalProjectRole(user.role) || publicUserIds.length === 0) return true;

  const assignableUsers = await listAssignableUsers(user);
  if (assignableUsers === null) return true;

  const allowedIds = new Set(assignableUsers.map((entry) => String(entry.id)));
  const invalidIds = Array.from(new Set(publicUserIds)).filter((publicId) => {
    const match = publicId.match(/(\d+)$/);
    return !match || !allowedIds.has(match[1]);
  });

  if (invalidIds.length > 0) {
    sendAccessError(res, 403, 'Vous pouvez uniquement assigner des agents de votre équipe.');
    return false;
  }

  return true;
}

export async function requireProjectView(
  res: Response,
  projectId: number,
): Promise<ProjectUserContext | null> {
  const user = getProjectUserContext(res);
  const permissions = await getProjectPermissions(user, projectId);
  if (!permissions.canView) {
    return sendAccessError(res, 404, 'Projet introuvable ou inaccessible.');
  }
  return user;
}

export async function requireProjectManagement(
  res: Response,
  projectId: number,
): Promise<ProjectUserContext | null> {
  const user = await requireProjectView(res, projectId);
  if (!user) return null;

  const permissions = await getProjectPermissions(user, projectId);
  if (!permissions.canEdit) {
    return sendAccessError(res, 403, 'Vous ne pouvez pas gérer ce projet.');
  }
  return user;
}

export async function requireTaskView(
  res: Response,
  projectId: number,
  taskId: number,
): Promise<ProjectUserContext | null> {
  const user = getProjectUserContext(res);
  const permissions = await getTaskPermissions(user, projectId, taskId);
  if (!permissions.canView) {
    return sendAccessError(res, 404, 'Tâche introuvable ou inaccessible.');
  }
  return user;
}

export async function requireTaskManagement(
  res: Response,
  projectId: number,
  taskId: number,
): Promise<ProjectUserContext | null> {
  const user = await requireTaskView(res, projectId, taskId);
  if (!user) return null;
  const permissions = await getTaskPermissions(user, projectId, taskId);
  if (!permissions.canEdit) {
    return sendAccessError(res, 403, 'Vous ne pouvez pas modifier le contenu de cette tâche.');
  }
  return user;
}

export async function requireTaskStatusUpdate(
  res: Response,
  projectId: number,
  taskId: number,
  assignedUserId?: number | null,
): Promise<ProjectUserContext | null> {
  const user = getProjectUserContext(res);
  const permissions = await getTaskPermissions(
    user,
    projectId,
    taskId,
    assignedUserId,
  );
  if (!permissions.canUpdateStatus) {
    return sendAccessError(res, 403, 'Seul l’agent assigné ou un responsable peut modifier ce statut.');
  }
  return user;
}

export async function requireTaskComment(
  res: Response,
  projectId: number,
  taskId: number,
): Promise<ProjectUserContext | null> {
  const user = getProjectUserContext(res);
  const permissions = await getTaskPermissions(user, projectId, taskId);
  if (!permissions.canComment) {
    return sendAccessError(res, 403, 'Vous ne pouvez pas commenter cette tâche.');
  }
  return user;
}
