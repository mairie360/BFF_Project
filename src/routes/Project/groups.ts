import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectGroups, ProjectsWithoutGroup } from '../../openapi-registry';
import { listProjectGroups, listProjectsWithoutGroup } from './project_helpers';
import { callerOf } from '../../services/projectData';

// Groups a project can be linked to (`groupId` of `POST /projects` and `PATCH /projects/{projectId}`): every current
// and future member of the linked group sees the project. Project API decides which groups the caller may pick.

const router = Router();

const ERROR_STATUSES = [401, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'get',
    path: '/project-groups',
    tags: ['Projects'],
    summary: 'Lists the groups a project can be linked to',
    description: "The caller's groups, or every group for the Admin and Maire roles, by name. Empty for a caller without group.",
    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        200: { description: 'The groups', content: { 'application/json': { schema: ProjectGroups } } },
    },
});

router.get('/', async (req: Request, res: Response) => {
    const caller = callerOf(req, ERROR_STATUSES);
    res.status(200).json({ groups: await listProjectGroups(caller) });
});

const WITHOUT_GROUP_ERROR_STATUSES = [401, 403, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'get',
    path: '/project-groups/projects-without-group',
    tags: ['Projects'],
    summary: 'Lists the projects linked to no group',
    description: 'Every project must have a group, but a project created before groups were required, or whose group was deleted in Core API, has none until a manager picks one. Restricted to the Admin and Maire roles (`403` otherwise), for the administration page.',
    responses: {
        ...apiErrorResponses(...WITHOUT_GROUP_ERROR_STATUSES),
        200: { description: 'The projects without a group', content: { 'application/json': { schema: ProjectsWithoutGroup } } },
    },
});

router.get('/projects-without-group', async (req: Request, res: Response) => {
    const caller = callerOf(req, WITHOUT_GROUP_ERROR_STATUSES);
    res.status(200).json({ projects: await listProjectsWithoutGroup(caller) });
});

export default router;
