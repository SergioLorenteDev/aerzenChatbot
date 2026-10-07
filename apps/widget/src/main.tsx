import { createRoot } from "react-dom/client";
import { DemoPage } from "./DemoPage";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<DemoPage />);
}
