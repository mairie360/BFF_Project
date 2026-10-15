import { Router, Request, Response } from 'express';
import { HttpError, parseRequest } from '@mairie360/bffs-lib';
import {
    apiErrorResponses,
    type ApiErrorStatus,
    registry,
    CreateProjectTaskStatusBody,
    DeletedProjectStatusParams,
    DeleteProjectStatusQuery,
    ProjectIdParams,
    ProjectStatusParams,
    ProjectTaskStatuses,
    UpdateProjectTaskStatusBody,
} from '../../openapi-registry';
import { requireProjectIdParam } from './project_helpers';
import { requireProjectManagement, requireProjectView } from './project_access';
import {
    createProjectStatusOnApi,
    deleteProjectStatusOnApi,
    listProjectStatuses,
    mapProjectTaskStatus,
    parseStatusId,
    requireStatusIdParam,
    updateProjectStatusOnApi,
} from './status_helpers';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf, type Caller } from '../../services/projectData';

// Task statuses of a project (MAIR-566): the Kanban columns, each in one of the three categories. Reading them needs
// the project to be visible; changing them is for its managers. Project API applies the rules (a name unique in
// the project, at least one status per category, the tasks of a deleted status moved to `moveTo`) and its 409s
// are relayed.

const router = Router();

const READ_STATUSES = [400, 401, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];
const WRITE_STATUSES = [400, 401, 403, 404, 409, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

const statusesResponse = {
    description: 'Statuses of the project, by position, as re-read from Project API',
    content: { 'application/json': { schema: ProjectTaskStatuses } },
};

async function answerStatuses(caller: Caller, projectId: number, res: Response, status = 200): Promise<void> {
    const statuses = await listProjectStatuses(caller, projectId);
    res.status(status).json({ statuses: statuses.map(mapProjectTaskStatus) });
}

registry.registerPath({
    method: 'get',
    path: '/projects/{projectId}/statuses',
    tags: ['Statuses'],
    summary: 'Lists the task statuses of a project',
    description: 'The Kanban columns of the project, by position (MAIR-566). They were copied from its template at its creation and are then the project\'s own. Each belongs to a category (`todo`, `in-progress`, `done`) that drives the archiving, the progress and the pending tasks.',
    request: { params: ProjectIdParams },
    responses: { ...apiErrorResponses(...READ_STATUSES), 200: statusesResponse },
});

router.get('/:projectId/statuses', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectIdParams, req.params, 'params');
    const projectId = requireProjectIdParam(params.projectId);
    const caller = callerOf(req, READ_STATUSES);

    await requireProjectView(caller, getProjectUserContext(res), projectId);
    await answerStatuses(caller, projectId, res);
});

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/statuses',
    tags: ['Statuses'],
    summary: 'Adds a task status to a project',
    description: 'Reserved to the project managers. Without `position` the status goes last; with it, the statuses from that position move one place down. `409` when another status of the project has the name.',
    request: {
        params: ProjectIdParams,
        body: { required: true, content: { 'application/json': { schema: CreateProjectTaskStatusBody } } },
    },
    responses: { ...apiErrorResponses(...WRITE_STATUSES), 201: statusesResponse },
});

router.post('/:projectId/statuses', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectIdParams, req.params, 'params');
    const body = parseRequest(CreateProjectTaskStatusBody, req.body, 'body');
    const projectId = requireProjectIdParam(params.projectId);
    const caller = callerOf(req, WRITE_STATUSES);

    await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    await createProjectStatusOnApi(caller, projectId, body);
    await answerStatuses(caller, projectId, res, 201);
});

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}/statuses/{statusId}',
    tags: ['Statuses'],
    summary: 'Renames, recolours, moves or recategorizes a task status',
    description: 'Reserved to the project managers; an absent field is left unchanged. A new `category` moves the tasks of the status to it (a `done` status archives them), and is refused (`409`) when it would leave the former category without any status.',
    request: {
        params: ProjectStatusParams,
        body: { required: true, content: { 'application/json': { schema: UpdateProjectTaskStatusBody } } },
    },
    responses: { ...apiErrorResponses(...WRITE_STATUSES), 200: statusesResponse },
});

router.patch('/:projectId/statuses/:statusId', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectStatusParams, req.params, 'params');
    const body = parseRequest(UpdateProjectTaskStatusBody, req.body, 'body');
    const projectId = requireProjectIdParam(params.projectId);
    const statusId = requireStatusIdParam(params.statusId);
    const caller = callerOf(req, WRITE_STATUSES);

    await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    await updateProjectStatusOnApi(caller, projectId, statusId, body);
    await answerStatuses(caller, projectId, res);
});

registry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}/statuses/{statusId}',
    tags: ['Statuses'],
    summary: 'Deletes a task status',
    description: 'Reserved to the project managers. The tasks of the status (archived ones included) move to `moveTo`, another status of the project, which is required as soon as the status holds tasks (`409` otherwise). The last status of a category cannot be deleted (`409`).',
    request: { params: DeletedProjectStatusParams, query: DeleteProjectStatusQuery },
    responses: { ...apiErrorResponses(...WRITE_STATUSES), 200: statusesResponse },
});

router.delete('/:projectId/statuses/:statusId', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectStatusParams, req.params, 'params');
    const query = parseRequest(DeleteProjectStatusQuery, req.query, 'query');
    const projectId = requireProjectIdParam(params.projectId);
    const statusId = requireStatusIdParam(params.statusId);
    const moveTo = query.moveTo === undefined ? undefined : parseStatusId(query.moveTo);
    if (moveTo === null) throw new HttpError(400, 'moveTo must be a status-<id> of the project');
    const caller = callerOf(req, WRITE_STATUSES);

    await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    await deleteProjectStatusOnApi(caller, projectId, statusId, moveTo);
    await answerStatuses(caller, projectId, res);
});

export default router;
