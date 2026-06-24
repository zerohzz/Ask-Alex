import { Type, type FunctionDeclaration } from "@google/genai";

/**
 * The single agentic tool. The model decides to call this when it cannot
 * answer confidently from the retrieved KB context — the Conversational-AI
 * escalate-to-human / HITL pattern. It performs no real side effect; the
 * structured call is surfaced to the UI as an escalation card.
 */
export const escalateToHuman: FunctionDeclaration = {
  name: "escalate_to_human",
  description:
    "Hand off to the real Alex when the knowledge base does not cover the question, or when the user explicitly asks to reach Alex directly. Do NOT call this if the answer is covered by the provided context.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description:
          "Short reason for handoff, e.g. 'not covered by KB' or 'user wants to reach Alex'.",
      },
      summary: {
        type: Type.STRING,
        description:
          "One- to two-sentence summary of the question, for Alex picking it up.",
      },
      priority: {
        type: Type.STRING,
        description: "Triage priority.",
        enum: ["low", "normal", "high"],
      },
    },
    required: ["reason", "summary"],
  },
};

export const tools = [{ functionDeclarations: [escalateToHuman] }];
