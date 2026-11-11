import { mentionToken, shownName, splitMentions, type Person } from "@turtle/protocol";

export interface Mention { start: number; end: number; userId: string; label: string }
export interface Draft { text: string; mentions: Mention[] }
export const emptyDraft = (): Draft => ({ text: "", mentions: [] });

export function decodeDraft(content: string, names: Map<string, string>): Draft {
  const draft = emptyDraft();
  for (const part of splitMentions(content)) {
    if ("text" in part) draft.text += part.text;
    else {
      const label = `@${names.get(part.userId) || "pessoa"}`;
      const start = draft.text.length;
      draft.text += label;
      draft.mentions.push({ start, end: draft.text.length, userId: part.userId, label });
    }
  }
  return draft;
}

/** Edits preserve only complete selected mentions outside the replaced range. */
export function editDraft(draft: Draft, text: string): Draft {
  if (text === draft.text) return draft;
  let start = 0, suffix = 0;
  while (start < Math.min(draft.text.length, text.length) && draft.text[start] === text[start]) start++;
  while (suffix < Math.min(draft.text.length, text.length) - start && draft.text[draft.text.length - suffix - 1] === text[text.length - suffix - 1]) suffix++;
  const end = draft.text.length - suffix, delta = text.length - draft.text.length;
  // Repeated identical labels can make a text-only diff ambiguous (e.g. deleting
  // one of two @Alex mentions). Drop ambiguous bindings rather than notify the wrong person.
  let safeStart = start, oldEnd = end, newEnd = text.length - suffix;
  while (safeStart > 0 && (oldEnd === safeStart || draft.text[safeStart - 1] === draft.text[oldEnd - 1]) && (newEnd === safeStart || text[safeStart - 1] === text[newEnd - 1])) { safeStart--; oldEnd--; newEnd--; }
  return { text, mentions: draft.mentions.flatMap(m => m.end <= safeStart ? [m] : m.start >= end ? [{ ...m, start: m.start + delta, end: m.end + delta }] : []) };
}
export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|[\s([{])@([^\s@]{0,64})$/u.exec(text.slice(0, caret));
  return match ? { start: caret - match[1]!.length - 1, end: caret, query: match[1]! } : undefined;
}
export function chooseMention(draft: Draft, range: { start: number; end: number }, person: Person) {
  const label = `@${shownName(person)}`;
  const next = editDraft(draft, draft.text.slice(0, range.start) + label + " " + draft.text.slice(range.end));
  next.mentions.push({ start: range.start, end: range.start + label.length, userId: person.id, label });
  return { draft: next, caret: range.start + label.length + 1 };
}
export function encodeDraft(draft: Draft) {
  let text = draft.text;
  for (const mention of [...draft.mentions].sort((a, b) => b.start - a.start)) {
    if (text.slice(mention.start, mention.end) === mention.label) text = text.slice(0, mention.start) + mentionToken(mention.userId) + text.slice(mention.end);
  }
  return text.trim();
}
