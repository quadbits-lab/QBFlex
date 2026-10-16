import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwind()], resolve: { dedupe: ['react','react-dom','sonner'] }, server: { proxy: { '/hrms-api': 'http://127.0.0.1:7620' } } });
