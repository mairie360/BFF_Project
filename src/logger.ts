import { createLogger } from '@mairie360/bffs-lib';

/**
 * Logger of the BFF (MAIR-531): one JSON line per event on stdout (`timestamp`, `level`, `target`, `message`,
 * fields). Fields are scalars: log an error through `describeError(error)`, never a token, a body or the error itself.
 */
export const logger = createLogger({ target: 'bff-project' });
