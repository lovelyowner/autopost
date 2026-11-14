import type { LlmProvider } from "./types";

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`LLM did not return JSON: ${trimmed.slice(0, 200)}`);
  }
}

export class OllamaProvider implements LlmProvider {
  name = "ollama";
  constructor(
    private readonly baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434",
    private readonly model = process.env.OLLAMA_MODEL ?? "dolphin3",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateJson(system: string, prompt: string, temperature: number): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, system, prompt, format: "json", stream: false, options: { temperature } }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { response: string };
    return extractJson(body.response);
  }
}

/** OpenAI-compatible chat completions endpoint (OpenRouter, Venice AI). */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    public readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateJson(system: string, prompt: string, temperature: number): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`${this.name} ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return extractJson(body.choices[0]?.message.content ?? "");
  }
}

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const list: LlmProvider[] = [new OllamaProvider(env.OLLAMA_URL, env.OLLAMA_MODEL)];
  if (env.OPENROUTER_API_KEY) {
    list.push(new OpenAiCompatibleProvider("openrouter", "https://openrouter.ai/api/v1", env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct"));
  }
  if (env.VENICE_API_KEY) {
    list.push(new OpenAiCompatibleProvider("venice", "https://api.venice.ai/api/v1", env.VENICE_API_KEY, env.VENICE_MODEL ?? "venice-uncensored"));
  }
  return list;
}
