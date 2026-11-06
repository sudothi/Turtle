/** Accept pasted codes and links from the configured Turtle origin only. */
export function inviteCode(value: string, origin: string) {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{1,200}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) throw new Error();
    const match = /^\/convite\/([a-zA-Z0-9_-]{1,200})\/?$/.exec(url.pathname);
    if (match) return match[1]!;
  } catch { /* Show one actionable error for all invalid links. */ }
  throw new Error("Cole o código ou um link de convite deste servidor Turtle.");
}
