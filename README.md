# Chronoglobe

A 3D globe (CesiumJS) with a timeline. Historical events with an English
Wikipedia article appear at the places they happened. Events come live from
Wikidata SPARQL. Summaries and photos come from the Wikipedia REST API.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

Optional: copy `.env.example` to `.env` and set `VITE_CESIUM_ION_TOKEN` (free at
ion.cesium.com) to get Cesium World Imagery + 3D terrain. Without a token, Esri
World Imagery is used.

## How it works
- `src/lib/wikidata.ts`: SPARQL over a fixed list of event classes (battles, wars,
  treaties, disasters…), with a date + coordinates + enwiki article.
- `src/hooks/useEvents.ts`: splits the timeline range into aligned buckets, which are
  cached, fetched 3 at a time, retried once, and prefetched ahead while playing.
- `src/components/Globe.tsx`: clustered markers. The most notable events (and each
  cluster) render as photo bubbles made from the article's lead image.
- `src/components/EventPanel.tsx`: hero image, summary, article photo gallery + lightbox.
- `src/styles.css`: Liquid Glass styling (backdrop blur/saturate, specular edges, bubbles).
