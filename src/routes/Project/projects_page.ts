import { Router, Request, Response } from "express";
import {
  apiErrorResponses,
  type ApiErrorStatus,
  registry,
  ProjectsPageResponse,
  ProjectsPageQuery,
  ErrorResponse,
} from "../../openapi-registry";
import type { GetProjectsParams } from '@mairie360/project-api-openapi/model';
import {
  buildPagination,
  collectMembers,
  kanbanColumnsOfPage,
  mapProjectListItemToDto,
  summaryFromCounts,
} from "./project_helpers";
import { HttpError, parseRequest } from "@mairie360/bffs-lib";
import { canManageProjects, getProjectUserContext, isGlobalProjectRole, type ProjectUserContext } from '../../auth/project-user';
import { callerOf, getProjectPermissions, isProjectClosed, listAssignableUsers, listProjectsPage } from '../../services/projectData';

const router = Router();

/**
 * The caller as the shell header shows them, from their Core profile. For an Admin or a Maire the page still loads
 * without it when Core cannot answer (the front then shows the role); the other roles already need that profile for
 * their assignable users, so the page fails with it. A rejected session (401) is relayed.
 */
async function pageUser(user: ProjectUserContext): Promise<{ id: string; name: string } | undefined> {
  try {
    const { name } = await user.profile();
    return { id: `user-${user.id}`, name };
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) throw error;
    return undefined;
  }
}


// Filters of the page as Project API's (MAIR-474). Since MAIR-558 Project API stores `Todo` and `Review`; a project
// on hold is `Suspended` (MAIR-1084, see `mapProjectStatus`); `high` covers `Urgent` too (stored `High`).
const STATUS_FILTER = {
  todo: 'Todo', 'in-progress': 'Active', review: 'Review', 'on-hold': 'Suspended', done: 'Completed',
} as const;
const PRIORITY_FILTER = { high: 'High', medium: 'Medium', low: 'Low' } as const;

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: "get",
  path: "/projects-page",
  tags: ["Projects"],
  summary: "Load the projects page",
  description:
    "Returns the projects, the filters, the options and the Kanban data the page needs.",

  request: {
    query: ProjectsPageQuery,
  },

  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: {
      description: "Projects page loaded",
      content: {
        "application/json": {
          schema: ProjectsPageResponse,
        },
      },
    },

    500: {
      description: "Server error",
      content: {
        "application/json": {
          schema: ErrorResponse,
        },
      },
    },
  },
});

router.get("/", async (req: Request, res: Response) => {
  const query = parseRequest(ProjectsPageQuery, req.query, "query");
  const caller = callerOf(req, ERROR_STATUSES);
  const user = getProjectUserContext(res);
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;

  // One Project API call (MAIR-474): it filters, pages and aggregates the tasks of the visible projects, and
  // counts every match per status and priority. The BFF used to read every task of every visible project.
  const search = query.q?.trim();
  const params: GetProjectsParams = {
    limit,
    offset: (page - 1) * limit,
    ...(search ? { search } : {}),
    ...(query.status && query.status !== 'all' ? { status: STATUS_FILTER[query.status] } : {}),
    ...(query.priority && query.priority !== 'all' ? { priority: PRIORITY_FILTER[query.priority] } : {}),
    ...(query.dueBefore ? { due_before: new Date(query.dueBefore).toISOString() } : {}),
    ...(query.dueAfter ? { due_after: new Date(query.dueAfter).toISOString() } : {}),
  };
  const shellUser = pageUser(user);
  // A Core 401 may reject it while the page is still loading: handle it now so Node never reports an unhandled
  // rejection; the 401 is still relayed by the `await shellUser` below.
  shellUser.catch(() => undefined);
  const [result, assignable] = await Promise.all([
    listProjectsPage(caller, params),
    // The members offered come from the Core directory, restricted to what the caller may assign.
    listAssignableUsers(caller, user),
  ]).catch(async (error: unknown) => {
    // Answer only once the profile read (retried on a transient failure) has settled: no call outlives the request.
    await shellUser.catch(() => undefined);
    throw error;
  });
  const me = await shellUser;
  // Every listed project is visible to the caller; Project API's `can_manage` adds the projects they manage as a
  // `manager` member (MAIR-1088).
  const projects = result.projects.map((project) =>
    mapProjectListItemToDto(project, getProjectPermissions(user, true, project.can_manage, isProjectClosed(project))));
  const summary = summaryFromCounts(result);
  const members = collectMembers([assignable]);

  res.status(200).json({
    access: {
      role: user.role,
      scope: isGlobalProjectRole(user.role) ? 'all' : user.role === 'Responsable' ? 'team' : 'assigned',
      canCreateProject: canManageProjects(user.role),
      canManageProjects: canManageProjects(user.role),
      canManageTasks: canManageProjects(user.role),
      canUpdateAssignedTaskStatus: true,
      canCommentTasks: true,
      ...(me ? { user: me } : {}),
    },
    page: {
      title: "Projets",
      subtitle: "Vue consolidée des projets",
      defaultView: query.view ?? "kanban",
      views: [
        { value: "kanban", label: "Kanban" },
        { value: "grid", label: "Grille" },
        { value: "table", label: "Tableau" },
      ],
    },
    filters: {
      search: query.q ?? null,
      status: query.status ?? "all",
      priority: query.priority ?? "all",
      statuses: [
        { label: "Toutes", value: "all" },
        { label: "À faire", value: "todo" },
        { label: "En cours", value: "in-progress" },
        { label: "En revue", value: "review" },
        { label: "En pause", value: "on-hold" },
        { label: "Terminées", value: "done" },
      ],
      priorities: [
        { label: "Toutes", value: "all" },
        { label: "Haute", value: "high" },
        { label: "Moyenne", value: "medium" },
        { label: "Basse", value: "low" },
      ],
    },
    options: {
      members,
      labels: [],
    },
    summary,
    kanban: {
      columns: kanbanColumnsOfPage(projects, summary.projectsByStatus),
    },
    projects,
    pagination: buildPagination(result.total, page, limit),
  });
});

export default router;
