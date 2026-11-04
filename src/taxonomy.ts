// Keystone's knowledge-base categories, questions, building types and countries (copied from keystone's
// src/Keystone/Knowledge/data/categories.json), so a fact the bot writes lands on a question Keystone asks.
import data from "./taxonomy.json";

export const categories: { id: string; en: string; questions: { id: string; en: string }[] }[] = data.categories;
export const typologies: string[] = data.typologies;
export const countries: string[] = data.countries;

/** How much one source of a kind counts, like `kinds` in Keystone's sources.json */
export const kindWeight: Record<string, number> = { video: 0.25, book: 0.3 };

export function isQuestion(category: string, q: string): boolean {
  return categories.some(c => c.id === category && c.questions.some(x => x.id === q));
}

/** The list the model sees in the propose_fact tool, one line per category */
export function questionList(): string {
  return categories.map(c => `${c.id}: ${c.questions.map(q => `${q.id} (${q.en})`).join("; ")}`).join("\n");
}
