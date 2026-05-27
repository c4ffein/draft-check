import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 8080,
    strictPort: true,
    allowedHosts: true,
    hmr: { host: 'c3.p1.c4ffein.io', protocol: 'wss', clientPort: 443 },
  },
  preview: {
    host: true,
    port: 8080,
    strictPort: true,
    allowedHosts: true,
  },
})
