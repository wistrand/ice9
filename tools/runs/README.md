# Paper runs

Scripts that produce every number, figure and table in `paper/ice9.tex` and the images on the website. They run the
real `docs/sim/app.js` headless in Node, with DOM stubs, by clicking the Step button.

```bash
tools/runs/prepare.sh      # app copies in tools/runs/work/ (needs Pillow)
tools/runs/jobs.sh         # all runs, 10 at a time (JOBS=n to change); hours to days
tools/runs/figures.sh      # paper/fig/*.png, docs/img/*.webp, tables in work/ (needs numpy and Pillow)
cd paper && pdflatex ice9.tex && pdflatex ice9.tex && cp ice9.pdf ../docs/paper/
```

Needs Node 20 or later, Python 3 with numpy and Pillow, the DejaVu Sans font at the path in `paper/fig/chart.py`, and
pdfLaTeX. `work/` is not committed.

| Script           | Produces                                                                            |
|------------------|-------------------------------------------------------------------------------------|
| `prepare.sh`     | `work/app` (with `inject.js` as line 2), `work/cap15`, `work/cap5`, `work/sat.rgba` |
| `airstudy.mjs`   | per-step series (frozen, air, land white, rain) as JSON                             |
| `snowsweep.mjs`  | land snow cover overall, in deserts and interiors, for one crystal/rain setting     |
| `render.mjs`     | paper maps                                                                          |
| `depth.mjs`      | depth-band table                                                                    |
| `diaghost.mjs`   | diagnostics by day (`diag.mjs`): warming by band, clouds, snow, deep layer          |
| `ebhost.mjs`     | energy budget residual (`ebudget.mjs`)                                              |
| `mbhost.mjs`     | salt change and water held as snow (`mbudget.mjs`)                                  |
| `siterender.mjs` | website stills and animation frames                                                 |
| `globetest.mjs`  | pixel hash of the globe across views and display options, and its draw time         |
| `bitwise.mjs`    | SHA-256 of every state array after N seeded steps: compare before and after changes |

The tables in `work/` are pasted into `paper/ice9.tex` by hand, and the numbers in the paper text and on the website
are read from them and from `work/maps/*.txt`. The convergence runs set `SEED`; the scenario runs do not, so a rerun with
an unchanged `app.js` matches the paper to within the seed spread (0.1 percentage points frozen, 0.1 K air in the
convergence table), not bit for bit. `snowsweep.mjs` and `siterender.mjs` seed themselves; the map, depth and budget scripts do not. After a model change, rerun
everything and update the paper and the website.
