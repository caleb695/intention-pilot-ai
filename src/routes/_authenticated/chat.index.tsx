import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "./chat.$id";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatPage,
});
