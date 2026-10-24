import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Cesium ships prebuilt workers, assets and widget CSS that must be served as
// static files. They are copied to /cesiumStatic and CESIUM_BASE_URL points
// there (set in index.html).
export default defineConfig({
  build: { chunkSizeWarningLimit: 6000 }, // Cesium is ~4 MB on its own
  // Shown in the About drawer.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/cesium/Build/Cesium/{Assets,ThirdParty,Widgets,Workers}/**/*',
          dest: 'cesiumStatic',
          rename: { stripBase: 4 },
        },
      ],
    }),
  ],
})
