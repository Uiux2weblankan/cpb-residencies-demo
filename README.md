# Central Park Boulevard: Residences Viewer (demo)

The Check Availability page for Central Park Boulevard: an interactive residences viewer. A buyer starts on the overview of both towers (K0), flies into either tower with 1-second drone transitions, and steps around three night views per tower. They filter by price, area and rooms, hover a floor to see what is available on it, and hover or tap any visible apartment to see its floor, number, type, area and status.

It is built in plain HTML, CSS and JavaScript (ES modules), with no frameworks, libraries or build step for the front end.

## Run it locally

The viewer loads its data with `fetch()`, so it must be served over http. Opening `index.html` as a file shows a message explaining this.

```bash
cd cpb-residencies-demo
node scripts/serve.mjs          # → http://localhost:8080   (Node 18+, no npm install)
# or
python3 -m http.server 8080     # any static server works
```

Then open **http://localhost:8080**.

The generated assets in `public/` are already included, so nothing needs building to run the demo.

## What you can do

The viewer is the **Check Availability** page, built to the Figma frames *2.1 Residencies Check Availability Page* (overview) and *2.1.1 Tower Check Availability Page* (tower views).

| Where | Interaction |
| --- | --- |
| **2.1 · Overview (K0)** | "Home · Residences · Check Availability" and **Find Your Residence**. Hover a tower: the rest of the picture is veiled in green and blurred, the picture eases in, the other tower's pill dims, the Hover Tower Card rises in (available count, 1BR · 2BR · 3BR · Sky Villas, Explore Tower), and "Select Your Tower" slides away. Click the tower, its pill or Explore Tower to fly in (shot 01 or 02). On mobile, the first tap shows the card as a sheet. |
| **2.1.1 · Tower view** | Left panel: **Back** (to the overview), the other tower, **Tower A \| Availability**, and the filter box. One rule for every angle: Tower A's panel is on the left, Tower B's on the right (mirrored), with a gray-950 scrim behind it for legibility. Each angle is framed so its tower stays clear of the panel: it pans within the crop, and eases in a few percent only if needed (e.g. B2), and the drone clips blend between framings. The tower switch is a white pill like the overview's tower pills. Every visible apartment is coloured by status at 45%: Available `#033825`, Reserved `#E8CE06`, Sold `#F7431A`. |
| Hover / tap an apartment | Highlights its floor and opens the Hover Floor Card: floor, status, apartment number, type, area, floor plan, **More Info** (→ residence page) and **Contact Us**. On desktop, hovering previews the card and clicking pins it. On mobile, the card opens as a bottom sheet. |
| Filters | **Price** and **Area, m²** range sliders, and **Rooms** (Studio, 1–4). Non-matching apartments are dimmed, and floors with no match are dimmed entirely. The box shows the match count and the status legend. On mobile the filters open as a bottom sheet. |
| Move around the tower | ‹ › in the bottom bar, the view dots, ← → keys or swipe. A backward move plays the clip in reverse. Switching tower routes through K0. |
| Sold-out floors | Darkened (demo data: A-07 and B-33). |
| During a clip | The overlay is hidden and input is queued. Only the last click is kept. |
| Keyboard | Tab to the overlay. ↑ ↓ move between floors, ← → between apartments, Enter pins the card, Esc closes it and returns focus. |
| Sales feed simulator | `feed.html`, also in the menu. Changing a status updates an open Check Availability tab live, and the change survives a reload. |
| Deep links | `index.html?view=A2`. `?unit=A-25-U07` opens that apartment's card. |

`prefers-reduced-motion` replaces the drone clips with a crossfade.

## Project structure

