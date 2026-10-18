# Ice-Nine Ocean Spread

A browser simulation of ice-nine, the seed crystal from Kurt Vonnegut's *Cat's Cradle*
that freezes water at 45.8 °C, spreading through the world's oceans, plus a paper and a
website with the results. Live at <https://ice9.world> (simulation at <https://ice9.world/sim/>).

Drop a seed in the water and watch the lattice advance. Freezing releases latent heat
into the water, so each column stops at its melting point: the ocean stalls near 39%
frozen within a week, then freezes about 0.4 percentage points a year. Sea spray lofts
crystals, and rain that freezes on them seeds the sea, lakes and rivers and falls on land
as ice-nine snow. A sinking solid leaves a 42 °C slush ocean under 35 °C air. A floating
solid closes a crust after about six years and the planet ends near -37 °C.

The model runs on a 1°, 0.5°, 0.25° or 0.125° grid built from a 1 km land mask and Natural
Earth bathymetry. It tracks heat capacity by depth, latent heat in each column, bulk
air-sea exchange, a 1° atmosphere with seasons, a water-vapour greenhouse and clouds,
a vapour field that sets rain and snowfall, idealised surface currents, seasonal sea ice,
rivers, lakes and the Greenland and Antarctic ice sheets. Energy is conserved to 0.03%.

- `docs/`: the website, with the timeline, findings, renders and the paper PDF.
- `docs/sim/`: the simulation.
- `paper/`: the paper source and figure scripts.
- `tools/runs/`: the headless runs behind every number in the paper.

## Run it

Static files, no build step, no dependencies. Serve `docs/` over HTTP:

```bash
python3 -m http.server -d docs 8000
```

Then open <http://localhost:8000> for the website and <http://localhost:8000/sim/> for the simulation. Opening `docs/sim/index.html` straight from disk does
not work, because browsers block `fetch` on `file://` and the map data is fetched.

GitHub Pages can publish it directly: set the Pages source to the `docs/` folder.

## Using it

- Tap or click water to drop a seed. Start runs the simulation; Step advances one frame.
- Drag to pan, scroll or pinch to zoom. Globe switches to an orthographic view you drag to rotate.
- Satellite draws NOAA ETOPO1 natural-colour relief under the simulation.
- Model settings change the run: front speed, latent heat, cooling to space, atmospheric
  mixing, crystal lofting, washout and threshold, and checkboxes for floating ice-nine,
  latent heat (uncheck for Vonnegut mode, where nothing stops the front), day/night and seasons,
  atmosphere, greenhouse, clouds, life in the brine, bathymetry, currents and snowfall.
- Display settings only change the picture: natural colour (roughly what the planet would look
  like from space), currents, air temperature, solid fraction, globe and satellite.

Requires a browser with `DecompressionStream` (Chrome 80+, Firefox 113+, Safari 16.4+).

## Data sources

Natural Earth is public domain; GLOBE and ETOPO1 are NOAA products (licence terms not checked); GPCC is Deutscher Wetterdienst open data under CC BY 4.0.

- Coastlines: the NOAA GLOBE 1 km land mask, via the [global-land-mask](https://github.com/toddkarin/global-land-mask) package.
- Depths, lakes and rivers: [Natural Earth](https://www.naturalearthdata.com/) 10m bathymetry, lakes and river centerlines.
- Satellite imagery: [NOAA ETOPO1](https://www.ncei.noaa.gov/products/etopo-global-relief-model) ice-surface colour shaded relief.
- Land precipitation: [GPCC Precipitation Analysis Climatology V2025](https://opendata.dwd.de/climate_environment/GPCC/html/gpcc_precipitation_analysis_climatology_v2025_doi_download.html), 1°, 1971-2000 (Rustemeier, Finger, Schirmeister, Ziese 2025, doi:10.5676/DWD_GPCC/CLIMAT_V2025_100). Source: Deutscher Wetterdienst, modified. Antarctica, which GPCC does not cover, uses 171 mm/yr (Palerme et al. 2014).

`tools/build_data.py` rebuilds `docs/sim/data/` from these sources. It needs Python with numpy and Pillow:

```bash
python3 tools/build_data.py
```

## Paper

`paper/ice9.tex` builds with pdfLaTeX. To rerun every simulation behind it (hours to days), see
[tools/runs/README.md](tools/runs/README.md).

## License

Code, website text and the paper: Copyright 2026 Erik Wistrand, licensed under the
[Apache License, Version 2.0](LICENSE).

The data files in `docs/sim/data/` are derived from the sources above and keep their terms:
`precip.bin` is derived from GPCC data (Deutscher Wetterdienst, CC BY 4.0), the rest from
Natural Earth and NOAA data.
