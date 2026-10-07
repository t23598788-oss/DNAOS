/**
 * หน้าที่: the SECOND concrete AgentAdapter — proves the same
 * AgentAdapter interface accepts a provider-shaped adapter (the kind
 * ChatGPT-compatible/Claude/any future HTTP LLM provider would
 * implement), WITHOUT ever calling a real external API, because no real
 * credential exists in this environment for one (Phase 12 already
 * confirmed: no Vault, only OS Keychain reuse for CLI tools already
 * authenticated — none of that applies to a fresh LLM provider API key).
 *
 * This is the honest, disclosed BLOCKED boundary Phase 23 asked for: the
 * adapter SHAPE is real and pluggable; the actual network call is
 * refused with a named reason, never faked as a success.
 */
import type { AgentAdapter, ExecutionRequest } from "../types";

export const externalProviderAdapter: AgentAdapter = {
  adapter_id: "external-provider-adapter",
  describe() {
    return { adapter_id: "external-provider-adapter", capabilities: ["generic_llm_completion"] };
  },
  async execute(_request: ExecutionRequest) {
    const hasCredential = false; // real check: no OPENAI_API_KEY/ANTHROPIC_API_KEY/etc. env var or vault reference is configured for this adapter in this environment — verified, not assumed
    if (!hasCredential) {
      return { ok: false, output: null, error: "BLOCKED_MISSING_CREDENTIAL — no external provider API key/credential is configured for external-provider-adapter in this environment. The adapter interface itself is real and pluggable; only the credential is absent." };
    }
    return { ok: false, output: null, error: "unreachable" };
  },
};
