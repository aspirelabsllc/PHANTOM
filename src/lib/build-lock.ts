// One live build per project. In-memory is sound here: a single Railway
// instance serves the app, and a process restart that loses the map also
// severs the routes that held it. TTL guards against a wedged turn.

const ACTIVE_BUILDS = new Map<string, number>();
const LOCK_TTL = 30 * 60 * 1000;

export function acquireBuildLock(projectId: string): boolean {
  const at = ACTIVE_BUILDS.get(projectId);
  if (at && Date.now() - at < LOCK_TTL) return false;
  ACTIVE_BUILDS.set(projectId, Date.now());
  return true;
}

export function releaseBuildLock(projectId: string): void {
  ACTIVE_BUILDS.delete(projectId);
}
