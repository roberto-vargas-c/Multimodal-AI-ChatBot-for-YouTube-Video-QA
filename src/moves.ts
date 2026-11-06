// Massing moves: what a juror would change in the form of the building, as a concrete instruction Keystone can preview and apply.
// Each move is tied to one of the juror's concepts and grounded in one of their passages, like a reading. The actions follow the
// massing operations Keystone has (push-pull on a side, stepping back the top floors, adding or taking away floors); anything else
// ("open the courtyard to the street", "shift the tower east") is a move of kind "other", shown as text with its side highlighted.
import { z } from "zod";

export const SIDES = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west", "all"] as const;
export const ACTIONS = ["add_floors", "remove_floors", "push", "pull", "step_back", "other"] as const;
export const FLOOR_RANGES = ["all", "ground", "upper", "top"] as const;

export const MoveSchema = z.object({
  title: z.string().describe("The move as an imperative, about this project, e.g. 'Lower the north wing by two floors', 'Open the courtyard to Hauptstraße'"),
  action: z.enum(ACTIONS).describe([
    "add_floors / remove_floors: the whole building taller or lower by 'floors' floors;",
    "push / pull: the face on 'side' moved in (push) or out (pull) by 'metres' on the floors in 'range';",
    "step_back: the top 'floors' floors set back from 'side' by 'metres' (a terrace, or a wing lowered on that side);",
    "other: anything else (open a court, shift or turn a volume, split a block, a new entrance), described in the title",
  ].join(" ")),
  side: z.enum(SIDES).optional().describe("The side of the building it acts on, north up; 'all' for every side. Required for push, pull, step_back"),
  floors: z.number().int().optional().describe("How many floors: for add_floors, remove_floors, step_back"),
  metres: z.number().optional().describe("How far: for push, pull, step_back"),
  range: z.enum(FLOOR_RANGES).optional().describe("Which floors a push or pull acts on; default all"),
  concept: z.string().describe("The juror's concept the move serves, as in their readings"),
  why: z.string().describe("Why, in the juror's voice, one or two sentences: what it does for the street, the site, the programme or the idea"),
  passage: z.string().describe("The id of the passage that grounds it, e.g. abc123:4"),
});
export type Move = z.infer<typeof MoveSchema>;
export type JurorMove = Move & { juror: string };

const clamp = (v: number | undefined, lo: number, hi: number) => v == null || !Number.isFinite(v) ? undefined : Math.max(lo, Math.min(hi, v));

/** Keeps the moves that are grounded and that Keystone can read: a push, pull or step back needs a side, a change of floors a number.
 *  A move that cannot be carried out as asked becomes 'other', so its idea still reaches the architect as text. At most `max`. */
export function cleanMoves(moves: Move[], known: (id: string) => boolean, max = 3): Move[] {
  return moves.filter(m => m.title?.trim() && known(m.passage)).map((m): Move => {
    const floors = clamp(m.floors == null ? undefined : Math.round(Math.abs(m.floors)), 1, 20);
    const metres = clamp(m.metres == null ? undefined : Math.abs(m.metres), 0.5, 40);
    const out: Move = { ...m, floors, metres };
    if ((m.action === "add_floors" || m.action === "remove_floors") && !floors) return { ...out, action: "other" };
    if ((m.action === "push" || m.action === "pull") && (!m.side || !metres)) return { ...out, action: "other" };
    if (m.action === "step_back" && (!m.side || m.side === "all" || !floors || !metres)) return { ...out, action: "other" };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Move;
  }).slice(0, max);
}

/** The jury's moves in one list: each juror's, in order, without two that ask for the same thing on the same side */
export function allMoves(jurors: { juror: string; moves?: Move[] }[]): JurorMove[] {
  const seen = new Set<string>(), out: JurorMove[] = [];
  for (const j of jurors) for (const m of j.moves ?? []) {
    const key = m.action === "other" ? `other|${m.title.toLowerCase()}` : `${m.action}|${m.side ?? ""}|${m.range ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ ...m, juror: j.juror });
  }
  return out;
}

// what the jurors are told about proposing moves
export const PROPOSE = "Then propose up to three massing moves: concrete changes to the form of the building that follow from your concerns" +
  " (or strengthen what you praise), each tied to one of your concepts and grounded in a passage. Read the MASSING section for the" +
  " building's sides, floors and dimensions, and refer to its sides by compass direction. Prefer the moves Keystone can make: add or" +
  " take away floors, push a face in or pull it out on one side, step back the top floors on one side; give the numbers (floors," +
  " metres) from the building's own size and its neighbours'. Use 'other' for anything else, described concretely. Propose no move" +
  " the brief does not give you reason for.";
