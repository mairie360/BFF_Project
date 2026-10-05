import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, CreateTaskBody, ProjectTask, ErrorResponse } from '../../openapi-registry';
import { HttpError, parseRequest } from '@mairie360/bffs-lib';
import {
    createTaskOnApi,
    buildTaskDtoForUser,
    fetchProjectBundle,
    mapTaskInputToBackend,
    requireProjectIdParam,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { appendTaskHistory, callerOf } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/tasks',
    tags: ['Projects'],
    summary: 'Crée une nouvelle tâche pour un projet existant',

    request: {
        params: ProjectIdParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: CreateTaskBody,
                },
            },
        },
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        201: {
            description: 'Tâche créée avec succès',
            content: {
                'application/json': {
                    schema: ProjectTask,
                },
            },
        },

        400: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },

        404: {
            description: 'Project not found',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },
    },
});

router.post('/:projectId/tasks', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectIdParams, req.params, 'params');
    const body = parseRequest(CreateTaskBody, req.body, 'body');
    const projectId = requireProjectIdParam(params.projectId);
    const caller = callerOf(req, ERROR_STATUSES);

    const { user } = await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    await requireAssignableUsers(caller, user, [body.responsibleId, ...body.assigneeIds]);
    const createdTask = await createTaskOnApi(
        caller,
        projectId,
        mapTaskInputToBackend({
            title: body.title,
            status: body.status,
            priority: body.priority,
            responsibleId: body.responsibleId,
            assigneeIds: body.assigneeIds,
            labels: body.labels,
            dueDate: body.dueDate,
        }),
    );

    await appendTaskHistory(caller, projectId, createdTask.task_id, 'task_created', `Tâche « ${body.title} » créée.`);
    const bundle = await fetchProjectBundle(caller, projectId);
    const task = bundle.tasks.find((entry) => entry.id === createdTask.task_id);
    if (!task) throw new HttpError(404, 'Task not found after creation');

    res.status(201).json(buildTaskDtoForUser(user, task, bundle.users));
});

export default router;
