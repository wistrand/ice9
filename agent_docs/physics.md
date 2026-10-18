# Physical constants

Where each constant in `docs/sim/app.js` comes from. The model's defaults are the derived
values; the sliders scale them. Change a constant only with a derivation, and update
this file with it.

## Contents
- Units
- Derived constants
- Exchange formulas
- Still tuned
- Known gaps

## Units

- Temperature in °C, time in hours, heat capacity of a column as `cap` = depth / 3700 m
  (a 3700 m water column is 1). `KC = 3600/(4.18e6*3700)` converts a flux coefficient
  in W/m²/K into a per-hour relaxation rate for a cap-1 column.
- Latent heat `l` is K of warming per unit solid fraction of liquid water:
  `l = L[kJ/kg] / 4.18`. The slider stores `l`.
- Solid ice-nine holds half the heat per degree of water, so a column at solid
  fraction `p` warms by `l/(1-p/2)` per unit frozen.

## Derived constants

| Constant | Value | Derivation |
|---|---|---|
| `MELT` | 45.8 °C | The book (114.4 °F). |
| Latent heat default | 389 kJ/kg (`lat` = 93) | Every known ice has an entropy of fusion of 20–22 J/mol/K (ice Ih: 6010 J/mol / 273 K = 22). Times 319 K: 7.0 kJ/mol = 390 kJ/kg. |
| `SALT` | 2.2 K | Cryoscopic constant `K_f = R Tm² M / ΔH` = 8.314 × 319² × 0.018 / 7020 = 2.17 K kg/mol; seawater's effective 1.02 mol/kg of solute (what gives 1.86 K at 0 °C) gives 2.2 K. |
| Salinity tracer | `sal`, `sald` (g/kg, per layer) | Floats mode only. The solid excludes salt, so the liquid has salinity `s/(1-p)`; the depression is `SALT*s/S0/(1-p)` capped at `SALT_SAT`. Initial surface salinity is lowered just enough that no column starts denser on top. Salt is conserved to 1e-9 (overturn mixes it over the two layers' liquid). |
| Liquid density | `rhoW(T,S)` | UNESCO 1980 at one atmosphere, salinity capped at 260 g/kg; beyond 42 g/kg it is an extrapolation with the right sign and size (saturated brine about 1.2 g/cm³). Pressure is ignored, since both layers are compared at their interface. |
| `SALT_SAT` | 16 K | Brine concentrates as `1/(1-p)`; NaCl saturates at about 7.5× seawater, where the depression is 2.2 × 7.5. Beyond that, salt precipitates and the melting point stops falling. |
| Solid heat capacity | 0.5 × water | Ice, 2.1 kJ/kg/K. Every heat flow uses the column's `cap*(1 - phi/2)`; the latent heat follows Kirchhoff's law (below). |
| `H_SENS` | 10 W/m²/K | Bulk sensible flux: ρ_a c_p C_H U = 1.2 × 1004 × 1.2e-3 × 7 m/s. |
| `H_LAT20`, `hLat(t)` | 22 W/m²/K at 20 °C, × e^{0.06(t−20)} | Bulk latent flux: ρ_a L_v C_E U dq_s/dT; dq_s/dT doubles every ~12 K (Clausius-Clapeyron). About 90 W/m²/K at 45 °C. Scaled by the open surface (`openSurface`), not the liquid fraction: a sinking solid lies on the floor. |
| `H_LW` | 5 W/m²/K | Net longwave sensitivity of a sea surface, 4εσT³ less back-radiation. |
| Sea-to-air coupling | `cp = ht/hx` (0.67–0.95) | The sea relaxes toward climatology shifted by the air anomaly weighted by the turbulent share of its total exchange. |
| `AMP_LAND`, `AMP_SEA` | 1-17 K by latitude | Half the annual range of monthly-mean surface air temperature over land and over sea, every 10° (approximate climatology, rounded). Each 1° air cell mixes them by its land share. `setAirSeason` moves `airTclim` along `airTannual + airAmp*cos(2π(doy-200)/365)` (sign flipped in the south) once per tick and carries each cell's anomaly over, so a run without ice-nine follows today's seasons. Off with the day/night and seasons checkbox. |
| `G_SUN` | 10 K | Bare ground in daylight above the air, at the equator at equinox, averaged over daylight hours (dry ground at noon runs 15-25 K above the air). Scaled by the daylight-mean cos(zenith) for the date and latitude and by the bare share `1 - whiteness`; melts snow for the daylight fraction of the day. Approximate. |
| `CONV_DT` | 3 K | Convective cap: the air's warming from its seasonal climatology may exceed the warming of the sea surface at its latitude (`rowSea`) by at most this much; the excess is carried aloft and spread evenly over the whole air, so it still has to leave by radiation (removing it outright bypassed the radiation limits and, early on, removed more heat than everything else combined). The sea is the heat source and moist convection couples the lower atmosphere to it; measuring warming keeps today's land-sea contrast. 3 K is the present tropical land-over-sea excess (1-3 K, approximate). An absolute cap (air at most sea + 3 K) was tried and rejected: it pinned continental summers at about 45 °C. Rows with no sea are not capped. |
| `AIR_C` | 1/1550 | Air column 1e7 J/m²/K against a 3700 m water column 1.55e10 J/m²/K. |
| Air climatology `airTclim` | `AIR_LAT`, 26.5 °C at the equator to −48 °C at the South Pole | Observed annual zonal-mean surface air temperature every 10° (reanalysis, rounded); its area mean is 14.06 °C and `buildAirClimate` shifts it to exactly `TA0` = 14. The air starts from it and relaxes toward it. |
| `E0` | 88 W/m² | Present ocean evaporation, 413,000 km³/yr over 361.9 M km² = 1.14 m/yr, times 2.45 MJ/kg. A vapour field `vapour` gets `E0` from open sea plus the model's anomalous latent flux; a reference `vapourToday` gets `E0` from all sea. |
| `TAU_V` | 9 days | Residence time of water vapour: 25 mm of precipitable water over 2.7 mm/day of global rain. Both fields rain out at this rate. |
| `K_V`, `U_V` | 1e6 m²/s, 8 m/s | Large-scale eddy diffusivity and low-level wind speed (times the zonal profile `wind`). Everything the air carries moves at these rates: the temperature anomaly, crystals and vapour. As an energy-balance diffusion over a 1e7 J/m²/K column, `K_V` is 0.24 W/m²/K, inside the 0.3-0.6 range of standard energy-balance models (inferred match, not a fit). The mixing slider scales both (medium = 1, still air = 0). |
| `landPrecip` | per 1° cell, from `data/precip.bin` | Observed annual land precipitation (GPCC climatology V2025, 1971-2000, Antarctica 171 mm/yr; see [data.md](data.md)). Local rain `landRain[a]` is `landPrecip + (vapour-vapourToday)/TAU_V` (converted at 2.45 MJ/kg) where the air holds more vapour than today, and `landPrecip*vapour/vapourToday` where it holds less. The additive form conserves water: extra evaporation falls as extra rain somewhere. |
| `SNOW_MASK` | 0.02 m w.e. | Snow masking depth for short vegetation is 1–3 cm water equivalent; forests need more. |
| `LAND_ALB` | 0.74 | Surface albedo gain of white land (0.25 to 0.8 = 0.55) over that of white sea (0.06 to 0.8 = 0.74). Applied as `ALBEDO_DROP` times that share of the white land area, in ocean-area units. |
| `CRY_OUT` | 1/168 per hour | Washout of tropospheric aerosol: about a week. Faster when it rains more (`rainRatio`). |
| `LAMBDA_P` | 3.3 W/m²/K at 288 K | Planck response of outgoing longwave radiation (AR6: 3.2), scaling as `T³`. Over the air column's `C_AIR` = 1e7 J/m²/K this is a 35-day relaxation; the cooling slider scales the whole radiative response (medium = 1). |
| `LAMBDA_WV`, `TAU_WV` | 1.3 W/m²/K, 31 K | Water-vapour greenhouse: today's combined water-vapour and lapse-rate feedback (AR6: 1.3), growing as `exp((T-288)/TAU_WV)` with the vapour the air holds. `TAU_WV` puts the net slope `olrSlope` at zero near 330 K, where the outgoing radiation of a saturated atmosphere nears its limit of about 282 W/m² (approximate: the curve overshoots that limit by about 14 W/m² at 330 K). Off with the greenhouse checkbox. |
| `LAMBDA_C` | 0.42 W/m²/K | Net cloud feedback, AR6 central estimate (range -0.1 to 0.94), subtracted from the radiative slope. Off with the clouds checkbox. |
| `CLOUD0`, `CLOUD_MAX`, `CLOUD_T` | 0.67, 0.9, 0.3 | Cloud masking of surface albedo. Today's global cloud cover is about 0.67; about 30% of sunlight gets through thick cloud. The surface's share of planetary reflection, clear sky plus `CLOUD_T` of the cloudy part, is then 0.53: clouds halve the effect of a surface albedo change, as observed. `F_ALB` already includes today's clouds, so `cloudMask` is a ratio to today. Cover per air cell is `CLOUD_MAX - (CLOUD_MAX-CLOUD0)*exp(-(v-1))` with `v` the vapour against today's (approximate shape: today's cover at today's vapour, saturating at 0.9 in a hot wet world, about 0.27 under a dry crust). Not modelled: the reflection and trapping of the extra cloud itself, whose net sign in a world this wet is unknown. |
| `F_ALB` | 102 W/m² | Sunlight reflected when the whole ocean is white, with today's clouds: planetary albedo 0.3 to 0.6 of 340 W/m². Applied as a forcing in proportion to the white surface, each square metre weighted by its sunshine (`sunW`: daily-mean insolation for the date over its global mean; the annual-mean profile of North 1975 with seasons off), the white ocean surface `seaWhite` (the floating crust; a sinking column only once frozen through, as drawn) plus `LAND_ALB` times white land (`landWhiteSeen`), both weighted by `cloudMask` of the local cover. |
| Day/night factor | night 1.2×, noon 0.6× | Diurnal insolation of ±200–400 W/m² against a loss of ~1 kW/m² for a column 30 K too warm. |
| `KH` | 3e-7 per hour per 1° cell | Lateral eddy diffusivity 1e3 m²/s over a 111 km cell: `κ Δt / Δx²`. Effectively zero; all latent heat stays in its column. |
| `A_WIND` | 0.006 cells/h at 1° | Wind-driven surface drift, 3% of a 7 m/s wind. |
| `OVERTURN_W` | 0.02 m/s | Brine-driven overturn mixes the two layers, and deep water reaches the crystals and freezes, at the speed convective plumes cross the column (open-ocean plumes: a few cm/s, up to about 10 cm/s; Marshall & Schott 1999): a share `1 - exp(-h*w/depth)` per step, about 2.3 days for 4 km. |
| `HM` | 100 m | Mixed-layer depth; global mean 50–70 m, winter deeper. |
| `KV_L`, `KV_I` | 1e-4, 1.2e-6 m²/s over 300 m | Vertical eddy diffusivity (Munk) and the thermal diffusivity of ice. |
| Ice-sheet conversion heat | `2*(l-80)` per unit | Only the difference between the two latent heats (389 − 334 = 55 kJ/kg) is released, into ice with half the heat capacity. |
| Solid-state conversion default | 1 m/h (slider minimum) | Self-diffusion in ice is ~1e-15 m²/s; a solid-state front would move centimetres a century. The slider's minimum is still generous. |

## Life in the brine (option, off by default)

Speculative; constants are taken from Earth analogues, not derived.

| Constant | Value | Basis |
|---|---|---|
| Habitat | floating crust with brine (`0.02 < phi < 0.999`), daylight | Sea-ice algae live in the liquid brine channels of ordinary sea ice. Cells isotonic with brine at its melting point are not supercooled, so the surrounding ice-nine need not freeze them (inference). Land snow holds no liquid below 45.8 °C; the sinking ocean's surface is open slush (no albedo change); a crust frozen through holds no brine. |
| `BIO_TMIN`, `BIO_TMAX` | -15, 45 °C | Sea-ice algae photosynthesise in brine near -15 °C; moderately thermophilic, halotolerant cyanobacteria (Halothece / Aphanothece halophytica, grows to NaCl saturation) and Dunaliella salina (to saturation, above 40 °C). Photosynthesis is known to 73 °C (alkaline hot-spring Synechococcus), but not combined with near-saturated brine; the 45 °C upper end is an estimate. |
| `BIO_GROW`, `BIO_DIE`, `BIO_SEED` | 0.3 /day, 0.05 /day, 0.01 | Typical microalgal growth rates; decay without light or brine; a seed population from plankton. Estimates. |
| `BIO_DARK` | 0.13 | A full bloom removes this share of the white crust's extra reflection: red snow algae lowered Arctic glacier albedo 13% over one melt season (Lutz et al. 2016); local ice-algae blooms on Greenland 3-43% (Chevrollier et al. 2023). |

Mosses and lichens are not candidates: neither is metabolically active near 45 °C, and both need liquid water films that ice-nine snow does not have.

## Melting point used by the front

The lattice can only take hold in water below its own melting point: `meltPtOpen(i)` = `meltPt(0, salinity)`, 43.6 °C for seawater, 45.8 °C for fresh inland water (`salinityOf`). Ice sheets use `MELT`. The map marks water above that point as `HOT`.

## Exchange formulas

The climatology `T0` in these formulas is `seaRef(i)`: a stratified column's own mean (`T0`), or today's sea surface (`T0surf`) once the lattice has seeded and mixed a sinking column. In floats mode the two are equal.

Latent heat follows Kirchhoff's law: solid ice-nine holds half the heat per degree of water, so freezing at `T` releases `l - 0.5*(MELT - T)` per unit solid fraction. A sealed layer that freezes without losing heat stops at the `phi*` with `l*phi* = Tm(phi*) - T0`: 0.43 for deep water at 2 °C.

For a water column at temperature `T`, solid fraction `p`, capacity `ci`, under local air
`airLocal` (the air cell above, `airT`), with `u = T - T0 - season` the anomaly from climatology and `dTa = airLocal - airTclim` the air's anomaly from its own latitude's climatology:

```
ht = H_SENS + hLat(T)*open         turbulent coefficient; open = openSurface: 1-p floating, 1 for a sinking slush until its last tenth
hx = ht + H_LW                     total
cp = ht/hx
target = T0 + season + cp*dTa
k  = hx*KC*h / (ci*(1-p/2))        per substep of h hours
T  -> target + (T-target)*exp(-k)
```

The loss is `ht*(u-dTa) + H_LW*u`. `airShare` gives the air the first term's share of
the actual change (both signs); the longwave share leaves directly. Ice sheets and
fully locked interior ice use `ht = H_SENS` (no evaporation). The air column then
takes `airIn/AIR_C`, mixes and advects, then loses `olr(T) - olr(airTclim) + forcing` (W/m², times
the cooling slider) over `C_AIR`, stepped backward-Euler on the local slope. Mixing and wind act on the anomaly `airT - airTclim`: the climatological
meridional transport is held fixed (a flux correction), so a uniform warming moves no heat
and the rest state is exact.

Only the sensible part of the turbulent flux (`H_SENS/ht` of it) warms the air above the sea. The latent part of the anomalous flux goes into `latentAir` (W·h/m²), travels with the air and is released where the vapour rains out, on `TAU_V`; today's evaporation and condensation are part of the climatology and are not moved.

## Still tuned

- Front speed 15 km/h: dendrite tip velocities extrapolated to 40 K undercooling give
  metres per second; the slider spans 1–200 km/h.
- `GROW` = 0.5 per hour: dendrites fill a 4 km column in hours.
- Storm seeding (Poisson launches) probability and reach, crystal drift rate: no physical basis. Storm seeding runs only with snowfall off; with snowfall on, the crystal field and rain seeding represent the same transport.
- Gyre amplitudes and the 0.06°/h unit current: shaped to give 1–2 m/s boundary currents.
- Wet-bed shares of the ice sheets (55% / 35%): literature estimates of basal thermal state.
- Seasonal sea-ice edges: drawn from climatology.
- Snowfall: the three crystal parameters have sliders (washout 1 day to 7 weeks, lofting 15 minutes to 100 days, threshold 1e-6 to 1e-2; defaults at the centre, `crystalParams`). A 54-run sweep over lofting x0.01-1, threshold x1-100, washout x1-3 and three rain variants moved year-one land cover from 95% to below 20%; washout and rain over land matter most, deserts and interiors are the least robust. Defaults: crystal lofting within a day (`CRY_UP`), rain freezing in full above a crystal level of 1e-4 of that over seeded water (`CRY_MIN`; below it the frozen share falls linearly, so numerical diffusion of the crystal field does not whiten distant land), a rain event every 3 days (`RAIN_EVERY`) for seeding inland water, melt at 15 W/m²/K above `MELT`. Rain keeps today's pattern and only scales; a hot world would shift it. Sunlit ground warmer than the air is not modelled (white snow reflects most of it). The water locked on land is reported but not taken from the ocean (a few cm per year).

## Known gaps

- The greenhouse is a single feedback curve against local air temperature, not radiative transfer; clouds are not modelled. The `H_LW*u` term is a window to space measured against climatology. The air is tied to the sea surface by the convective cap, so the greenhouse changes the air by only 0.5-2.5 K; it matters more for how fast heat leaves.
- Salt precipitation is not tracked as a mass; the brine cap only stops the melting point falling, and precipitated salt redissolves when the solid melts back. Sinking mode has no salinity tracer (each column keeps 35 g/kg bulk), which is exact for a sealed column.
- No ocean circulation beyond the fixed surface currents, and those carry heat as a conservative along-flow exchange rather than one-way advection, because the gridded field is not divergence-free (see [gotchas.md](gotchas.md)).

With these constants the sinks ending takes decades at the highest time step and the
floats crust takes years to close. That is the physics, not a bug; the old defaults
compressed time by factors of 100–1000 (see [gotchas.md](gotchas.md)).
