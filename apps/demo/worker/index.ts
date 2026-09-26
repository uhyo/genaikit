/**
 * The demo's server: a Cloudflare Worker handling `/api/*` (everything else
 * is the static SPA). It plays the ingenui server between the LLM provider
 * and the client, using only the shared data-only schema and the React-free
 * `ingenui/server` entry:
 *
 * - `GET  /api/prompt`   — the system prompt, built from the schema;
 * - `POST /api/generate` — streams a message to the client through
 *   `pipeGenUi`, validating it on the way;
 * - `POST /api/next`     — builds the next user turn from *structured*
 *   client input (a fired action's name, render crashes), re-validating the
 *   previous message itself instead of trusting client-written text.
 *
 * The demo has no API key, so the "LLM provider" is simulated: it replays the
 * text the user typed, a few characters at a time. A real app would call the
 * provider with the prompt from `/api/prompt` and pipe its text stream the
 * same way.
 *
 * In `vite dev` the same handler is served by a middleware (see
 * `vite.config.ts`); `wrangler dev` / `wrangler deploy` run it as the Worker.
 */
import type { GenUiIssue } from "ingenui/server";
import {
  formatGenUiPrompt,
  formatIssueReport,
  pipeGenUi,
  resolveGenUiAction,
  validateGenUiMessage,
} from "ingenui/server";

import { demoSchema } from "../src/genui-schema";
import { createCharStream } from "../src/streaming";

/** Keep the public demo cheap: messages are short. */
const MAX_MESSAGE_LENGTH = 20_000;

const systemPrompt = `You are a shopping assistant. Answer in Markdown; use UI blocks where they help.

${formatGenUiPrompt(demoSchema)}`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function readMessage(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_MESSAGE_LENGTH ? value : null;
}

/** Stand-in for the LLM provider's text stream. */
function simulateModel(text: string, intervalMs: number, chunkSize: number) {
  return createCharStream(text, { intervalMs, chunkSize });
}

async function generate(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = readMessage(body?.["text"]);
  if (text === null) return json({ error: "text must be a string (up to 20k chars)" }, 400);

  const source = simulateModel(
    text,
    clamp(body?.["intervalMs"], 5, 500, 45),
    clamp(body?.["chunkSize"], 1, 64, 2),
  );
  const started = Date.now();
  const pipe = pipeGenUi(source, demoSchema, {
    // Found while streaming — before the client has the chunk that completes
    // the problem. The demo only logs it (visible in the dev-server / Worker
    // logs); acting on it (aborting, retrying) is a later step.
    onIssue: (issue) => console.log(`[ingenui] +${Date.now() - started}ms`, describe(issue)),
  });
  return new Response(pipe.stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function describe(issue: GenUiIssue): string {
  const block = `block ${issue.blockIndex + 1}`;
  return issue.kind === "jsx-error"
    ? `${block}: ${issue.event.message}`
    : `${block}: ${issue.kind}`;
}

/**
 * The next user turn, composed on the server: the canonical message for the
 * fired action (resolved against the schema) plus the feedback report —
 * parse-time issues from the server's own validation, and the render crashes
 * only the client can observe.
 */
async function next(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = readMessage(body?.["message"]);
  if (message === null) return json({ error: "message must be a string" }, 400);

  const parts: string[] = [];
  const action = body?.["action"];
  if (action !== undefined) {
    const resolved = typeof action === "string" ? resolveGenUiAction(demoSchema, action) : null;
    if (resolved === null) return json({ error: "unknown action" }, 400);
    parts.push(resolved.message);
  }

  const renderErrors = Array.isArray(body?.["renderErrors"]) ? body["renderErrors"] : [];
  const issues: GenUiIssue[] = [...validateGenUiMessage(message, demoSchema)];
  for (const entry of renderErrors.slice(0, 20) as unknown[]) {
    const { blockIndex, message: error } = (entry ?? {}) as Record<string, unknown>;
    if (typeof blockIndex === "number" && Number.isInteger(blockIndex) && blockIndex >= 0) {
      issues.push({ kind: "render-error", blockIndex, error: String(error).slice(0, 200) });
    }
  }
  const report = formatIssueReport(issues);
  if (report !== null) parts.push(report);

  return json({ text: parts.length > 0 ? parts.join("\n\n") : null });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/prompt" && request.method === "GET") {
      return new Response(systemPrompt, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (pathname === "/api/generate" && request.method === "POST") return generate(request);
    if (pathname === "/api/next" && request.method === "POST") return next(request);
    return json({ error: "not found" }, 404);
  },
};