```
cpb-residencies-demo/
  index.html              Check Availability (2.1 overview + 2.1.1 tower views), full screen
  residence.html          2.2.1 Residence Inner (demo): one residence, from ?unit=
  contact.html            13.0 Contact (demo): enquiry form, prefilled from ?unit= or ?tower=&floor=
  feed.html               sales feed simulator (demo tool)
  package.json            convenience scripts only, no dependencies

  source-assets/          delivered assets, untouched (Base Images, Frames Container, SVGs)
  scripts/                asset pipeline (Node + macOS sips, no npm packages)
    normalise-frames.mjs  rename + zero-pad, 2560→1920, AVIF + JPEG, stills, K0 still
    clean-svgs.mjs        decode Figma ids → data attributes, strip inline styles
    build-units.mjs       units.json seeded from / verified against the overlays
    build-manifest.mjs    views, shots, frame counts, sizes, K0 tower hit areas
    build-all.mjs         runs the four in order
    serve.mjs             tiny static server for local testing
  public/                 everything the viewer loads (generated)
    stills/               k0, a1 … b3 (.avif + .jpg)
    shots/shot-01 … 08/desktop/0001 … 0031 (.avif + .jpg, 1920×1080)
    overlays/             a1.svg … b3.svg
    data/units.json       626 units: type, area, status, price_usd, plan_url, page_url, views
    manifest.json
    img/                  logo, icons, sample floor plan (from Figma)
  src/
    css/                  tokens · base · header · viewer · availability · cards · page
    js/
      main.js             boots the page and wires components together
      config.js           tunables (fps, blend frames, decode sizes, cache sizes…)
      core/               emitter, DOM and format helpers
      data/               manifest.js, unit-store.js (feed, filters, demo overrides)
      viewer/             viewer.js (state machine), route-planner.js, frame-player.js,
                          asset-loader.js, overlay-layer.js, tower-layer.js, fit.js
      ui/                 tower-panel (title + filters), floor-card (apartment card),
                          tower-card, view-controls (action bar), demo-feed, site-menu
      pages/              residence.js, contact.js, feed.js
```

### How the viewer works

- **State machine** (`viewer/viewer.js`): holds the current view and maps each move to shots via `route-planner.js`, a shortest-path search where every shot is an edge in both directions. It locks input during a clip and keeps only the last request.
- **Frame player** (`viewer/frame-player.js`): draws frames on a `<canvas>` at 30 fps, forward or reverse. The first and last three frames are blended with the start and end stills, so the hand-off to the overlay is pixel-exact. If frames arrive late it holds the current frame, and past 1.2 s it falls back to a crossfade.
- **Asset loader** (`viewer/asset-loader.js`): checks AVIF support, then fetches with a priority queue. Compressed frames are prefetched as blobs. Only shots about to play are decoded (`createImageBitmap`, 1280 px wide on desktop and 1080 on mobile). An LRU of 3 decoded shots (2 on mobile) bounds memory, and evicted bitmaps are closed.
- **Loading order**, as in the plan:
  1. The K0 still and units.json.
  2. Shots 01 and 02.
  3. On arriving at a tower: that loop's shots, the path back to K0 and the other tower's push-in.
  4. Each overlay with its view.

  Hovering a tower starts decoding its push-in early.
- **Overlay** (`viewer/overlay-layer.js`): the view's SVG is inlined above the canvas. It uses the same cover-fit maths as the canvas (`fit.js`), so polygons stay locked to the picture at any size. Status comes only from the unit feed, through CSS classes. A polygon with no data record is hidden and logged in the console.

## Asset pipeline

The delivered folders in `source-assets/` are never modified. Re-run the scripts after a still, shot or overlay is regenerated:

```bash
node scripts/build-all.mjs           # incremental: unchanged frames are skipped
node scripts/build-all.mjs --force   # re-encode everything
node scripts/normalise-frames.mjs --only=shot-03     # one shot
node scripts/normalise-frames.mjs --k0=path/to/FRONT.png   # use a final K0 image
node scripts/build-units.mjs --regenerate            # reseed units.json (keeps statuses)
```

Requirements: macOS (the scripts use `sips`) and Node 18+.

The pipeline enforces these gates:

- frame numbers must run 1…N with no gaps;
- stills must be 1920×1080;
- every overlay id must follow `X-FF-Uxx` on a real floor (6–12, 14–35; there is no 13);
- each unit appears once per view;
- type and area must agree across views and with units.json (any mismatch fails the build);
- every view must have a shot.

Current result: 6 overlays with 970 polygons and 626 units (313 per tower). Every unit is visible in at least one view, with 0 mismatches.

## Assumptions and decisions (where the plan is open or unclear)

