import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "@/server/env";
import { providerMode } from "@/server/providers/mode";
import { logApiUsage } from "@/server/usage";
import { OPENAI_PRICE_PER_MTOK, WEB_SEARCH_CALL_MICROS } from "@/config/costs";

export type AiTask = "research" | "scoring" | "email" | "replies" | "contacts";

export class AiUnavailableError extends Error {
  constructor(public reason: "quota" | "invalid_key" | "disabled" | "invalid_output" | "error", message?: string) {
    super(message ?? `AI unavailable: ${reason}`);
    this.name = "AiUnavailableError";
  }
}

let client: OpenAI | null = null;
function openai() {
  if (!client) client = new OpenAI({ apiKey: env().OPENAI_API_KEY, maxRetries: 2, timeout: 90_000 });
  return client;
}

export function modelFor(task: AiTask) {
  const e = env();
  return { research: e.OPENAI_MODEL_RESEARCH, scoring: e.OPENAI_MODEL_SCORING, email: e.OPENAI_MODEL_EMAIL, replies: e.OPENAI_MODEL_REPLIES, contacts: e.OPENAI_MODEL_RESEARCH }[task];
}

export function estimateCostMicros(model: string, input: number, output: number) {
  const [pin, pout] = OPENAI_PRICE_PER_MTOK[model] ?? OPENAI_PRICE_PER_MTOK.default;
  return Math.round((input * pin + output * pout) / 1_000_000);
}

export type StructuredResult<T> = { data: T; model: string; isMock: boolean; inputTokens: number; outputTokens: number };

/**
 * Run a structured-output call. Inputs are never stored by OpenAI
 * (store: false). Output is validated against the Zod schema; invalid output
 * raises AiUnavailableError("invalid_output").
 */
export async function structured<S extends z.ZodType>(params: {
  task: AiTask;
  orgId: string | null;
  system: string;
  user: string;
  schema: S;
  schemaName: string;
  mock: () => z.infer<S>;
  maxOutputTokens?: number;
  /** Let the model use OpenAI's hosted web search (results biased to the Netherlands). */
  webSearch?: boolean;
  /** Reasoning effort for reasoning models; "low" keeps hidden reasoning from eating the output budget. */
  reasoningEffort?: "low" | "medium" | "high";
}): Promise<StructuredResult<z.infer<S>>> {
  const mode = providerMode("openai");
  if (mode === "disabled") throw new AiUnavailableError("disabled");
  if (mode === "mock") {
    const data = params.schema.parse(params.mock());
    void logApiUsage({ orgId: params.orgId, provider: "openai", operation: params.task, status: "mock" });
    return { data, model: "mock", isMock: true, inputTokens: 0, outputTokens: 0 };
  }

  const model = modelFor(params.task);
  const started = Date.now();
  try {
    const call = async (maxTokens: number) => {
      const r = await openai().responses.parse({
        model,
        store: false,
        input: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        text: { format: zodTextFormat(params.schema, params.schemaName) },
        max_output_tokens: maxTokens,
        ...(/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: params.reasoningEffort ?? "low" } } : {}),
        ...(params.webSearch ? { tools: [{ type: "web_search" as const, user_location: { type: "approximate" as const, country: "NL" } }] } : {}),
      });
      const searches = params.webSearch ? r.output.filter((o) => o.type === "web_search_call").length : 0;
      const inTok = r.usage?.input_tokens ?? 0;
      const outTok = r.usage?.output_tokens ?? 0;
      void logApiUsage({
        orgId: params.orgId, provider: "openai", operation: params.task, inputTokens: inTok, outputTokens: outTok,
        costMicros: estimateCostMicros(model, inTok, outTok) + searches * WEB_SEARCH_CALL_MICROS, latencyMs: Date.now() - started,
      });
      return { r, inTok, outTok };
    };
    const budget = params.maxOutputTokens ?? 4000;
    let { r: res, inTok: input, outTok: output } = await call(budget);
    // Reasoning tokens count towards the budget; when the answer was cut off, retry once with more room.
    if (!res.output_parsed && res.incomplete_details?.reason === "max_output_tokens") {
      ({ r: res, inTok: input, outTok: output } = await call(budget * 2));
    }
    if (!res.output_parsed) throw new AiUnavailableError("invalid_output", "model returned no parseable output");
    return { data: params.schema.parse(res.output_parsed), model: res.model ?? model, isMock: false, inputTokens: input, outputTokens: output };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    const e = err as { status?: number; code?: string; type?: string; message?: string };
    void logApiUsage({ orgId: params.orgId, provider: "openai", operation: params.task, status: "error", latencyMs: Date.now() - started, error: e.message });
    if (e.code === "insufficient_quota" || e.type === "insufficient_quota") throw new AiUnavailableError("quota", "OpenAI account has no remaining quota");
    if (e.status === 401 || e.code === "invalid_api_key") throw new AiUnavailableError("invalid_key", "OpenAI API key is invalid");
    throw new AiUnavailableError("error", e.message);
  }
}
