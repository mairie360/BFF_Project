import { Router, Request, Response } from 'express';
import { HttpError } from '@mairie360/bffs-lib';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, UpdateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import {
    addProjectUsersOnApi,
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    mapPriorityToBackend,
    mapProjectStatusToBackend,
    parseGroupIdField,
    pickResponsible,
    requireLinkableGroup,
    requireProjectIdParam,
    syncProjectUsersOnApi,
    userPublicId,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf, getProjectBundle, updateProjectRecord } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Partially update a project',
    description: 'Only the sent fields change. Members are rewritten only when `assigneeIds` is sent (the current responsible is kept unless `responsibleId` is sent); a `responsibleId` alone adds that member. `status` and `priority` are stored (MAIR-558); `budgetVoted` / `budgetCommitted` (cents of euro, MAIR-1085) are kept when absent, cleared by `null`, and a negative amount is a `400`; `groupId` changes the group of the project (`404` for a group the caller may not link, `400` for `null`: a project always keeps a group); `labels`, `dueDate` and `taskItems` are accepted but not persisted by Project API: the response is the re-read state. When the update is saved but the re-read no longer finds the project (a caller who saw it only through the group they replaced), the answer is `204` without a body; a caller who still sees it, through another group or as a member, gets `200`.',

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

        204: {
            description: 'Project updated, but the caller removed the group through which they saw it: they no longer see the project',
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
            description: 'Project not found, or a group the caller may not link',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },
    },
});

router.patch('/:projectId', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectIdParams, req.params, 'params');
    const body = parseRequest(UpdateProjectBody, req.body, 'body');
    const projectId = requireProjectIdParam(params.projectId);
    const caller = callerOf(req, ERROR_STATUSES);

    const { user, bundle: current } = await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    await requireAssignableUsers(caller, user, [
        ...(body.responsibleId ? [body.responsibleId] : []),
        ...(body.assigneeIds ?? []),
    // The current members stay assignable by whoever manages the project (MAIR-1088).
    ], async () => current.users.map((member) => member.id));

    const groupId = body.groupId === undefined ? undefined : parseGroupIdField(body.groupId);
    if (groupId !== undefined) {
        await requireLinkableGroup(caller, groupId, new HttpError(404, 'Unknown group.'));
    }

    const updateRecord = async () => {
        if (
            body.title !== undefined || body.description !== undefined || body.status !== undefined
            || body.priority !== undefined || body.groupId !== undefined
            || body.budgetVoted !== undefined || body.budgetCommitted !== undefined
        ) {
            await updateProjectRecord(caller, projectId, {
                groupId,
                title: body.title,
                description: body.description,
                status: body.status === undefined ? undefined : mapProjectStatusToBackend(body.status),
                priority: body.priority === undefined ? undefined : mapPriorityToBackend(body.priority),
                budgetVoted: body.budgetVoted,
                budgetCommitted: body.budgetCommitted,
            });
        }
    };

    // A PATCH is partial: the membership is only rewritten when `assigneeIds` is sent, and then from
    // the merged state (the current responsible, its first `manager` member, stays unless `responsibleId` is sent).
    // A `responsibleId` alone only adds that member, as a `manager`, and removes nobody.
    const updateMembers = async () => {
        const managerIds = body.responsibleId ? [body.responsibleId] : [];
        if (body.assigneeIds !== undefined) {
            const currentResponsible = pickResponsible(current.users);
            const responsible = body.responsibleId ?? (currentResponsible ? userPublicId(currentResponsible.id) : '');
            await syncProjectUsersOnApi(caller, projectId, [...(responsible ? [responsible] : []), ...body.assigneeIds], current.users, managerIds);
        } else if (body.responsibleId) {
            await addProjectUsersOnApi(caller, projectId, [body.responsibleId], current.users, managerIds);
        }
    };

    // Changing the group can take the project away from a caller who saw it only through the former
    // group: the members are then written first, while the caller still sees the project.
    const changesGroup = body.groupId !== undefined;
    if (changesGroup) {
        await updateMembers();
        await updateRecord();
    } else {
        await updateRecord();
        await updateMembers();
    }

    // Only the state Project API persisted is returned (labels and dueDate are not stored).
    const bundle = await getProjectBundle(caller, projectId);
    if (!bundle) {
        // Saved, but the caller no longer sees the project: only after replacing the group it came through.
        if (changesGroup) {
            res.status(204).end();
            return;
        }
        throw new HttpError(404, 'Project not found.');
    }
    res.status(200).json({
        project: buildProjectDtoForUser(user, bundle),
        taskItems: bundle.tasks.map((task) => buildTaskDtoForUser(user, task, bundle.users, bundle.project.can_manage)),
    });
});

export default router;
