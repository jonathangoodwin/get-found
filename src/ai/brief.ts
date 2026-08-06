import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { ContentBrief, Opportunity } from "../types.js";

/**
 * Typed seam between the deterministic gap-engine and any LLM. The
 * rule-based drafter below requires no API key and ships in v0; a Claude-
 * backed drafter can implement the same interface later without touching
 * callers. Every ContentBrief is labeled with its `source` so a report never
 * silently presents AI output as human-reviewed fact.
 */
export interface BriefDrafter {
  draftBrief(opportunity: Opportunity): Promise<ContentBrief>;
}

export class RuleBasedBriefDrafter implements BriefDrafter {
  async draftBrief(opportunity: Opportunity): Promise<ContentBrief> {
    return {
      topic: opportunity.topic,
      primaryKeyword: opportunity.topic,
      secondaryKeywords: [],
      searchIntent: "unknown",
      suggestedHeadings: [capitalize(opportunity.topic)],
      questionsToAnswer: [],
      notes:
        opportunity.kind === "content-gap"
          ? `Covered by: ${opportunity.competitorsCovering.join(", ")}. No clustering or intent inference applied — configure an AI drafter for a real brief.`
          : `Currently ranking position ${opportunity.currentPosition} with ${opportunity.impressions} monthly impressions. Improve existing page rather than creating a new one.`,
      source: "rule-based",
    };
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const briefSchema = z.object({
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  searchIntent: z.enum(["informational", "commercial", "transactional", "navigational", "unknown"]),
  suggestedHeadings: z.array(z.string()),
  questionsToAnswer: z.array(z.string()),
  notes: z.string(),
});

export interface ClaudeBriefDrafterOptions {
  /** Reuse an existing client (e.g. to share config) instead of constructing one. */
  client?: Anthropic;
  /** e.g. "senior-care / assisted-living operators" — sharpens intent and entity choices in the brief. */
  businessContext?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Drafts a real content brief via Claude, behind the same BriefDrafter
 * interface as the rule-based fallback. Every output is labeled
 * "ai-drafted" — see the human-in-the-loop principle in the project design
 * notes: this is a starting point for a navigator/writer to edit, not
 * publish-ready copy.
 */
export class ClaudeBriefDrafter implements BriefDrafter {
  private readonly client: Anthropic;
  private readonly businessContext: string | undefined;
  private readonly effort: NonNullable<ClaudeBriefDrafterOptions["effort"]>;

  constructor(options: ClaudeBriefDrafterOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.businessContext = options.businessContext;
    this.effort = options.effort ?? "medium";
  }

  async draftBrief(opportunity: Opportunity): Promise<ContentBrief> {
    const response = await this.client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 4096,
      output_config: {
        effort: this.effort,
        format: zodOutputFormat(briefSchema),
      },
      messages: [{ role: "user", content: this.buildPrompt(opportunity) }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(
        `Claude declined to draft a brief for "${opportunity.topic}" (stop_reason: ${response.stop_reason})`
      );
    }

    return {
      topic: opportunity.topic,
      ...response.parsed_output,
      source: "ai-drafted",
    };
  }

  private buildPrompt(opportunity: Opportunity): string {
    const context =
      opportunity.kind === "content-gap"
        ? `This topic is covered by competitor site(s) ${opportunity.competitorsCovering.join(", ")} but has no matching page on our own site — it's a new-content opportunity.`
        : `This is our own existing page (${opportunity.ownUrl}), currently ranking position ${opportunity.currentPosition} with roughly ${opportunity.impressions ?? "unknown"} monthly impressions — it needs improvement to reach page 1, not a rewrite from scratch.`;

    return [
      `Draft an SEO content brief for the topic: "${opportunity.topic}".`,
      this.businessContext ? `Business context: ${this.businessContext}.` : null,
      context,
      "Identify the primary keyword, up to 6 secondary keywords, the dominant search intent, a suggested H2/H3 heading outline that would out-cover what's currently ranking, and up to 5 People-Also-Ask-style questions the page should answer.",
      "This is decision-support for a human writer, not a finished article — headings and notes only, no drafted prose.",
    ]
      .filter(Boolean)
      .join("\n");
  }
}
