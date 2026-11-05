// Routes a message to the Q&A agent or to the jury. A question goes to the agent; a request to judge, review or critique the
// design goes to the jury. Words first (no model call), the model only when the words are not clear.
import { z } from "zod";
import { chatModel } from "./llm";

export type Route = "ask" | "jury";

const JURY = /\b(judge|review|critique|crit|jury|verdict|approve|would .* (win|pass)|bewert|beurteil|kritik|jury|urteil|gewinn)/i;
const QUESTION = /^(what|how|why|when|who|which|where|is|are|does|do|can|was|wie|warum|wann|wer|welche|wo|ist|sind|gibt)\b|\?\s*$/i;

export function routeByWords(message: string): Route | null {
  const jury = JURY.test(message), question = QUESTION.test(message.trim());
  if (jury && !question) return "jury";
  if (question && !jury) return "ask";
  return null;
}

export async function route(env: Parameters<typeof chatModel>[0], message: string): Promise<Route> {
  const byWords = routeByWords(message);
  if (byWords) return byWords;
  const out = await chatModel(env, { maxTokens: 50 })
    .withStructuredOutput(z.object({ route: z.enum(["ask", "jury"]) }), { name: "route" })
    .invoke([{ role: "system", content: "Reply 'jury' if the user wants their own design judged or reviewed, otherwise 'ask'." },
      { role: "user", content: message }], { runName: "router", tags: ["router"] });
  return out.route;
}
