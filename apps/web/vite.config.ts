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
      "Permissions-Policy": "unload=*",
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", ws: true },
      "/desktops": {
        target: "http://127.0.0.1:8787",
        ws: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["permissions-policy"] = "unload=*";
          });
        },
      },
    },
  },
});
