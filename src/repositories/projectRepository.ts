import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { ProjetView, TaskView, User } from '@mairie360/project-api-openapi/model';
import {
  canManageProjects,
  isGlobalProjectRole,
  type ProjectUserContext,
} from '../auth/project-user';

export type ProjectPermissions = {
  canView: boolean;
  canEdit: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canCreateTask: boolean;
  canAssignMembers: boolean;
  canClose: boolean;
};

export type TaskPermissions = {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canUpdateStatus: boolean;
  canComment: boolean;
};

export type TaskComment = {
  id: string;
  message: string;
  author: { id: string; name: string };
  createdAt: string;
};

export type TaskHistoryEntry = {
  id: string;
  action: string;
  label: string;
  author: { id: string; name: string };
  createdAt: string;
  changes?: Record<string, unknown>;
};

type ProjectRow = {
  id: number;
  title: string;
  description: string;
  status: string;
};

type TaskCollaborationRow = {
  custom_fields: unknown;
};

type TaskRow = {
  id: number;
  title: string;
  status: string;
  priority: string;
  due_date: Date | string | null;
  assigned_to: number | null;
};

const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'mairie_360_database',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'password',
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const fallbackCollaboration = new Map<string, { comments: TaskComment[]; history: TaskHistoryEntry[] }>();

function collaborationKey(projectId: number, taskId: number): string {
  return `${projectId}:${taskId}`;
}

function getFallbackCollaboration(projectId: number, taskId: number) {
  const key = collaborationKey(projectId, taskId);
  const current = fallbackCollaboration.get(key) ?? { comments: [], history: [] };
  fallbackCollaboration.set(key, current);
  return current;
}

export function isProjectDatabaseAccessEnabled(): boolean {
  return process.env.PROJECT_DB_ACCESS !== 'disabled';
}

function projectStatusFromDatabase(status: string): ProjetView['status'] {
  if (status === 'active') return 'Active';
  if (status === 'suspended') return 'Suspended';
  if (status === 'completed') return 'Completed';
  return 'Error';
}

function projectStatusToDatabase(status: string | undefined): string | null {
  if (status === 'done') return 'completed';
  if (status === 'review') return 'suspended';
  if (status === 'todo' || status === 'in-progress') return 'active';
  return null;
}

function taskStatusFromDatabase(status: string): TaskView['status'] {
  if (status === 'todo') return 'Todo';
  if (status === 'in_progress') return 'InProgress';
  if (status === 'completed') return 'Completed';
  return 'Error';
}

function taskStatusToDatabase(status: unknown): 'todo' | 'in_progress' | 'completed' | null {
  if (status === 'Todo') return 'todo';
  if (status === 'InProgress') return 'in_progress';
  if (status === 'Completed') return 'completed';
  return null;
}

function taskPriorityFromDatabase(priority: string): TaskView['priority'] {
  if (priority === 'low') return 'Low';
  if (priority === 'medium') return 'Medium';
  if (priority === 'high') return 'High';
  return 'Error';
}

function taskPriorityToDatabase(priority: unknown): 'low' | 'medium' | 'high' | null {
  if (priority === 'Low') return 'low';
  if (priority === 'Medium') return 'medium';
  if (priority === 'High' || priority === 'Urgent') return 'high';
  return null;
}

function databaseDateToIso(value: Date | string | null): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return new Date(value).toISOString();
  return new Date().toISOString();
}

function visibleProjectsSql(user: ProjectUserContext): { where: string; values: unknown[] } {
  if (isGlobalProjectRole(user.role)) return { where: 'TRUE', values: [] };

  if (user.role === 'Responsable') {
    return {
      where: `
        p.owner_id = $1
        OR EXISTS (
          SELECT 1 FROM project_members direct_member
          WHERE direct_member.project_id = p.id AND direct_member.user_id = $1
        )
        OR EXISTS (
          SELECT 1
          FROM group_members my_group
          JOIN group_members team_member ON team_member.group_id = my_group.group_id
          WHERE my_group.user_id = $1
            AND (
              team_member.user_id = p.owner_id
              OR EXISTS (
                SELECT 1 FROM project_members service_member
                WHERE service_member.project_id = p.id
                  AND service_member.user_id = team_member.user_id
              )
            )
        )
      `,
      values: [user.id],
    };
  }

  return {
    where: `
      p.owner_id = $1
      OR EXISTS (
        SELECT 1 FROM project_members project_member
        WHERE project_member.project_id = p.id AND project_member.user_id = $1
      )
    `,
    values: [user.id],
  };
}

