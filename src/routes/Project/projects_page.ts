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
import { parseRequest } from "@mairie360/bffs-lib";
import { canManageProjects, getProjectUserContext, isGlobalProjectRole } from '../../auth/project-user';
import { callerOf, getProjectPermissions, listAssignableUsers, listProjectsPage } from '../../services/projectData';

const router = Router();

/** Largest page Project API serves. */
const MAX_PAGE_SIZE = 500;

// Filters of the page as Project API's (MAIR-474). `todo` is the BFF status of a project whose stored status
// Project API does not interpret (`Error`, see `mapProjectStatus`); `high` covers `Urgent` too (stored `High`).
const STATUS_FILTER = { todo: 'Error', 'in-progress': 'Active', review: 'Suspended', done: 'Completed' } as const;
const PRIORITY_FILTER = { high: 'High', medium: 'Medium', low: 'Low' } as const;

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
  method: "get",
  path: "/projects-page",
  tags: ["Projects"],
  summary: "Charge la page projets",
  description:
    "Retourne les projets, les filtres, les options et les données Kanban nécessaires à l’affichage de la page.",

  request: {
    query: ProjectsPageQuery,
  },

  responses: {
    ...apiErrorResponses(...ERROR_STATUSES),
    200: {
      description: "Page projets chargée avec succès",
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
  const page = Math.max(Math.trunc(query.page ?? 1), 1);
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 10), 1), MAX_PAGE_SIZE);

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
  const [result, assignable] = await Promise.all([
    listProjectsPage(caller, params),
    // The members offered come from the Core directory, restricted to what the caller may assign.
    listAssignableUsers(caller, user),
  ]);
  // Every listed project is visible to the caller.
  const permissions = getProjectPermissions(user, true);
  const projects = result.projects.map((project) => mapProjectListItemToDto(project, permissions));
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
