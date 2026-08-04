/**
 * Language model access.
 *
 * Design constraint from the brief: the console must work with no API key and
 * no paid service. So the default answer path is extractive and deterministic,
 * implemented in lib/rag/answer, and it runs entirely in-process.
 *
 * A generative model is an optional upgrade, not a dependency. If the operator
 * puts one key in .env.local the chat answers become fluent prose instead of
 * assembled evidence; if they do not, every question still gets answered from
 * the same retrieved passages. Nothing else in the application changes.
 *
 * All the supported providers have a free tier that does not require a card,
 * and all speak the OpenAI chat-completions shape, so one client covers them.
 */

import { safeFetch } from "@/lib/core/fetcher";

export type ProviderId = "nvidia" | "huggingface" | "groq" | "openrouter" | "ollama";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  endpoint: string;
  model: string;
  apiKey: string | null;
  /** True when the provider needs no key, which is the local Ollama case. */
  keyless: boolean;
}

/**
 * Resolves the active provider from the environment.
 *
 * Order is by free-tier generosity as measured at build time, with the local
 * runtime first because it costs nothing and leaves no data with a third party.
 * Returns null when nothing is configured, which is the expected default.
 */
export function resolveProvider(): ProviderConfig | null {
  const env = process.env;

  if (env.OLLAMA_BASE_URL) {
    return {
      id: "ollama",
      label: "Ollama, local",
      endpoint: `${env.OLLAMA_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`,
      model: env.OLLAMA_MODEL ?? "llama3.1:8b",
      apiKey: null,
      keyless: true,
    };
  }

  if (env.NVIDIA_API_KEY) {
    return {
      id: "nvidia",
      label: "NVIDIA NIM",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      model: env.NVIDIA_MODEL ?? "meta/llama-3.3-70b-instruct",
      apiKey: env.NVIDIA_API_KEY,
      keyless: false,
    };
  }

  if (env.GROQ_API_KEY) {
    return {
      id: "groq",
      label: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      model: env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      apiKey: env.GROQ_API_KEY,
      keyless: false,
    };
  }

  if (env.HUGGINGFACE_API_KEY) {
    return {
      id: "huggingface",
      label: "Hugging Face Inference Providers",
      endpoint: "https://router.huggingface.co/v1/chat/completions",
      model: env.HUGGINGFACE_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct",
      apiKey: env.HUGGINGFACE_API_KEY,
      keyless: false,
    };
  }

  if (env.OPENROUTER_API_KEY) {
    return {
      id: "openrouter",
      label: "OpenRouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model: env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free",
      apiKey: env.OPENROUTER_API_KEY,
      keyless: false,
    };
  }

  return null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
}

export class LlmError extends Error {
  readonly provider: ProviderId;
  constructor(provider: ProviderId, message: string) {
    super(message);
    this.name = "LlmError";
    this.provider = provider;
  }
}

/**
 * Single non-streaming completion.
 *
 * Temperature is pinned low. This console answers questions about filed
 * financials, where a fluent invention is worse than a blunt refusal.
 */
export async function complete(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const provider = resolveProvider();
  if (!provider) {
    throw new LlmError(
      "nvidia",
      "No language model provider is configured. Set one key in .env.local.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  const res = await safeFetch(provider.endpoint, {
    method: "POST",
    allowLlmHosts: true,
    timeoutMs: 45_000,
    retries: 0,
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages,
      max_tokens: opts.maxTokens ?? 700,
      temperature: opts.temperature ?? 0.15,
      stream: false,
    }),
  });

  const json = (await res.json()) as CompletionResponse;

  if (json.error) {
    const msg =
      typeof json.error === "string" ? json.error : json.error.message;
    throw new LlmError(provider.id, msg ?? "Provider returned an error.");
  }

  const content = json.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new LlmError(provider.id, "Provider returned an empty completion.");
  }

  return content.trim();
}

export function providerStatus(): {
  configured: boolean;
  label: string;
  model: string | null;
  mode: "generative" | "extractive";
} {
  const provider = resolveProvider();
  if (!provider) {
    return {
      configured: false,
      label: "Built-in retrieval engine",
      model: null,
      mode: "extractive",
    };
  }
  return {
    configured: true,
    label: provider.label,
    model: provider.model,
    mode: "generative",
  };
}