export async function listVisibleProjectRows(user: ProjectUserContext): Promise<ProjetView[] | null> {
  if (!isProjectDatabaseAccessEnabled()) return null;
  const visibility = visibleProjectsSql(user);
  const result = await pool.query<ProjectRow>(
    `
      SELECT p.id, p.title, COALESCE(p.description, '') AS description, p.status::text AS status
      FROM projects p
      WHERE ${visibility.where}
      ORDER BY p.created_at DESC NULLS LAST, p.id DESC
    `,
    visibility.values,
  );

  return result.rows.map((project) => ({
    id: project.id,
    name: project.title,
    description: project.description,
    status: projectStatusFromDatabase(project.status),
  }));
}

export async function getProjectPermissions(
  user: ProjectUserContext,
  projectId: number,
): Promise<ProjectPermissions> {
  let canView = true;

  if (isProjectDatabaseAccessEnabled()) {
    const visibility = visibleProjectsSql(user);
    const result = await pool.query<{ visible: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM projects p WHERE p.id = $${visibility.values.length + 1} AND (${visibility.where})) AS visible`,
      [...visibility.values, projectId],
    );
    canView = result.rows[0]?.visible ?? false;
  }

  const canManage = canView && canManageProjects(user.role);
  return {
    canView,
    canEdit: canManage,
    canDuplicate: canManage,
    canDelete: canManage,
    canCreateTask: canManage,
    canAssignMembers: canManage,
    canClose: canManage,
  };
}

export async function getTaskPermissions(
  user: ProjectUserContext,
  projectId: number,
  taskId: number,
  assignedUserId?: number | null,
): Promise<TaskPermissions> {
  const projectPermissions = await getProjectPermissions(user, projectId);
  const canManage = projectPermissions.canEdit;
  let assignedToCurrentUser =
    projectPermissions.canView &&
    (assignedUserId !== undefined
      ? assignedUserId === user.id
      : !isProjectDatabaseAccessEnabled());

  if (
    projectPermissions.canView &&
    !canManage &&
    assignedUserId === undefined &&
    isProjectDatabaseAccessEnabled()
  ) {
    const result = await pool.query<{ assigned: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM tasks WHERE id = $1 AND project_id = $2 AND assigned_to = $3) AS assigned`,
      [taskId, projectId, user.id],
    );
    assignedToCurrentUser = result.rows[0]?.assigned ?? false;
  }

  return {
    canView: canManage || assignedToCurrentUser,
    canEdit: canManage,
    canDelete: canManage,
    canUpdateStatus: canManage || assignedToCurrentUser,
    canComment: canManage || assignedToCurrentUser,
  };
}

export async function listAssignableUsers(user: ProjectUserContext): Promise<User[] | null> {
  if (!isProjectDatabaseAccessEnabled()) return null;

  const result = isGlobalProjectRole(user.role)
    ? await pool.query<{ id: number; name: string }>(
        `SELECT id, concat_ws(' ', first_name, last_name) AS name FROM users WHERE COALESCE(is_archived, false) = false ORDER BY last_name, first_name`,
      )
    : user.role === 'Responsable'
      ? await pool.query<{ id: number; name: string }>(
          `
            SELECT DISTINCT u.id, concat_ws(' ', u.first_name, u.last_name) AS name
            FROM group_members mine
            JOIN group_members team ON team.group_id = mine.group_id
            JOIN users u ON u.id = team.user_id
            WHERE mine.user_id = $1 AND COALESCE(u.is_archived, false) = false
            ORDER BY name
          `,
          [user.id],
        )
      : await pool.query<{ id: number; name: string }>(
          `SELECT id, concat_ws(' ', first_name, last_name) AS name FROM users WHERE id = $1`,
          [user.id],
        );

  return result.rows;
}

