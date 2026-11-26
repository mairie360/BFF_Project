import { GlobalSearchResponseSchema, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LENGTH, SEARCH_MAX_LIMIT, SEARCH_MIN_LENGTH, globalSearchHandler, noStore, requireSession } from '@mairie360/bffs-lib';
import { Router } from 'express';
import { logger } from '../logger';
import { ErrorResponse as ErrorBody, registry } from '../openapi-registry';

const router = Router();

// The header's global search: the lib queries the five business APIs directly (never another BFF), with the caller's
// token, and merges their results by module. An API that cannot answer is listed in `unavailable`.
// clone(): the lib builds its schemas before extendZodWithOpenApi() (like the error envelope).
const SearchResponseSchema = registry.register('GlobalSearchResponse', GlobalSearchResponseSchema.clone());

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorBody } } });

registry.registerPath({
  method: 'get',
  path: '/search',
  tags: ['Search'],
  summary: 'Search every module',
  description:
    'Searches the agents, projects and tasks, events, conversations and messages, and courses the caller may see, '
    + 'through the business APIs. A module whose API cannot answer is listed in `unavailable`.',
  parameters: [
    {
      name: 'q',
      in: 'query',
      required: true,
      description: `Searched text, ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters once trimmed, without control characters`,
      schema: { type: 'string', minLength: SEARCH_MIN_LENGTH, maxLength: SEARCH_MAX_LENGTH, example: 'dupont' },
    },
    {
      name: 'limit',
      in: 'query',
      required: false,
      description: `Most results per module (default ${SEARCH_DEFAULT_LIMIT})`,
      schema: { type: 'integer', minimum: 1, maximum: SEARCH_MAX_LIMIT, example: SEARCH_DEFAULT_LIMIT },
    },
  ],
  responses: {
    200: {
      description: 'Results grouped by module, and the modules that could not answer',
      content: { 'application/json': { schema: SearchResponseSchema } },
    },
    400: errorResponse('Invalid `q` or `limit`'),
    401: errorResponse('Missing or invalid session'),
    500: errorResponse('Unexpected server error'),
    503: errorResponse('JWT_PUBLIC_KEY is not configured'),
  },
});

router.get('/', noStore, requireSession, globalSearchHandler({ logger }));

export default router;
