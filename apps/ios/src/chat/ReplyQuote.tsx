import { Text, View } from "react-native";
import { shownName } from "@turtle/protocol";
import { Avatar, IconButton } from "../ui/layout";
import { colors, fonts, styles as text } from "../ui/theme";
import { replyText, type ReplyTarget } from "./reply";

export default function ReplyQuote({ reply, names, fileUrl, onCancel }: {
  reply: ReplyTarget; names: Map<string, string>; fileUrl: (key?: string | null) => string | undefined; onCancel?: () => void;
}) {
  const preview = reply.preview;
  const name = preview ? shownName(preview) : undefined;
  const content = preview ? replyText(preview, names) : "Mensagem apagada";
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderLeftWidth: 2, borderColor: colors.faint, paddingLeft: 8, paddingVertical: 4, marginBottom: 4 }}>
    {preview && <Avatar name={name!} uri={fileUrl(preview.avatar)} size={24} />}
    <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={name ? `Em resposta a ${name}. ${content}` : content}>
      {name && <Text numberOfLines={1} style={text.caption}>{onCancel ? "Respondendo a " : "Em resposta a "}<Text style={{ fontFamily: fonts.semibold }}>{name}</Text></Text>}
      <Text numberOfLines={2} style={[text.caption, !preview && { fontStyle: "italic" }]}>{content}</Text>
    </View>
    {onCancel && <IconButton name="close" label="Cancelar resposta" onPress={onCancel} />}
  </View>;
}