export async function syncProjectMembers(projectId: number, userIds: number[]): Promise<void> {
  if (!isProjectDatabaseAccessEnabled()) return;
  const desired = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM project_members WHERE project_id = $1 AND NOT (user_id = ANY($2::int[]))`,
      [projectId, desired],
    );
    if (desired.length > 0) {
      await client.query(
        `
          INSERT INTO project_members (project_id, user_id)
          SELECT $1, user_id FROM unnest($2::int[]) AS user_id
          ON CONFLICT (project_id, user_id) DO NOTHING
        `,
        [projectId, desired],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createProjectRecord(
  ownerId: number,
  input: { title: string; description?: string | null },
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO projects (title, description, owner_id)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [input.title, input.description ?? null, ownerId],
  );
  const projectId = result.rows[0]?.id;

  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error('La base de données n’a pas retourné l’identifiant du projet créé.');
  }

  return projectId;
}

export async function getProjectBundleFromDatabase(projectId: number): Promise<{
  project: ProjetView;
  tasks: TaskView[];
  users: User[];
} | null> {
  const [projectResult, taskResult, userResult] = await Promise.all([
    pool.query<ProjectRow>(
      `SELECT id, title, COALESCE(description, '') AS description, status::text AS status FROM projects WHERE id = $1`,
      [projectId],
    ),
    pool.query<TaskRow>(
      `
        SELECT id, title, status::text, priority::text, due_date, assigned_to
        FROM tasks
        WHERE project_id = $1
        ORDER BY created_at, id
      `,
      [projectId],
    ),
    pool.query<{ id: number; name: string }>(
      `
        SELECT u.id, concat_ws(' ', u.first_name, u.last_name) AS name
        FROM project_members member
        JOIN users u ON u.id = member.user_id
        WHERE member.project_id = $1
        ORDER BY u.last_name, u.first_name, u.id
      `,
      [projectId],
    ),
  ]);
  const project = projectResult.rows[0];
  if (!project) return null;

  return {
    project: {
      id: project.id,
      name: project.title,
      description: project.description,
      status: projectStatusFromDatabase(project.status),
    },
    tasks: taskResult.rows.map((task) => ({
      id: task.id,
      title: task.title,
      description: '',
      status: taskStatusFromDatabase(task.status),
      priority: taskPriorityFromDatabase(task.priority),
      due_date: databaseDateToIso(task.due_date),
      assigned_to: task.assigned_to,
    })),
    users: userResult.rows,
  };
}

export async function deleteProjectRecord(projectId: number): Promise<void> {
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
}

export async function createTaskRecord(
  projectId: number,
  input: {
    title: string;
    status?: unknown;
    priority?: unknown;
    dueDate?: string | null;
    assignedTo?: number | null;
    fields?: unknown[];
  },
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO tasks (project_id, title, status, priority, due_date, assigned_to, custom_fields)
      VALUES ($1, $2, COALESCE($3::task_status, 'todo'), COALESCE($4::task_priority, 'medium'), $5, $6, $7::jsonb)
      RETURNING id
    `,
    [
      projectId,
      input.title,
      taskStatusToDatabase(input.status),
      taskPriorityToDatabase(input.priority),
      input.dueDate ?? null,
      input.assignedTo ?? null,
      JSON.stringify({ fields: input.fields ?? [] }),
    ],
  );
  const taskId = result.rows[0]?.id;
  if (!Number.isInteger(taskId) || taskId <= 0) throw new Error('Identifiant de tâche manquant après création.');
  return taskId;
}

export async function updateTaskRecord(
  projectId: number,
  taskId: number,
  input: {
    title?: string | null;
    status?: unknown;
    priority?: unknown;
    dueDate?: string | null;
    assignedTo?: number | null;
  },
): Promise<void> {
  await pool.query(
    `
      UPDATE tasks
      SET title = COALESCE($1, title),
          status = COALESCE($2::task_status, status),
          priority = COALESCE($3::task_priority, priority),
          due_date = COALESCE($4::timestamp, due_date),
          assigned_to = CASE WHEN $5::boolean THEN $6 ELSE assigned_to END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND project_id = $8
    `,
    [
      input.title ?? null,
      taskStatusToDatabase(input.status),
      taskPriorityToDatabase(input.priority),
      input.dueDate ?? null,
      input.assignedTo !== undefined,
      input.assignedTo ?? null,
      taskId,
      projectId,
    ],
  );
}

export async function deleteTaskRecord(projectId: number, taskId: number): Promise<void> {
  await pool.query('DELETE FROM tasks WHERE id = $1 AND project_id = $2', [taskId, projectId]);
}

export async function updateProjectRecord(
  projectId: number,
  input: { title?: string; description?: string; status?: string },
): Promise<void> {
  if (!isProjectDatabaseAccessEnabled()) return;
  await pool.query(
    `
      UPDATE projects
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          status = COALESCE($3::project_status, status)
      WHERE id = $4
    `,
    [input.title ?? null, input.description ?? null, projectStatusToDatabase(input.status), projectId],
  );
}

