import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";

/**
 * Typed seam between user-supplied keyword themes and any LLM, same pattern
 * as BriefDrafter/OutreachDrafter: a rule-based fallback ships with zero API
 * keys, a Claude-backed implementation slots in behind the same interface.
 */
export interface KeywordExpander {
  expandKeywords(themes: string[], context: KeywordExpansionContext): Promise<string[]>;
}

export interface KeywordExpansionContext {
  businessContext?: string;
}

const MODIFIERS = ["", " pricing", " cost", " near me", " vs", " reviews", " guide"];
const DEFAULT_MAX_KEYWORDS = 25;

/**
 * No LLM involved: appends a fixed set of common search-intent modifiers to
 * each seed theme. This is a mechanical widening, not real semantic
 * expansion (no synonyms, no adjacent concepts) — configure ANTHROPIC_API_KEY
 * for that. Capped the same way the Claude expander is, since every keyword
 * here becomes a live Trends lookup.
 */
export class RuleBasedKeywordExpander implements KeywordExpander {
  constructor(private readonly maxKeywords: number = DEFAULT_MAX_KEYWORDS) {}

  async expandKeywords(themes: string[], _context: KeywordExpansionContext): Promise<string[]> {
    const expanded = themes.flatMap((theme) => MODIFIERS.map((mod) => `${theme}${mod}`.trim()));
    return dedupe(expanded).slice(0, this.maxKeywords);
  }
}

const expansionSchema = z.object({
  keywords: z.array(z.string()),
});

export interface ClaudeKeywordExpanderOptions {
  client?: Anthropic;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Caps how many total keywords come back, bounding downstream Trends API calls. */
  maxKeywords?: number;
}

/**
 * Expands a short list of seed themes into related search queries worth
 * tracking — synonyms, adjacent concepts, and common query patterns a
 * rule-based modifier list can't produce. Every keyword returned still gets
 * checked against real Google Trends data before being called a signal, so
 * a bad expansion just means a wasted lookup, not a false alert.
 */
export class ClaudeKeywordExpander implements KeywordExpander {
  private readonly client: Anthropic;
  private readonly effort: NonNullable<ClaudeKeywordExpanderOptions["effort"]>;
  private readonly maxKeywords: number;

  constructor(options: ClaudeKeywordExpanderOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.effort = options.effort ?? "medium";
    this.maxKeywords = options.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
  }

  async expandKeywords(themes: string[], context: KeywordExpansionContext): Promise<string[]> {
    const response = await this.client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: {
        effort: this.effort,
        format: zodOutputFormat(expansionSchema),
      },
      messages: [{ role: "user", content: this.buildPrompt(themes, context) }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`Claude declined to expand keyword themes (stop_reason: ${response.stop_reason})`);
    }

    return dedupe([...themes, ...response.parsed_output.keywords]).slice(0, this.maxKeywords);
  }

  private buildPrompt(themes: string[], context: KeywordExpansionContext): string {
    return [
      `Expand these seed keyword themes into a list of up to ${this.maxKeywords} related search queries worth tracking for sudden spikes in search interest: ${themes.join(", ")}.`,
      context.businessContext ? `Business context: ${context.businessContext}.` : null,
      "Include synonyms, adjacent concepts, and common ways real users phrase these searches. Each entry should be a plausible standalone Google search query, not a topic label.",
    ]
      .filter(Boolean)
      .join("\n");
  }
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value.trim());
  }
  return result;
}
