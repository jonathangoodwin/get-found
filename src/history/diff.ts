import type { GapReport, Opportunity, OpportunityKind } from "../types.js";

export interface OpportunityChange {
  kind: OpportunityKind;
  topic: string;
  previousScore: number;
  currentScore: number;
  previousPosition: number | null;
  currentPosition: number | null;
}

export interface SnapshotDiff {
  /** Present now, absent from the previous run. */
  newOpportunities: Opportunity[];
  /** Present in the previous run, absent now — a gap got covered, or a
   *  striking-distance query moved off page 2 (up or down). */
  resolvedOpportunities: Opportunity[];
  /** Present in both runs, but the score or position moved. */
  changedOpportunities: OpportunityChange[];
}

export interface DiffOptions {
  /** Score deltas at or below this are ignored as noise. */
  scoreChangeThreshold?: number;
}

/**
 * Pure comparison between two runs of the same site — the basis for "what
 * changed" alerts (Slack, a dashboard) without needing to re-crawl anything.
 * Opportunities are matched on kind+topic, not object identity, since each
 * run rebuilds the list from scratch.
 */
export function diffReports(previous: GapReport, current: GapReport, opts: DiffOptions = {}): SnapshotDiff {
  const scoreChangeThreshold = opts.scoreChangeThreshold ?? 0;

  const previousByKey = new Map(previous.opportunities.map((o) => [opportunityKey(o), o]));
  const currentByKey = new Map(current.opportunities.map((o) => [opportunityKey(o), o]));

  const newOpportunities = current.opportunities.filter((o) => !previousByKey.has(opportunityKey(o)));
  const resolvedOpportunities = previous.opportunities.filter((o) => !currentByKey.has(opportunityKey(o)));

  const changedOpportunities: OpportunityChange[] = [];
  for (const [key, currentOpportunity] of currentByKey) {
    const previousOpportunity = previousByKey.get(key);
    if (!previousOpportunity) continue;

    const scoreDelta = Math.abs(currentOpportunity.opportunityScore - previousOpportunity.opportunityScore);
    const positionChanged = currentOpportunity.currentPosition !== previousOpportunity.currentPosition;
    if (scoreDelta <= scoreChangeThreshold && !positionChanged) continue;

    changedOpportunities.push({
      kind: currentOpportunity.kind,
      topic: currentOpportunity.topic,
      previousScore: previousOpportunity.opportunityScore,
      currentScore: currentOpportunity.opportunityScore,
      previousPosition: previousOpportunity.currentPosition,
      currentPosition: currentOpportunity.currentPosition,
    });
  }

  return { newOpportunities, resolvedOpportunities, changedOpportunities };
}

function opportunityKey(opportunity: Opportunity): string {
  return `${opportunity.kind}::${opportunity.topic.toLowerCase()}`;
}
