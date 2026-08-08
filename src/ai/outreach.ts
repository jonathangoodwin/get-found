import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { ContactChannel, Opportunity, OutreachDraft } from "../types.js";

export interface OutreachContext {
  ownDomain: string;
  businessContext?: string;
}

/**
 * Same seam as BriefDrafter, for outreach instead of content briefs. Every
 * OutreachDrafter only ever produces a draft — nothing in this codebase
 * sends it. That boundary is deliberate: an agent that auto-emails a list
 * of webmasters unsupervised is a spam pipeline, not an outreach tool.
 */
export interface OutreachDrafter {
  draftOutreach(opportunity: Opportunity, contact: ContactChannel | null, context: OutreachContext): Promise<OutreachDraft>;
}

export class RuleBasedOutreachDrafter implements OutreachDrafter {
  async draftOutreach(opportunity: Opportunity, contact: ContactChannel | null, context: OutreachContext): Promise<OutreachDraft> {
    const contactNote = contact ? "" : "\n(No public contact channel was found for this domain — verify before sending.)";
    return {
      targetDomain: opportunity.topic,
      subject: `Link opportunity for ${opportunity.topic}`,
      message: [
        "Hi,",
        "",
        `I noticed ${opportunity.topic} links to ${opportunity.competitorsCovering.join(", ") || "some related sites"}. We publish related content at ${context.ownDomain} that may be a useful addition too.`,
        `${contactNote}`,
        "",
        "Configure an AI drafter for a real, personalized message.",
      ].join("\n"),
      source: "rule-based",
    };
  }
}

const outreachSchema = z.object({
  subject: z.string(),
  message: z.string(),
});

export interface ClaudeOutreachDrafterOptions {
  client?: Anthropic;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Drafts a real outreach email via Claude. Labeled "ai-drafted" like every
 * other AI output in this project — the human sending it is expected to
 * read, personalize further, and decide whether to send it at all.
 */
export class ClaudeOutreachDrafter implements OutreachDrafter {
  private readonly client: Anthropic;
  private readonly effort: NonNullable<ClaudeOutreachDrafterOptions["effort"]>;

  constructor(options: ClaudeOutreachDrafterOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.effort = options.effort ?? "medium";
  }

  async draftOutreach(opportunity: Opportunity, contact: ContactChannel | null, context: OutreachContext): Promise<OutreachDraft> {
    const response = await this.client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: {
        effort: this.effort,
        format: zodOutputFormat(outreachSchema),
      },
      messages: [{ role: "user", content: this.buildPrompt(opportunity, contact, context) }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(
        `Claude declined to draft outreach for "${opportunity.topic}" (stop_reason: ${response.stop_reason})`
      );
    }

    return {
      targetDomain: opportunity.topic,
      ...response.parsed_output,
      source: "ai-drafted",
    };
  }

  private buildPrompt(opportunity: Opportunity, contact: ContactChannel | null, context: OutreachContext): string {
    return [
      `Draft a short, personalized link-outreach email to send to a webmaster at ${opportunity.topic}.`,
      `This domain currently links to competitor site(s) ${opportunity.competitorsCovering.join(", ")} but not to ours (${context.ownDomain}).`,
      context.businessContext ? `Business context: ${context.businessContext}.` : null,
      contact?.contactPageUrl ? `Their published contact page: ${contact.contactPageUrl}.` : null,
      "Write it from the perspective of someone at our company reaching out directly — genuine, specific, and brief (under 150 words). Explain concretely why a link to our site would be useful to THEIR audience, not just why it benefits us. No generic template language, no overselling, no fake urgency.",
      "This is a draft for a human to review and personalize further before sending — it will not be sent automatically.",
    ]
      .filter(Boolean)
      .join("\n");
  }
}
