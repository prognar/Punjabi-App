import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// base './' so the build works from any path (GitHub Pages serves it under /Punjabi-App/).
export default defineConfig({ base: './', plugins: [react()], test: { include: ['src/**/*.test.ts'] } });
