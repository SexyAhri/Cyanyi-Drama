import { ChatClient } from "./chat-client";
import packageJson from "../../package.json";

export default function ChatPage() {
  return <ChatClient appVersion={packageJson.version} />;
}
