import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Cesium ships prebuilt workers, assets and widget CSS that must be served as
// static files. They are copied to /cesiumStatic and CESIUM_BASE_URL points
// there (set in index.html).
export default defineConfig({
  build: { chunkSizeWarningLimit: 6000 }, // Cesium is ~4 MB on its own
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
