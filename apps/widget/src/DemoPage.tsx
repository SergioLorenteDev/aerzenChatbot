import { ChatWidget } from "./components/ChatWidget";
import backgroundUrl from "./assets/aerzen-site-demo-bg.png";
import "./styles/demo-page.css";

export function DemoPage() {
  return (
    <main className="demo-page" style={{ backgroundImage: `url(${backgroundUrl})` }}>
      <div className="demo-page__overlay" />
      <div className="demo-page__widget-slot">
        <ChatWidget title="Chatbot Aerzen" embedded responseDelayMs={900} />
      </div>
    </main>
  );
}
