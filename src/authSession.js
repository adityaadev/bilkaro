export function createAuthSessionGuard() {
  let generation = 0;

  return {
    capture: () => generation,
    invalidate: () => ++generation,
    isCurrent: (capturedGeneration) => capturedGeneration === generation,
  };
}

export function commitIfCurrent(guard, capturedGeneration, commit) {
  if (!guard.isCurrent(capturedGeneration)) return false;
  commit();
  return true;
}
