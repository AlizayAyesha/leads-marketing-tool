/**
 * Jarvis v1 invariant — also in the brain system prompt.
 * The LLM may reason, pick existing capabilities, explain, and keep context.
 * It may not invent evidence, bypass policy, send externally, or rewrite business rules.
 * interpretCommand() is an internal execution adapter, not the conversational interface.
 */
export const JARVIS_LLM_INVARIANT =
  "The LLM may reason, pick existing capabilities, explain, and keep context. It may not invent evidence, bypass policy, send externally, or rewrite business rules.";

export const JARVIS_INTERPRET_IS_ADAPTER =
  "interpretCommand() is an internal execution adapter, not Jarvis's conversational interface.";
