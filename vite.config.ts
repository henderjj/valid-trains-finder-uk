import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/
  base: process.env.GITHUB_ACTIONS ? '/valid-trains-finder-uk/' : '/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Valid Trains Finder',
        short_name: 'Valid Trains',
        description: 'Find which trains your UK rail ticket is valid on.',
        theme_color: '#1f4e79',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
});
