import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '../src/index';
import { JWT_PUBLIC_KEY } from './support/session-keys';

const ROOT = path.join(__dirname, '..');
const UPSTREAMS = ['CORE_API', 'PROJECT_API', 'CALENDAR_API', 'MESSAGE_API', 'ELEARNING_API'];
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

/** Rejects after `ms`, so a stuck child fails the test before the Jest timeout instead of hanging it. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took more than ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe('MAIR-682 graceful shutdown of the BFF', () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
    // Whatever failed above, no BFF process outlives the test.
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }
    child = undefined;
  });

  it('the real entry point drains and exits with 0 on SIGTERM instead of being killed by the signal', async () => {
    const upstream = 'http://127.0.0.1:1';
    child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/index.ts')], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        PORT: '0',
        NODE_ENV: 'production',
        LOG_FORMAT: 'json',
        LOG_LEVEL: 'info',
        JWT_PUBLIC_KEY,
        CORE_API_URL: upstream,
        PROJECT_API_URL: upstream,
        CALENDAR_API_URL: upstream,
        MESSAGE_API_URL: upstream,
        ELEARNING_API_URL: upstream,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const listening = new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (/listening/i.test(output)) resolve();
      };
      child?.stdout?.on('data', onData);
      child?.stderr?.on('data', onData);
      child?.once('exit', (code) => reject(new Error(`the BFF exited with ${code}: ${output}`)));
    });
    // `close` comes after the exit and the end of stdout / stderr: the last log line is then read.
    const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;

    await within(listening, STARTUP_TIMEOUT_MS, 'the startup');
    child.kill('SIGTERM');
    const [code, signal] = await within(closed, SHUTDOWN_TIMEOUT_MS, 'the shutdown');

    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(output).toContain('shutting down');
  }, 60_000);

  it('serve() handles SIGTERM and closes the server through the drain', async () => {
    const saved = { ...process.env };
    for (const service of UPSTREAMS) process.env[`${service}_URL`] = 'http://127.0.0.1:1';
    const before = process.listenerCount('SIGTERM');
    const { server, shutdown } = serve(0);
    try {
      if (!server.listening) await once(server, 'listening');
      expect(process.listenerCount('SIGTERM')).toBe(before + 1);
      await expect(shutdown.shutdown('test')).resolves.toBe(0);
      expect(server.listening).toBe(false);
    } finally {
      shutdown.dispose();
      process.env = saved;
    }
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('runs tini as PID 1 in the image, so SIGTERM reaches Node', () => {
    const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/apk add --no-cache[^\n]*\btini\b/);
    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
  });
});
