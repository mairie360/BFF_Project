import { Router, Request, Response } from 'express';
import { registry, ProjectsPageResponse, ProjectsPageQuery, ApiError } from '../../openapi-registry';
import {
  buildKanbanColumns,
  buildPagination,
  collectMembers,
  defaultProjectSummary,
  fetchProjectBundle,
  fetchProjects,
  handleUnknownError,
  mapProjectToDto,
  paginateProjects,
  sendValidationError,
} from './project_helpers';

const router = Router();

registry.registerPath({
  method: 'get',
  path: '/projects-page',
  tags: ['Projects'],
  summary: 'Charge la page projets',
  description:
    'Retourne les projets, les filtres, les options et les données Kanban nécessaires à l’affichage de la page.',

  request: {
    query: ProjectsPageQuery,
  },

  responses: {
    200: {
      description: 'Page projets chargée avec succès',
      content: {
        'application/json': {
          schema: ProjectsPageResponse,
        },
      },
    },

    500: {
      description: 'Erreur serveur',
      content: {
        'application/json': {
          schema: ApiError,
        },
      },
    },
  },
});

router.get('/', async (req: Request, res: Response) => {
  const queryResult = ProjectsPageQuery.safeParse(req.query);

  if (!queryResult.success) {
    return sendValidationError(res, queryResult.error.issues);
  }

  try {
    const projects = await fetchProjects();
    const bundles = await Promise.all(
      projects.map(async (project) => {
        const projectBundle = await fetchProjectBundle(project.id);

        return {
          project: mapProjectToDto(projectBundle.project, projectBundle.tasks, projectBundle.users),
          users: projectBundle.users,
        };
      }),
    );

    const mappedProjects = bundles.map((bundle) => bundle.project);
    const members = collectMembers(bundles.map((bundle) => bundle.users));

    const filteredProjects = mappedProjects.filter((project) => {
      const search = queryResult.data.q?.toLowerCase().trim();
      const matchesSearch = !search
        ? true
        : project.title.toLowerCase().includes(search) || project.description.toLowerCase().includes(search);
      const matchesStatus = !queryResult.data.status || queryResult.data.status === 'all'
        ? true
        : project.status === queryResult.data.status;
      const matchesPriority = !queryResult.data.priority || queryResult.data.priority === 'all'
        ? true
        : project.priority === queryResult.data.priority;

      return matchesSearch && matchesStatus && matchesPriority;
    });

    const page = queryResult.data.page ?? 1;
    const limit = queryResult.data.limit ?? 10;
    const pagedProjects = paginateProjects(filteredProjects, page, limit);

    return res.status(200).json({
      page: {
        title: 'Projects',
        subtitle: 'Vue consolidée des projets',
        defaultView: queryResult.data.view ?? 'kanban',
        views: [
          { value: 'kanban', label: 'Kanban' },
          { value: 'grid', label: 'Grille' },
          { value: 'table', label: 'Tableau' },
        ],
      },
      filters: {
        search: queryResult.data.q ?? null,
        status: queryResult.data.status ?? 'all',
        priority: queryResult.data.priority ?? 'all',
        statuses: [
          { label: 'Toutes', value: 'all' },
          { label: 'À faire', value: 'todo' },
          { label: 'En cours', value: 'in-progress' },
          { label: 'En revue', value: 'review' },
          { label: 'Terminées', value: 'done' },
        ],
        priorities: [
          { label: 'Toutes', value: 'all' },
          { label: 'Haute', value: 'high' },
          { label: 'Moyenne', value: 'medium' },
          { label: 'Basse', value: 'low' },
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
    return handleUnknownError(res, error);
  }
});

export default router;
