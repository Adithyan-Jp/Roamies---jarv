// Handoffs to an agent carry what the user actually said, word for word. A brief someone else wrote
// from it can drift ("make the logo bigger" → "enlarge branding"); the quoted words can't. These build the pieces.
const CAP = 1500;

/** The words in curly quotes, verbatim. Only the ends are trimmed; if there are more than `max` characters, the rest
 *  is left out and the quote says how many, so nobody takes a cut-off for the whole. '' for nothing. */
export function exactWords(text, max = CAP) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  if (t.length <= max) return `“${t}”`;
  return `“${t.slice(0, max)}… [${t.length - max} more characters not shown]”`;
}

/** The block that opens a background agent's brief: their words, then the rule for the assistant's reading of them. */
export function userWordsBlock(userName, words) {
  const q = exactWords(words);
  return q ? `${userName}'s exact words, quoted verbatim. The brief below is their assistant's reading of them; if the two ever differ, their words win:\n${q}` : '';
}

/** `message` with their exact words after it, unless the message already holds them. */
export function withWords(message, userName, words) {
  const m = String(message ?? ''), w = String(words ?? '').trim();
  if (!w || m.includes(w)) return m;
  return `${m}\n\n${userName}'s exact words: ${exactWords(w)}`;
}

/** One line for a report or status: what was asked, kept short but still verbatim as far as it goes. */
export const askedLine = (userName, words, max = 300) => {
  const q = exactWords(words, max);
  return q ? `${userName} asked, in their words: ${q}` : '';
};
