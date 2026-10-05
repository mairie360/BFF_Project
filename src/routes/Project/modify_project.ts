import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, UpdateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
    addProjectUsersOnApi,
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    fetchProjectBundle,
    handleUnknownError,
    parseProjectId,
    sendValidationError,
    syncProjectUsersOnApi,
    userPublicId,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { updateProjectRecord } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Partially update a project',
    description: 'Only the sent fields change. Members are rewritten only when `assigneeIds` is sent (the current responsible is kept unless `responsibleId` is sent); a `responsibleId` alone adds that member. `priority`, `labels`, `dueDate` and `taskItems` are accepted but not persisted by Project API: the response is the re-read state.',

    request: {
        params: ProjectIdParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpdateProjectBody,
                },
            },
        },
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        200: {
            description: 'Project updated, as re-read from Project API',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
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

router.patch('/:projectId', async (req: Request, res: Response) => {
    const paramsResult = ProjectIdParams.safeParse(req.params);
    const bodyResult = UpdateProjectBody.safeParse(req.body);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
    }

    if (!bodyResult.success) {
        return sendValidationError(res, 'body', bodyResult.error.issues);
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
        const { user, bundle: current } = access;
        const body = bodyResult.data;
        const requestedUserIds = [
            ...(body.responsibleId ? [body.responsibleId] : []),
            ...(body.assigneeIds ?? []),
        ];
        if (!await requireAssignableUsers(res, user, requestedUserIds)) return;

        if (body.title !== undefined || body.description !== undefined || body.status !== undefined) {
            await updateProjectRecord(projectId, body);
        }

        // A PATCH is partial: the membership is only rewritten when `assigneeIds` is sent, and then from
        // the merged state (the current responsible, the first member, stays unless `responsibleId` is sent).
        // A `responsibleId` alone only adds that member and removes nobody.
        if (body.assigneeIds !== undefined) {
            const currentResponsible = current.users[0] ? userPublicId(current.users[0].id) : '';
            const responsible = body.responsibleId ?? currentResponsible;
            await syncProjectUsersOnApi(projectId, [...(responsible ? [responsible] : []), ...body.assigneeIds], current.users);
        } else if (body.responsibleId) {
            await addProjectUsersOnApi(projectId, [body.responsibleId], current.users);
        }

        // Only the state Project API persisted is returned (priority, labels and dueDate are not stored).
        const bundle = await fetchProjectBundle(projectId);
        return res.status(200).json({
            project: await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
            taskItems: await Promise.all(bundle.tasks.map((task) =>
                buildTaskDtoForUser(user, projectId, task, bundle.users),
            )),
        });
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
