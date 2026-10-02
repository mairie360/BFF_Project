import { Router, Request, Response } from "express";
import {
  apiErrorResponses,
  type ApiErrorStatus,
  registry,
  ProjectsPageResponse,
  ProjectsPageQuery,
  ErrorResponse,
} from "../../openapi-registry";
import {
  buildKanbanColumns,
  buildProjectDtoForUser,
  buildPagination,
  collectMembers,
  defaultProjectSummary,
  handleUnknownError,
  mapProjectStatus,
  paginateProjects,
  sendValidationError,
} from "./project_helpers";
import { canManageProjects, getProjectUserContext, isGlobalProjectRole } from '../../auth/project-user';
import { getProjectBundle, listAssignableUsers, listVisibleProjects, type ProjectBundle } from '../../services/projectData';

const router = Router();

// Bundles read in parallel at most, so that a large list does not burst Project API.
const BUNDLE_READ_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 500, 502] as const satisfies readonly ApiErrorStatus[];

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
  const queryResult = ProjectsPageQuery.safeParse(req.query);

  if (!queryResult.success) {
    return sendValidationError(res, 'query', queryResult.error.issues);
  }

  try {
    const user = getProjectUserContext(res);
    const search = queryResult.data.q?.toLowerCase().trim();
    const status = queryResult.data.status;

    // The search and status filters only need the list Project API returns, so they run before any bundle
    // is read. Priority, due date, progress, the summary and the Kanban counts are derived from the tasks
    // of every matching project, which is why the bundles cannot be read for the current page only.
    const candidates = (await listVisibleProjects()).filter((project) => {
      const matchesSearch = !search
        || project.name.toLowerCase().includes(search)
        || project.description.toLowerCase().includes(search);
      const matchesStatus = !status || status === 'all' || mapProjectStatus(project.status) === status;
      return matchesSearch && matchesStatus;
    });
    const bundles = (await mapWithConcurrency(candidates, BUNDLE_READ_CONCURRENCY, (project) => getProjectBundle(project.id)))
      // A project deleted or hidden between the list and its read is skipped.
      .filter((bundle): bundle is ProjectBundle => bundle !== null);
    const mappedProjects = await Promise.all(bundles.map((bundle) =>
      buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
    ));

    // The members offered come from the Core directory, restricted to what the caller may assign.
    const members = collectMembers([await listAssignableUsers(user)]);

    const dueBefore = queryResult.data.dueBefore ? new Date(queryResult.data.dueBefore).getTime() : null;
    const dueAfter = queryResult.data.dueAfter ? new Date(queryResult.data.dueAfter).getTime() : null;
    const filteredProjects = mappedProjects.filter((project) => {
      const matchesPriority =
        !queryResult.data.priority || queryResult.data.priority === "all"
          ? true
          : project.priority === queryResult.data.priority;
      const projectDueDate = new Date(project.dueDate).getTime();
      const matchesDueBefore = dueBefore === null || projectDueDate <= dueBefore;
      const matchesDueAfter = dueAfter === null || projectDueDate >= dueAfter;

      return matchesPriority && matchesDueBefore && matchesDueAfter;
    });

    const page = queryResult.data.page ?? 1;
    const limit = queryResult.data.limit ?? 10;
    const pagedProjects = paginateProjects(filteredProjects, page, limit);

    return res.status(200).json({
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
        defaultView: queryResult.data.view ?? "kanban",
        views: [
          { value: "kanban", label: "Kanban" },
          { value: "grid", label: "Grille" },
          { value: "table", label: "Tableau" },
        ],
      },
      filters: {
        search: queryResult.data.q ?? null,
        status: queryResult.data.status ?? "all",
        priority: queryResult.data.priority ?? "all",
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
      summary: defaultProjectSummary(filteredProjects),
      kanban: {
        columns: buildKanbanColumns(filteredProjects),
      },
      projects: pagedProjects,
      pagination: buildPagination(filteredProjects.length, page, limit),
    });
  } catch (error) {
    return handleUnknownError(res, error, ERROR_STATUSES);
  }
});

export default router;
