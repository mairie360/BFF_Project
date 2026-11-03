import 'dotenv/config';
// Before the app: OpenTelemetry must hook Express before it is loaded (MAIR-504).
import './telemetry';
import { assertConfigured, sessionKeysFromEnv } from '@mairie360/bffs-lib';
import app from './app';
import { logger } from './logger';

/** Every upstream this BFF calls, configured by `<SERVICE>_URL` (+ optional `<SERVICE>_PORT`). */
export const UPSTREAM_SERVICES = ['PROJECT_API', 'CORE_API'] as const;

/** Documented port of BFF Project. */
export const DEFAULT_PORT = 4001;

/**
 * Fail-fast startup check: a missing or invalid upstream URL, or no session key, stops the process instead of
 * answering 503 later. The session tokens are verified with Core's public key `JWT_PUBLIC_KEY` (MAIR-680, bffs-lib
 * requireSession); `JWT_SECRET` alone is still accepted during the transition (HS256 tokens).
 */
export function assertStartupConfiguration(): void {
  assertConfigured(UPSTREAM_SERVICES);
  let keys: ReturnType<typeof sessionKeysFromEnv>;
  try {
    keys = sessionKeysFromEnv();
  } catch {
    // The parsing detail is not needed to fix it, and the key is not logged.
    throw new Error('Invalid configuration: JWT_PUBLIC_KEY must hold Ed25519 PUBLIC KEY PEM blocks');
  }
  if (keys === undefined) {
    throw new Error('Missing configuration: JWT_PUBLIC_KEY (or JWT_SECRET during the HS256 transition)');
  }
}

if (require.main === module) {
  assertStartupConfiguration();

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  app.listen(port, () => {
    logger.info('server listening', { port });
  });
}
