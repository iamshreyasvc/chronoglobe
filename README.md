# Chronoglobe

![Chronoglobe showing the Battle of Stalingrad with its Wikipedia summary and photos](docs/screenshot.jpg)

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

## Features
- Satellite globe with clustered markers. The most notable events show as glass photo
  bubbles with their names on the map.
- Timeline from 3000 BCE to today: drag the window, type years (`480 BC`, `1944`), or press play.
- Global search (press `/`) for any dated, mappable event. Picking one moves the timeline
  and flies there.
- Event pop-up with the Wikipedia summary, a lead photo and an article photo gallery.
- Category filters, a Liquid Glass UI, and a phone layout with a bottom sheet.

## How it works
- `src/lib/wikidata.ts`: SPARQL over a fixed list of event classes (battles, wars,
  treaties, disasters…), with a date + coordinates + enwiki article.
- `src/hooks/useEvents.ts`: splits the timeline range into aligned buckets, which are
  cached, fetched 3 at a time, retried once, and prefetched ahead while playing.
- `src/components/Globe.tsx`: clustered markers. The most notable events (and each
  cluster) render as photo bubbles made from the article's lead image.
- `src/lib/search.ts`: global search. Wikipedia full-text search, then one Wikidata
  lookup for each hit's date and place. Picking a hit moves the timeline to include it.
- `src/components/EventPanel.tsx`: hero image, summary, article photo gallery + lightbox.
- `src/styles.css`: Liquid Glass styling (backdrop blur/saturate, specular edges, bubbles).
