import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        allowedHosts: ["oren-nonconstraining-semicircularly.ngrok-free.dev"],
        proxy: {
            "/api": {
                target: "http://localhost:5000",
                changeOrigin: true
            },
            "/uploads": {
                target: "http://localhost:5000",
                changeOrigin: true
            }
        }
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ["react", "react-dom", "react/jsx-runtime"],
                    router: ["react-router-dom"],
                    bootstrap: ["react-bootstrap"],
                    vendor: ["axios"]
                }
            }
        }
    }
});
