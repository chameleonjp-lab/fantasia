/** Test-owned synchronization only. No application queue/fence access. */
export interface OwnedFence { gl: WebGL2RenderingContext; sync: WebGLSync; released: boolean }
export function createOwnedFence(): OwnedFence {
  const canvas = document.querySelector<HTMLCanvasElement>('#flight');
  if (!canvas) throw new Error('Real flight canvas unavailable');
  const gl = canvas.getContext('webgl2');
  if (!gl || gl.isContextLost()) throw new Error('Real WebGL2 context unavailable');
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) throw new Error('Test-owned GPU fence unavailable');
  try { gl.flush(); } catch (error) { gl.deleteSync(sync); throw error; }
  return { gl, sync, released: false };
}
export function pollOwnedFence(owner: OwnedFence): 'ready' | 'pending' {
  if (owner.released) throw new Error('Test fence already released');
  if (owner.gl.isContextLost()) throw new Error('Context lost while waiting for real GPU');
  const result = owner.gl.clientWaitSync(owner.sync, 0, 0);
  if (result === owner.gl.ALREADY_SIGNALED || result === owner.gl.CONDITION_SATISFIED) return 'ready';
  if (result === owner.gl.TIMEOUT_EXPIRED) return 'pending';
  throw new Error('Native GPU fence wait failed');
}
export function releaseOwnedFence(owner: OwnedFence): void {
  if (owner.released) return;
  owner.released = true; owner.gl.deleteSync(owner.sync);
}
