// Subagents: a small crew of specialists the user picks models for. The chat model (the main agent) hands each one a
// prompt through send_agent's `subagent` argument; the specialist runs as an ordinary background agent (agents.mjs) on
// the model chosen for it, with its role in front of the brief. Pure pieces here; the launch is in agents.mjs and the
// settings in sidekick.mjs. A specialist with no model picked is not part of the crew.
import { parseSpec } from './route.mjs';

export const SUBAGENTS = [
  { id: 'scout', label: 'Scout', type: 'researcher', hint: 'Finds things out on the web and writes notes.',
    role: 'You are the Scout: you find things out. Search widely, open the sources, cross-check, and report what is true with where it came from. Say plainly what you could not confirm.' },
  { id: 'builder', label: 'Builder', type: 'maker', hint: 'Writes code, pages and scripts, and runs them.',
    role: 'You are the Builder: you make working things. Write the code or page, run it, fix what breaks, and hand back something that works rather than a plan.' },
  { id: 'writer', label: 'Writer', type: 'maker', hint: 'Documents, slides, emails and copy.',
    role: 'You are the Writer: you produce finished text. Match the tone and length asked for, keep every name, number and quote as given, and hand back the finished piece.' },
  { id: 'reviewer', label: 'Reviewer', type: 'researcher', hint: 'Checks work for mistakes and gaps.',
    role: 'You are the Reviewer: you check work. Read it carefully, run what can be run, and report real problems first, with where they are and how to fix them. Do not rewrite what is fine.' },
  { id: 'tidier', label: 'Tidier', type: 'organizer', hint: 'Sorts, renames and moves files.',
    role: 'You are the Tidier: you put files in order. Propose one clear structure, move and rename with care, never delete, and say what went where.' },
];
export const SUBAGENT_IDS = SUBAGENTS.map((s) => s.id);
export const MAX_AT_ONCE = 3;

// The kind of hybrid job each specialist's work is (route.mjs JOB_KINDS): with hybrid models on and no model of its own
// picked, a specialist uses the model set for that kind, so the two settings agree instead of competing.
export const JOB_OF = { scout: 'web', builder: 'code', reviewer: 'code', tidier: 'code' };

/** The crew: specialists with a model of their own (crew = { id: 'provider:model' }), or else the one hybrid models set
 *  for their kind of job (heavy = { kind: 'provider:model' }, passed only while hybrid is on), that can run now.
 *  Each has spec (parsed), slot (the effort slot it thinks with) and via ('own' | 'hybrid'). */
export function activeCrew(crew, canRun = () => true, heavy = null) {
  const out = [];
  for (const s of SUBAGENTS) {
    const own = parseSpec(crew?.[s.id]), kind = JOB_OF[s.id], mine = own && canRun(own.provider, own.model);
    const h = !mine && heavy && kind ? parseSpec(heavy[kind]) : null;
    if (mine) out.push({ ...s, spec: own, slot: `sub_${s.id}`, via: 'own' });
    else if (h && canRun(h.provider, h.model)) out.push({ ...s, spec: h, slot: kind, via: 'hybrid' });
  }
  return out;
}

/** A specialist by what the chat called it ("scout", "the Builder", "builder agent"), among the crew. */
export function findSubagent(name, crew) {
  const n = String(name ?? '').toLowerCase();
  if (!n.trim()) return null;
  return crew.find((s) => n === s.id || new RegExp(`\\b${s.id}\\b`).test(n) || n.includes(s.label.toLowerCase())) ?? null;
}

/** The brief a specialist gets: its role first, then the brief the chat wrote (which opens with the user's own words). */
export const withRole = (sub, brief) => `${sub.role}\n\n${brief}`;

/** The line that tells the chat who is on the crew, or '' when nobody is. */
export function crewText(crew, nameOf = (spec) => spec) {
  if (!crew.length) return '';
  return `Subagents (specialists you can hand work to: send_agent with subagent set to one of these; each runs on its own model, in the background, and you may start up to ${MAX_AT_ONCE} at once for separate parts of one request):\n${crew.map((s) => `- ${s.id}: ${s.hint} (${nameOf(s.spec)})`).join('\n')}`;
}
