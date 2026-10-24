import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const base = env.VITE_BASE_PATH === '/' ? '/' : '/RheelTech/';
  return {
    plugins: [react()],
    base: command === 'build' ? base : '/',
  };
});