| Topic | What the demo does |
| --- | --- |
| K0 still | Frame 1 of shot 01, which the plan lists as an option. A final FRONT image can be swapped in with `--k0=`. |
| K0 overview | Built to Figma *_Residences Animation › Residencies Check Image Container* (states Default, Left and Right). The Figma base image is a different render with rooftop gardens, so the rounded tower windows, the pill positions and the card positions are re-traced on the K0 still in `build-manifest.mjs`, in Figma's style and with its 1920×1080 coordinates. The still itself is kept so clip 01/02 starts seamlessly. Figma has no timing data, so the motion is set at 450 ms ease-out, with a 700 ms zoom. |
| Tower card types | The Figma row is 1BR · 2BR · 3BR · Sky Villas. 4BR units are shown as "Sky Villas", matching "Sky Villas (4BR)" on the Residences page. The 8 studios are left off the card but stay in the filters and the type list. |
| Image formats | AVIF with a **JPEG** fallback instead of WebP: macOS `sips` cannot write WebP. AVIF averages about 60 KB per frame and 300 KB per still. |
| Mobile crops | Done at runtime: cover-fit centred on each view's tower, using the overlay bounds from the manifest. No separate portrait frame sets. |
| Endpoint hand-off | Blended at runtime over 3 frames, rather than baked into the frames. |
| Unit data | No plan spreadsheet is in the folder, so units.json is **seeded from the overlay metadata** (type and area come from the plans via Figma) and then verified against it on every build. **Statuses are deterministic demo values.** |
| Floor plans | Every unit uses the Figma "Floor Plan #01" sample, which Figma marks as illustrative. It is labelled "Illustrative plan". |
| Tower switch from A2/A3 | Goes through K0, the plan's current behaviour; the open decision is noted in the plan. The plan's example "A3 → B1 = shot 05 reversed + …" looks like a slip: shot 05 is A3→A1, so the planner plays it **forward**. |
| MP4 fallback | None was delivered, so the fallback is the crossfade. |
| Final UX | The Figma frames 2.1 / 2.1.1 take precedence over the plan where they differ. So: a full-screen page instead of a hero on 2.2 Residences Landing; the page layout, title, panel and filters follow 2.1.1, while the tower overlay keeps the apartment-level interaction (status colours, floor highlight, apartment card) from Figma *Tower A [Apartment] Check Image Container*. The site header (Figma Navigation) shows only on the 2.1 overview: it slides away when the viewer flies into a tower and returns on the way back. The residence, contact and feed pages have no header. |
| Navigation on 2.1.1 | The frame only shows Back. The bottom bar (‹ view ›), Figma's Action Container style, and a "Tower B →" pill are added, because the plan needs loop navigation and tower switching. |
| Price | The 2.1.1 filters need a price, so `build-units` adds a **demo** `price_usd` per unit (rate per ft² rising with the floor, with a Sky Villa premium). Slider bounds come from the data, not from Figma's placeholder $30,000–$300,000. |
| Area | The Figma filter is in m²; the data is in ft², so it is converted (÷ 10.7639). |
| Rooms | Figma shows 1 · 2 · 3. The data also has Studios (8) and 4BR Sky Villas, so the options are Studio · 1 · 2 · 3 · 4. |
| Fonts | Instrument Sans (Google Fonts). Figma's display face **Daeling** is not available here, so **Italiana** stands in. Swap it in `src/css/tokens.css`. |
| Apartment number | Shown as the plan unit (e.g. U07). The Figma mock uses a placeholder "142". |
| Status feed | `units.json` is fetched with `no-cache`, so an edited file shows on reload. `feed.html` stands in for the client's system: it stores changes in `localStorage`, and open viewer tabs apply them live. |
| Contact form | Validated in the browser and stored in `localStorage` only. Nothing is sent. |
| Site menu | Mirrors the Figma navigation. Pages outside this demo are greyed out. |

## Tested

Tests ran in headless Chrome at 1440×900, 1280×800, 1024×768 and 390×844 (touch, DPR 2), with no console errors:

- the K0 hover card;
- K0 → A1 in about 1.1 s;
- A1 → A2 in about 1.04 s;
- A2 → B1 through K0 in about 3.1 s;
- hover preview and click-to-pin;
- rapid clicks during a clip (the last one wins, and the viewer never gets stuck);
- filters;
- the mobile tap sheet, closing it via the backdrop, and swipe;
- keyboard navigation, Enter and Esc;
- reduced-motion crossfade;
- deep links;
- feed simulation surviving a reload, and its reset;
- residence and contact pages, including form validation.

Not covered: real iOS Safari and Android devices, and the 4G performance budget. Both are Phase 5 items in the plan.
