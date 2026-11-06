import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    // 開発サーバーがプロジェクト直下のファイルを配らないようにする。前の4つは Vite の既定
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", ".dev.vars", ".dev.vars.*", ".demo-users.local"] },
  },
});