export async function setProjectClosed(projectId: number, status: 'completed' | 'suspended'): Promise<void> {
  if (!isProjectDatabaseAccessEnabled()) return;
  await pool.query('UPDATE projects SET status = $1::project_status WHERE id = $2', [status, projectId]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asComments(value: unknown): TaskComment[] {
  return Array.isArray(value) ? value.filter((entry): entry is TaskComment => typeof entry === 'object' && entry !== null) : [];
}

function asHistory(value: unknown): TaskHistoryEntry[] {
  return Array.isArray(value) ? value.filter((entry): entry is TaskHistoryEntry => typeof entry === 'object' && entry !== null) : [];
}

export async function getTaskCollaboration(
  projectId: number,
  taskId: number,
): Promise<{ comments: TaskComment[]; history: TaskHistoryEntry[] }> {
  if (!isProjectDatabaseAccessEnabled()) return getFallbackCollaboration(projectId, taskId);

  const [taskResult, statusHistoryResult] = await Promise.all([
    pool.query<TaskCollaborationRow>(
      'SELECT COALESCE(custom_fields, \'{}\'::jsonb) AS custom_fields FROM tasks WHERE id = $1 AND project_id = $2',
      [taskId, projectId],
    ),
    pool.query<{
      id: number;
      old_status: string | null;
      new_status: string | null;
      changed_at: Date;
      user_id: number | null;
      user_name: string | null;
    }>(
      `
        SELECT h.id, h.old_status::text, h.new_status::text, h.changed_at,
               u.id AS user_id, concat_ws(' ', u.first_name, u.last_name) AS user_name
        FROM task_history h
        LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.task_id = $1
        ORDER BY h.changed_at DESC, h.id DESC
      `,
      [taskId],
    ),
  ]);

  const customFields = asRecord(taskResult.rows[0]?.custom_fields);
  const customHistory = asHistory(customFields.history);
  const statusHistory: TaskHistoryEntry[] = statusHistoryResult.rows.map((entry) => ({
    id: `status-${entry.id}`,
    action: 'status_changed',
    label: `Statut modifié : ${entry.old_status ?? 'inconnu'} → ${entry.new_status ?? 'inconnu'}`,
    author: {
      id: entry.user_id ? `user-${entry.user_id}` : 'system',
      name: entry.user_name || 'Système',
    },
    createdAt: entry.changed_at.toISOString(),
    changes: { status: { from: entry.old_status, to: entry.new_status } },
  }));

  return {
    comments: [...asComments(customFields.comments)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    history: [...customHistory, ...statusHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function addTaskComment(
  projectId: number,
  taskId: number,
  user: ProjectUserContext,
  message: string,
): Promise<TaskComment> {
  const comment: TaskComment = {
    id: `comment-${randomUUID()}`,
    message: message.trim(),
    author: { id: `user-${user.id}`, name: user.name },
    createdAt: new Date().toISOString(),
  };

  if (isProjectDatabaseAccessEnabled()) {
    await pool.query(
      `
        UPDATE tasks
        SET custom_fields = jsonb_set(
          COALESCE(custom_fields, '{}'::jsonb),
          '{comments}',
          COALESCE(custom_fields->'comments', '[]'::jsonb) || $1::jsonb,
          true
        )
        WHERE id = $2 AND project_id = $3
      `,
      [JSON.stringify([comment]), taskId, projectId],
    );
  } else {
    getFallbackCollaboration(projectId, taskId).comments.push(comment);
  }

  return comment;
}

export async function appendTaskHistory(
  projectId: number,
  taskId: number,
  user: ProjectUserContext,
  action: string,
  label: string,
  changes?: Record<string, unknown>,
): Promise<void> {
  const entry: TaskHistoryEntry = {
    id: `history-${randomUUID()}`,
    action,
    label,
    author: { id: `user-${user.id}`, name: user.name },
    createdAt: new Date().toISOString(),
    ...(changes ? { changes } : {}),
  };

  if (!isProjectDatabaseAccessEnabled()) {
    getFallbackCollaboration(projectId, taskId).history.unshift(entry);
    return;
  }

  await pool.query(
    `
      UPDATE tasks
      SET custom_fields = jsonb_set(
        COALESCE(custom_fields, '{}'::jsonb),
        '{history}',
        COALESCE(custom_fields->'history', '[]'::jsonb) || $1::jsonb,
        true
      )
      WHERE id = $2 AND project_id = $3
    `,
    [JSON.stringify([entry]), taskId, projectId],
  );
}
