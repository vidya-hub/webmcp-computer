import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: {
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": "unload=*, tools=(self)",
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", ws: true },
      "/desktops": {
        target: "http://127.0.0.1:8787",
        ws: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["origin-agent-cluster"] = "?1";
            proxyRes.headers["permissions-policy"] = "unload=*, tools=(self)";
          });
        },
      },
    },
  },
});
