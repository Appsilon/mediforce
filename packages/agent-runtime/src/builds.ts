/**
 * The image builder and the carried-file helpers, without the plugins.
 *
 * A sub-path of its own because the package index pulls in
 * `base-container-agent-plugin`, whose `import.meta` a CommonJS loader — the
 * Playwright one the L3 journeys run under — cannot parse. Nothing here needs a
 * plugin, so nothing here should drag one in.
 */
export { ensureImage, buildImageFromDirectory, buildImageFromRepo } from './plugins/docker-image-builder';
export {
  artifactsBuildHash,
  artifactsBuildTag,
  artifactsDir,
  materializeArtifacts,
  CONTAINER_ARTIFACTS_MOUNT,
  type CarriedBuild,
} from './plugins/workflow-artifacts';
