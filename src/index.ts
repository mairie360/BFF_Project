import 'dotenv/config';
import { assertConfigured } from '@mairie360/bffs-lib';
import app from './app';

/** Every upstream this BFF calls, configured by `<SERVICE>_URL` (+ optional `<SERVICE>_PORT`). */
export const UPSTREAM_SERVICES = ['USER_BFF', 'PROJECT_API', 'CORE_API'] as const;

if (require.main === module) {
  // Fail fast: a missing or invalid upstream URL stops the process instead of answering 503 later.
  assertConfigured(UPSTREAM_SERVICES);

  const PORT = process.env.PORT;
  if (!PORT) {
    console.error('Error: PORT environment variable is not set.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
