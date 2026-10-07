import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173
  },
  // React consulta process.env.NODE_ENV y en modo librería Vite no lo sustituye:
  // el bundle fallaba con "process is not defined" al cargarlo con <script src>
  // fuera de un empaquetador, dejando window.AerzenChatbot sin mount.
  define: command === "build" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
  build: {
    lib: {
      entry: resolve(__dirname, "src/embed.tsx"),
      name: "AerzenChatbot",
      // Extensión .js explícita: el paquete es ESM, así que Vite emitiría el UMD
      // como .cjs y hay servidores que lo entregan con un Content-Type que el
      // navegador rechaza al cargarlo con <script src>.
      fileName: (format) => `aerzen-chatbot-widget.${format}.js`,
      cssFileName: "aerzen-chatbot-widget"
    }
  }
}));
