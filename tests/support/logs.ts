/**
 * Silences the JSON log lines the BFF writes on stdout (MAIR-531) and returns them parsed, for the test to check.
 * Restored by `jest.restoreAllMocks()`.
 */
export function captureLogs(): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    for (const line of String(chunk).split('\n').filter(Boolean)) {
      try {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        lines.push({ message: line });
      }
    }
    return true;
  }) as typeof process.stdout.write);
  return lines;
}
