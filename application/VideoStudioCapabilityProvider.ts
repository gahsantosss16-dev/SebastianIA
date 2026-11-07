import { CapabilityRegistry, CapabilityExecutionBundleBuilder, CapabilityExecutionGateway, type CapabilityProvider } from '../core/capability/index.js';
import { createVideoPlan, type VideoPlan } from '../video-studio/storyboard.js';
export const VIDEO_STORYBOARD_CAPABILITY_ID = 'cap.video.storyboard';
export const videoStudioCapabilityProvider: CapabilityProvider = {
  providerId: 'provider.video.local',
  listRegistrations: () => [{
    descriptor: { id: VIDEO_STORYBOARD_CAPABILITY_ID, name: 'Video storyboard (free, local)', version: '1.0.0', handlerId: 'handler.video.storyboard' },
    handler: ({ input }) => ({ plan: createVideoPlan(input.idea, input.durationSeconds) }),
  }],
};

/** HTTP invokes the same registered capability without changing Core's command whitelist. */
export function invokeVideoStoryboard(input: Record<string, unknown>): VideoPlan {
  const registry = new CapabilityRegistry({ readOnly: true, entries: videoStudioCapabilityProvider.listRegistrations() });
  const bundle = new CapabilityExecutionBundleBuilder().build(registry);
  return new CapabilityExecutionGateway().execute({ capabilityId: VIDEO_STORYBOARD_CAPABILITY_ID, input, context: { source: 'video-studio' }, generatedAt: new Date().toISOString() }, bundle).output.plan as VideoPlan;
}
