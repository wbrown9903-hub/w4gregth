# Magnolia Heights — Drive

A stylised driving game through a real neighbourhood: Magnolia Heights,
Westover Hills, San Antonio, Texas.

```bash
npm run dev                                  # from the repo root
# then open http://127.0.0.1:5173/neighborhood/
```

**W/↑** accelerate · **S/↓** brake · **A D / ← →** steer · **Space** handbrake ·
**C** camera · **R** reset to 9903 Magnolia River.

## The world is real

Geometry comes from OpenStreetMap: 1,607 building footprints and 478 drivable
road centrelines across 77 named streets, covering about 3.0 × 2.9 km. Street
names, road classes and building outlines are real and in their real relative
positions. The origin is 9903 Magnolia River.

Rebuild the world data from the OSM extract with:

```bash
node neighborhood/tools/build-data.mjs
```

Heights are **inferred**, not surveyed — OSM almost never carries height for
single-family housing, so they come from `building:levels` where present and
from footprint area otherwise.

## What is not used, and why

- **Google Maps / Street View** — the terms prohibit scraping imagery or
  building derivative geometry from it. Google's Photorealistic 3D Tiles API is
  the licensed route for that and needs an API key.
- **Zillow** — scraping is prohibited by their terms, and listing photos and
  floor plans are copyrighted by the photographer or MLS. "Publicly viewable"
  is not "public domain".
- **Interiors** are therefore generic, not reproductions of any real home's
  actual layout.

## Art direction

World of Warcraft, not photorealism — these are opposite targets and the code
commits to the first. WoW is a painting convention rather than a lighting
model: light baked into albedo, banded shading, coloured shadows, rim light on
every silhouette. See `src/style.js`; it is a hand-rolled ramp shader rather
than a physically-based material with the roughness turned up.

## Attribution

Map data © OpenStreetMap contributors, licensed under the
[ODbL](https://www.openstreetmap.org/copyright).
