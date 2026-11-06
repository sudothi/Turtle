import { type ComponentProps } from "react";
import { usePersonDetail } from "../workspace-context";
import { ListRow } from "./layout";

export function PersonRow({ userId, detail, ...props }: ComponentProps<typeof ListRow> & { userId: string }) {
  const activity = usePersonDetail(userId);
  return <ListRow {...props} detail={detail || activity} />;
}
