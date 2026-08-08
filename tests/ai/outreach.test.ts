import { describe, expect, it } from "vitest";
import { RuleBasedOutreachDrafter } from "../../src/ai/outreach.js";
import type { ContactChannel, Opportunity } from "../../src/types.js";

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    kind: "link-gap",
    topic: "senior-resources.org",
    competitorsCovering: ["compa.com", "compb.com"],
    ownUrl: null,
    currentPosition: null,
    impressions: null,
    opportunityScore: 500,
    ...overrides,
  };
}

const context = { ownDomain: "ours.com" };

describe("RuleBasedOutreachDrafter", () => {
  it("labels the draft as rule-based", async () => {
    const drafter = new RuleBasedOutreachDrafter();
    const draft = await drafter.draftOutreach(opportunity(), null, context);
    expect(draft.source).toBe("rule-based");
    expect(draft.targetDomain).toBe("senior-resources.org");
  });

  it("mentions the competitors the target already links to", async () => {
    const drafter = new RuleBasedOutreachDrafter();
    const draft = await drafter.draftOutreach(opportunity(), null, context);
    expect(draft.message).toContain("compa.com, compb.com");
  });

  it("mentions the own domain", async () => {
    const drafter = new RuleBasedOutreachDrafter();
    const draft = await drafter.draftOutreach(opportunity(), null, context);
    expect(draft.message).toContain("ours.com");
  });

  it("notes when no contact channel was found", async () => {
    const drafter = new RuleBasedOutreachDrafter();
    const draft = await drafter.draftOutreach(opportunity(), null, context);
    expect(draft.message).toContain("No public contact channel was found");
  });

  it("omits the no-contact-channel note when a contact channel was found", async () => {
    const contact: ContactChannel = { url: "https://senior-resources.org/", email: "info@senior-resources.org", contactPageUrl: null, socialLinks: [] };
    const drafter = new RuleBasedOutreachDrafter();
    const draft = await drafter.draftOutreach(opportunity(), contact, context);
    expect(draft.message).not.toContain("No public contact channel was found");
  });
});
