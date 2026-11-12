import { REPLY_PREVIEW_CHARS, splitMentions, type Message, type ReplyPreview } from "@turtle/protocol";

export interface ReplyTarget { id: string; preview: ReplyPreview | null }
export function replyPreview(message: Message): ReplyPreview {
  return { id: message.id, userId: message.userId, username: message.username, displayName: message.displayName, avatar: message.avatar, content: message.content.slice(0, REPLY_PREVIEW_CHARS), attachments: message.attachments.length };
}
export function replyText(preview: ReplyPreview, names: Map<string, string>): string {
  if (preview.content) return splitMentions(preview.content).map(part => "text" in part ? part.text : `@${names.get(part.userId) || "pessoa"}`).join("");
  return preview.attachments ? `${preview.attachments} ${preview.attachments === 1 ? "anexo" : "anexos"}` : "Mensagem sem texto";
}
