import { checkApis, checkApisResponseSchema, withoutSession } from '@mairie360/bffs-lib';
import { Router } from 'express';
import { coreApi } from '../clients/coreClient';
import { projectApi } from '../clients/projectClient';
import { userBffApi } from '../clients/userBffClient';
import { registry } from '../openapi-registry';

const router = Router();

/** Timeout of each availability probe, in ms. */
const PROBE_TIMEOUT_MS = 5_000;

// One `<name>: Connected | Unreachable` entry per upstream the BFF calls, probed through the /health operation
// of its contract at the same address as the real calls (`<SERVICE>_URL` + `<SERVICE>_PORT`), without a session.
const UPSTREAMS = {
  core_api: () => coreApi.health(withoutSession('CORE_API', PROBE_TIMEOUT_MS)),
  project_api: () => projectApi.health(withoutSession('PROJECT_API', PROBE_TIMEOUT_MS)),
  user_bff: () => userBffApi.getHealth(withoutSession('USER_BFF', PROBE_TIMEOUT_MS)),
};

export const CheckApisResponseSchema = registry.register(
  'CheckApisResponse',
  checkApisResponseSchema(['core_api', 'project_api', 'user_bff']),
);

registry.registerPath({
  method: 'get',
  path: '/check_apis',
  security: [],
  tags: ['Connectivity'],
  summary: 'Checks that Core API, Project API and BFF User are reachable',
  responses: {
    200: { description: 'Every upstream is reachable', content: { 'application/json': { schema: CheckApisResponseSchema } } },
    502: { description: 'At least one upstream is unreachable or not configured', content: { 'application/json': { schema: CheckApisResponseSchema } } },
  },
});

router.get('/', checkApis(UPSTREAMS));

export default router;
