import { loadConfig } from '../config/index.mjs';
import { ReviewStore } from '../companion/state';
import { updateRequest } from '../events/index';
import { agentStatus, selectTarget } from '../agents/index';
export { agentStatus, selectTarget };
export async function projectStore(base: string) {
  const config = await loadConfig(base);
  return ReviewStore.create(config.roots[0]!);
}
export async function failRequest(base: string, reviewId: string, findingId: string, error: string) {
  return updateRequest(
    await projectStore(base),
    reviewId,
    findingId,
    f =>
      f.rewriteRequest?.status === 'pending' || f.rewriteRequest?.status === 'claimed'
        ? { ...f, rewriteRequest: { ...f.rewriteRequest, status: 'failed', error } }
        : undefined,
    'rewrite.failed',
  );
}
