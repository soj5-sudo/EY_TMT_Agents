
export type ProviderName = "gemini" | "huggingface" | "none";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
const HF_MODEL = process.env.HF_MODEL ?? "meta-llama/Llama-3.1-8B-Instruct";
const TIMEOUT_MS = 12_000;
const MAX_CHARS = 6_000;

export function providerName(): ProviderName {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.HF_API_TOKEN) return "huggingface";
  return "none";
}

export function providerLabel(): string {
  const name = providerName();
  if (name === "gemini") return `Google ${GEMINI_MODEL}`;
  if (name === "huggingface") return `Hugging Face ${HF_MODEL}`;
  return "Deterministic writer, no model";
}

async function post(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function gemini(instruction: string, text: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const json = (await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    { contents: [{ parts: [{ text: `${instruction}\n\n${text}` }] }] },
    { "x-goog-api-key": key },
  )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

async function huggingface(instruction: string, text: string): Promise<string | null> {
  const token = process.env.HF_API_TOKEN;
  if (!token) return null;
  const json = (await post(
    "https://router.huggingface.co/v1/chat/completions",
    {
      model: HF_MODEL,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: text },
      ],
      max_tokens: 400,
    },
    { Authorization: `Bearer ${token}` },
  )) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() ?? null;
}

export async function rephrase(instruction: string, text: string): Promise<string> {
  const name = providerName();
  if (name === "none" || text.length > MAX_CHARS) return text;

  try {
    const out = name === "gemini" ? await gemini(instruction, text) : await huggingface(instruction, text);
    if (!out || out.length < 20) return text;
    return out;
  } catch {
    return text;
  }
}
