import { KubeConfig } from '@kubernetes/client-node';

export function loadKubeConfig(env: NodeJS.ProcessEnv = process.env): KubeConfig {
  const kc = new KubeConfig();
  if (env.KUBERNETES_SERVICE_HOST) kc.loadFromCluster();
  else kc.loadFromDefault();
  return kc;
}
