import 'dotenv/config';
import { assertConfigured } from '@mairie360/bffs-lib';
import app from './app';

/** Every upstream this BFF calls, configured by `<SERVICE>_URL` (+ optional `<SERVICE>_PORT`). */
export const UPSTREAM_SERVICES = ['USER_BFF', 'PROJECT_API', 'CORE_API'] as const;

/** Documented port of BFF Project. */
export const DEFAULT_PORT = 4001;

if (require.main === module) {
  // Fail fast: a missing or invalid upstream URL stops the process instead of answering 503 later.
  assertConfigured(UPSTREAM_SERVICES);
  // The session tokens are verified with it (bffs-lib requireSession): without it every session route answers 503.
  if (!process.env.JWT_SECRET?.trim()) {
    throw new Error('Missing configuration: JWT_SECRET');
  }

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}
