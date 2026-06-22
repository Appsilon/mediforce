import { describe, it, expect, vi } from 'vitest';
import { KubeConfig } from '@kubernetes/client-node';
import { loadKubeConfig } from '../kube-config';

describe('loadKubeConfig', () => {
  it('uses loadFromCluster when KUBERNETES_SERVICE_HOST is set', () => {
    const spy = vi.spyOn(KubeConfig.prototype, 'loadFromCluster');
    loadKubeConfig({ KUBERNETES_SERVICE_HOST: '10.0.0.1' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('uses loadFromDefault otherwise', () => {
    const spy = vi.spyOn(KubeConfig.prototype, 'loadFromDefault');
    loadKubeConfig({});
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
