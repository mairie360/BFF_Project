import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    createProjectOnApi,
    createTaskOnApi,
    fetchProjectBundle,
    handleUnknownError,
    mapTaskInputToBackend,
    mapTaskPriority,
    mapTaskStatus,
    parseProjectId,
    sendValidationError,
    syncProjectUsersOnApi,
    userPublicId,
    withCreatedProjectRollback,
} from './project_helpers';
import { requireProjectManagement } from './project_access';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
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
    const paramsResult = ProjectIdParams.safeParse(req.params);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
    }

    const projectId = parseProjectId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, 'params', [
            {
                path: ['projectId'],
                message: 'projectId must be a project-<id> identifier',
            },
        ]);
    }

    try {
        const access = await requireProjectManagement(res, projectId);
        if (!access) return;
        const { user, bundle: source } = access;
        const createdProject = await createProjectOnApi({
            name: source.project.name,
            description: source.project.description,
        });
        const duplicateId = createdProject.project_id;

        // Same compensation as POST /projects: a failed step deletes the partial duplicate.
        const bundle = await withCreatedProjectRollback(duplicateId, async () => {
            const memberIds = source.users.map((member) => userPublicId(member.id));
            if (memberIds.length > 0) await syncProjectUsersOnApi(duplicateId, memberIds);

            for (const task of source.tasks) {
                await createTaskOnApi(
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

            return fetchProjectBundle(duplicateId);
        });

        return res.status(201).json({
            project: await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
            taskItems: await Promise.all(bundle.tasks.map((task) =>
                buildTaskDtoForUser(user, duplicateId, task, bundle.users),
            )),
        });
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
