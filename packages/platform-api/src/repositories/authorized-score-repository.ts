import type { ListScoresFilter, Score, ScoreRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Scores are direct-namespace rows. A user caller reads only their workspaces
 * (`filter.namespace` narrows inside them, never widens) and writes only into
 * one of them.
 */
export class AuthorizedScoreRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: ScoreRepository,
  ) {
    super(caller);
  }

  create = async (score: Score): Promise<Score> => {
    this.assertNamespaceWrite(score.namespace);
    return this.raw.create(score);
  };

  list = async (filter: ListScoresFilter): Promise<Score[]> =>
    this.caller.isSystemActor
      ? this.raw.list(filter)
      : this.raw.listInNamespaces([...this.caller.namespaces], filter);
}
