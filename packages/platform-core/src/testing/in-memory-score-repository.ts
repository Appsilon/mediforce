import type { ListScoresFilter, ScoreRepository } from '../interfaces/score-repository';
import { ScoreSchema, type Score } from '../schemas/score';

export class InMemoryScoreRepository implements ScoreRepository {
  private readonly scores: Score[] = [];

  async create(score: Score): Promise<Score> {
    const parsed = ScoreSchema.parse(score);
    this.scores.push(parsed);
    return parsed;
  }

  async list(filter: ListScoresFilter): Promise<Score[]> {
    return this.select(filter, () => true);
  }

  async listInNamespaces(allowed: readonly string[], filter: ListScoresFilter): Promise<Score[]> {
    return this.select(filter, (score) => allowed.includes(score.namespace));
  }

  private select(filter: ListScoresFilter, inScope: (score: Score) => boolean): Score[] {
    return this.scores
      .filter(inScope)
      .filter((score) =>
        (filter.agentRunId === undefined
          || (score.subject.type === 'agent_run' && score.subject.id === filter.agentRunId))
        && (filter.processInstanceId === undefined || score.processInstanceId === filter.processInstanceId)
        && (filter.stepId === undefined || score.stepId === filter.stepId)
        && (filter.name === undefined || score.name === filter.name)
        && (filter.namespace === undefined || score.namespace === filter.namespace))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, filter.limit);
  }
}
