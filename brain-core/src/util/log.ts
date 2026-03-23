const PREFIX = '[nexus-brain]';

export function brainLog(scope: string, message: string, extra?: Record<string, unknown>): void {
  const line = `${PREFIX} ${scope}: ${message}`;
  if (extra && Object.keys(extra).length) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}
