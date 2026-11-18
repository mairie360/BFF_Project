import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');

/** Starts the real entry point (as `npm start` does, without watch) and resolves once it listens. */
async function startBff(): Promise<{ child: ChildProcess; output: () => string }> {
  const upstream = 'http://127.0.0.1:1';
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/index.ts')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      PORT: '0',
      NODE_ENV: 'production',
      LOG_FORMAT: 'json',
      JWT_SECRET: 'secret',
      CORE_API_URL: upstream,
      PROJECT_API_URL: upstream,
      CALENDAR_API_URL: upstream,
      MESSAGE_API_URL: upstream,
      ELEARNING_API_URL: upstream,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk; });
  child.stderr?.on('data', (chunk) => { output += chunk; });
  await new Promise<void>((resolve, reject) => {
    const check = setInterval(() => {
      if (/listening/i.test(output)) { clearInterval(check); resolve(); }
    }, 50);
    child.once('exit', (code) => { clearInterval(check); reject(new Error(`BFF exited with ${code}: ${output}`)); });
  });
  return { child, output: () => output };
}

describe('MAIR-682 graceful shutdown of the BFF', () => {
  it('drains and exits with 0 on SIGTERM instead of being killed by the signal', async () => {
    const { child, output } = await startBff();
    child.kill('SIGTERM');
    const [code, signal] = await once(child, 'exit');
    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(output()).toContain('shutting down');
  }, 60_000);

  it('runs tini as PID 1 in the image, so SIGTERM reaches Node', () => {
    const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/apk add --no-cache[^\n]*\btini\b/);
    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
  });
});
