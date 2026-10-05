import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    createProjectOnApi,
    createTaskOnApi,
    fetchProjectBundle,
    mapTaskInputToBackend,
    mapTaskPriority,
    mapTaskStatus,
    requireProjectIdParam,
    syncProjectUsersOnApi,
    userPublicId,
    withCreatedProjectRollback,
} from './project_helpers';
import { parseRequest } from '@mairie360/bffs-lib';
import { requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/duplicate',
    tags: ['Projects'],
    summary: 'Duplicate a project',
    description: 'Recreates the project with its members and its tasks; if a step fails, the partial duplicate is deleted again.',

    request: {
        params: ProjectIdParams,
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        201: {
            description: 'Project duplicated, as re-read from Project API',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
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

router.post('/:projectId/duplicate', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectIdParams, req.params, 'params');
    const projectId = requireProjectIdParam(params.projectId);
    const caller = callerOf(req, ERROR_STATUSES);

    const { user, bundle: source } = await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    const createdProject = await createProjectOnApi(caller, {
        name: source.project.name,
        description: source.project.description,
    });
    const duplicateId = createdProject.project_id;

    // Same compensation as POST /projects: a failed step deletes the partial duplicate.
    const bundle = await withCreatedProjectRollback(caller, duplicateId, async () => {
        const memberIds = source.users.map((member) => userPublicId(member.id));
        if (memberIds.length > 0) await syncProjectUsersOnApi(caller, duplicateId, memberIds);

        for (const task of source.tasks) {
            await createTaskOnApi(
                caller,
                duplicateId,
                mapTaskInputToBackend({
                    title: task.title,
                    status: mapTaskStatus(task.status),
                    priority: mapTaskPriority(task.priority),
                    assigneeIds: [],
                    labels: [],
                    dueDate: task.due_date ?? new Date().toISOString(),
                }),
            );
        }

        return fetchProjectBundle(caller, duplicateId);
    });

    res.status(201).json({
        project: buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
        taskItems: bundle.tasks.map((task) => buildTaskDtoForUser(user, task, bundle.users)),
    });
});

export default router;
