import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectGroups } from '../../openapi-registry';
import { listProjectGroups } from './project_helpers';
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

export default router;
