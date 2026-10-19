(async function() {
// ===== constants and data loading =====
const MELT = 45.8, OCEAN_KM2 = 361.9e6, OCEAN_KG = 1.4e21, CP = 4.18, START_DOY = 290, START_HOUR = 12,
  TA0 = 14;
let BR = 4, BW = 1440, BH = 720; // base data: BR cells per degree, read from the size of data/cells.bin
const LEVEL_M = [0, 100, 600, 1500, 2500, 3500, 4500, 5500, 6500, 7500, 8500, 9500, 10500];
const $ = id => document.getElementById(id);
const mapCanvas = $('map'), mapCtx = mapCanvas.getContext('2d');
const gridCanvas = document.createElement('canvas');
const gridCtx = gridCanvas.getContext('2d');
// base data: BR cells per degree, one byte each: bit 7 = land, bit 6 = lake (water not connected to the ocean), bit 5 = river centerline, low nibble = depth level
// data/cells.bin is the raw zlib stream; DecompressionStream('deflate') is the zlib format, so no inflate library is needed
async function loadCells() {
  const res = await fetch('data/cells.bin');
  if (!res.ok) throw new Error(res.status);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  const u = new Uint8Array(buf);
  BR = Math.round(Math.sqrt(u.length/64800));
  BW = 360*BR;
  BH = 180*BR;
  if (u.length !== BW*BH) throw new Error('cells: '+u.length);
  return u;
}
// annual land precipitation on the 1° air grid, m per hour (tools/build_data.py: GPCC climatology, byte b is (b/2)² mm/yr)
async function loadPrecip() {
  const res = await fetch('data/precip.bin');
  if (!res.ok) throw new Error(res.status);
  const u = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  if (u.length !== 64800) throw new Error('precip: '+u.length);
  const p = new Float32Array(64800);
  for (let a = 0; a < 64800; a++) p[a] = (u[a]/2)**2/1000/8760;
  return p;
}
let base, landPrecip;
try {base = await loadCells();} catch (e) {base = null;}
try {landPrecip = await loadPrecip();} catch (e) {landPrecip = new Float32Array(64800).fill(0.75/8760);} // without the map: today's mean over land everywhere
$('loading').hidden = true;
// ===== grid state =====
let legendDark = null, condW = null;
// conduction weights per cell and neighbour (E, W, N, S), mass-weighted when bathymetry is on; 0 where the neighbour is land or an ice sheet
function buildWeights() {
  const N = W*H, useCap = useDepth();
  condW = new Float32Array(N*4);
  for (let i = 0; i < N; i++) {
    if (grid[i] === 1 && kind[i] !== 3) continue;
    const r = (i/W)|0, q = i-r*W, capI = useCap ? cap[i] : 1;
    const nbrs = [((q+1)%W)+r*W, ((q+W-1)%W)+r*W, r > 0 ? i-W : -1, r < H-1 ? i+W : -1];
    let count = 0;
    for (let k = 0; k < 4; k++) {
      const n = nbrs[k];
      if (n < 0 || grid[n] === 1 || kind[n] === 3) continue;
      condW[i*4+k] = useCap ? 2*cap[n]/(capI+cap[n]) : 1;
      count++;
    }
    if (count) for (let k = 0; k < 4; k++) condW[i*4+k] /= count;
  }
}
let nightMask, nightImg, airCell, seaIceCover, seaIceDay = -1, frozenList = new Int32Array(0), frozenN = 0, season = 0;
const nightCanvas = document.createElement('canvas'), nightCtx = nightCanvas.getContext('2d');
let W, H, RES, grid, T, T0, T0surf, Tnext, cap, depth, Td, T0d, phid, capd, sal, sal0, sald, overturnMass = 0, floatMode = false,
  cosLat, sinLat, wind, insolation, night, gridImg, gridPx, waterCount, massTotal, curU, curV, cellSystem, kind, inlandCount,
  riverBaseCells;
// kind: 0 ocean, 1 lake, 2 river channel (a land block the river runs through), 3 ice sheet (Greenland, Antarctica)
// grid: 0 water the lattice has not reached, 1 land, 2 seeded (crystals present), 4 a transient mark while step compacts frozenList
let wetBed, sheetMass = 0, sheetFrozen = 0;
// energy leaving or entering the system, in ocean-column units (cap*K per cell, area-weighted): sea surface to space, air to space,
// heat vented by the convective cap and the clamps, and the seasonal climatology's input. Used to check the energy budget.
const budget = {sea: 0, air: 0, vent: 0, season: 0};
const systemArea = new Float64Array(9), systemFlow = new Float32Array(9).fill(1);
// ice-nine snowfall: airborne crystals on the air grid; snow water equivalent (m) on land cells
let bloom, snow, landList, inlandList, landArea = 0, landWhite = 0, landWhiteSeen = 0, snowVol = 0, rainRatio = 1, vapourEps = 0;
// ===== the air: a 1° grid of air temperature, mixed by diffusion and the zonal wind, radiating to space cell by cell =====
const AW = 360, AH = 180, AN = AW*AH, airT = new Float32Array(AN).fill(TA0), airTnext = new Float32Array(AN),
  airIn = new Float32Array(AN), airTclim = new Float32Array(AN).fill(TA0);
// on the air grid: crystals, water vapour now and as it would be today (same transport, today's evaporation), local land rain (m/h), and per-tick tallies
const crystals = new Float32Array(AN), vapour = new Float32Array(AN), vapourToday = new Float32Array(AN), landRain = new Float32Array(AN),
  evapAnom = new Float32Array(AN), latentAir = new Float32Array(AN), cloud = new Float32Array(AN), seaCovered = new Float32Array(AN), crystalSrc = new Float32Array(AN), seaCells = new Float32Array(AN), tracerNext = new Float32Array(AN);
// observed annual zonal-mean surface air temperature, 90°N to 90°S every 10° (reanalysis climatology, rounded); shifted in buildAirClimate so its area mean is exactly TA0
const AIR_LAT = [-18, -16, -10, -1, 5, 13, 20, 25, 26.5, 26.5, 25.5, 23, 18.5, 12, 5.5, -2, -14, -35, -48];
// half the annual range of monthly-mean surface air temperature over land and over sea, 90°N to 90°S every 10° (approximate climatology,
// rounded: continental interiors swing 15-20 K at 50-70°N, the tropics 1-2 K, the oceans a few K, sea-ice regions more)
const AMP_LAND = [15, 16, 17, 15, 13, 11, 8, 4, 2, 1, 2, 4, 6, 5, 4, 6, 10, 14, 15];
const AMP_SEA = [12, 10, 6, 4, 3.5, 3.5, 2.5, 1.5, 0.5, 0.5, 1, 1.5, 2, 2, 1.5, 2, 5, 8, 10];
const SEASON_PEAK_DOY = 200; // northern land air peaks in mid to late July, a month after the solstice; the south half a year later
const airTannual = new Float32Array(AN), airAmp = new Float32Array(AN), airNorth = new Uint8Array(AH);
function buildAirClimate() {
  let s = 0, w = 0;
  for (let r = 0; r < AH; r++) {
    const x = (r+0.5)/10, k = Math.min(17, Math.floor(x)), v = AIR_LAT[k]+(AIR_LAT[k+1]-AIR_LAT[k])*(x-k), c = cosLat[(r*RES)|0];
    airTannual.fill(v, r*AW, (r+1)*AW);
    s += v*c;
    w += c;
    airNorth[r] = r < AH/2 ? 1 : 0;
    const aL = AMP_LAND[k]+(AMP_LAND[k+1]-AMP_LAND[k])*(x-k), aS = AMP_SEA[k]+(AMP_SEA[k+1]-AMP_SEA[k])*(x-k);
    for (let q = 0; q < AW; q++) { // the land share of the 1° cell sets its seasonal swing
      let land = 0;
      for (let y = r*RES; y < (r+1)*RES; y++) for (let xq = q*RES; xq < (q+1)*RES; xq++) {
        const i = y*W+xq;
        if (grid[i] === 1 || kind[i]) land++;
      }
      const f = land/(RES*RES);
      airAmp[r*AW+q] = f*aL+(1-f)*aS;
    }
  }
  const d = TA0-s/w;
  for (let a = 0; a < AN; a++) airTannual[a] += d;
  setAirSeason(false);
}
// the seasonal climatology for the current date; with keep, each cell's anomaly from climatology is carried over to the new date
function setAirSeason(keep) {
  const doy = START_DOY+(START_HOUR+hours)/24, ph = solar.checked ? Math.cos(2*Math.PI*(doy-SEASON_PEAK_DOY)/365) : 0;
  for (let r = 0; r < AH; r++) {
    const f = airNorth[r] ? ph : -ph, row0 = r*AW;
    const w = AIR_C*RES*RES*cosLat[(r*RES)|0];
    for (let q = 0; q < AW; q++) {
      const a = row0+q, c = airTannual[a]+airAmp[a]*f;
      if (keep) {
        airT[a] += c-airTclim[a];
        budget.season += (c-airTclim[a])*w;
      }
      airTclim[a] = c;
    }
  }
  olrClimOk = false;
}
function AREA(i) {return cosLat[(i/W)|0];} // cell area relative to an equatorial cell; stats, totals and gyre shares are area-weighted
function airIndexOf(i) {
  const r = (i/W)|0, q = i-r*W;
  return ((r/RES)|0)*AW+((q/RES)|0);
}
// ===== surface currents =====
// subtropical and subpolar gyres as asymmetric Gaussian stream functions (narrow on the west side, so western boundary currents come out strong), plus the Antarctic Circumpolar and equatorial currents. Unit speed = 0.06° per hour (about 2 m/s, Gulf Stream core).
// [lon0, lat0, sigma west, sigma east, sigma lat, sense (+1 clockwise), amplitude, basin lon min, basin lon max]
const GYRES = [[-50, 30, 32, 45, 16, 1, 1.5, -100, 0], [-40, 57, 20, 15, 8, -1, 0.9, -70, 15], [-15, -28, 35, 32, 16, -1, 1.6, -70, 22], [-175, 28, 70, 75, 25, 1, 3.3, 120, -95], [-175, 52, 50, 25, 14, -1, 1.8, 135, -120], [-130, -30, 103, 60, 30, -1, 4, 140, -68], [75, -30, 58, 45, 22, -1, 2.7, 20, 125]];
function inBasin(lon, a, b) {return a <= b ? (lon >= a && lon <= b) : (lon >= a || lon <= b);}
function streamFn(lon, lat) {
  let p = 0;
  for (const g of GYRES) {
    if (!inBasin(lon, g[7], g[8])) continue;
    let dx = lon-g[0];
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    const sx = dx < 0 ? g[2] : g[3];
    const dy = (lat-g[1])/g[4];
    p += g[5]*g[6]*Math.exp(-dx*dx/(sx*sx)-dy*dy);
  }
  return p;
}
function systemOf(lon, lat) {
  let best = 255, bv = 0.05;
  for (let k = 0; k < GYRES.length; k++) {
    const g = GYRES[k];
    if (!inBasin(lon, g[7], g[8])) continue;
    let dx = lon-g[0];
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    const sx = dx < 0 ? g[2] : g[3];
    const dy = (lat-g[1])/g[4];
    const v = g[6]*Math.exp(-dx*dx/(sx*sx)-dy*dy)/g[4];
    if (v > bv) {
      bv = v;
      best = k;
    }
  }
  if (best === 255) {
    if (lat > -65 && lat < -45) best = 7;
    else if (lat > -8 && lat < 9) best = 8;
  }
  return best;
}
// ===== air transport =====
// Everything the air carries (its temperature anomaly, crystals, water vapour) moves at physical rates: large-scale eddy diffusivity K_V and
// low-level winds of U_V times the zonal profile, scaled by the mixing slider (medium = 1). Both are solved so that any step length is stable:
// the wind by semi-Lagrangian shifts along each row (linear interpolation, conserves the row's total), the mixing implicitly per row and per
// column with the sphere's metric (east-west cells are cos(lat) narrow; north-south fluxes scale with the cosine of the cell edges), which
// conserves the area-weighted total.
const K_V = 1e6, U_V = 8;
const airCos = new Float64Array(AH), airCosEdge = new Float64Array(AH+1); // air-row centres and edges, 90°N at edge 0
for (let r = 0; r < AH; r++) airCos[r] = Math.cos((89.5-r)*Math.PI/180);
for (let r = 0; r <= AH; r++) airCosEdge[r] = Math.max(0, Math.cos((90-r)*Math.PI/180));
function airMixFactor() {return mixSlider.value/4;}
// The implicit diffusion matrices depend only on the diffusion number d (time step and mixing slider) and the latitude, not on the field,
// so they are factorised once per d and reused for every field carried and every substep: per row east-west (cyclic, by Sherman-Morrison,
// with the correction vector z stored), and once for all columns north-south (the same matrix in every column). The arithmetic is that of
// solveTridiag and solveCyclic, in the same order, so results are bit-identical to solving each system from scratch.
let trD = NaN;
const trEwG = new Float64Array(AN), trEwPiv = new Float64Array(AN), trEwZ = new Float64Array(AN), trEwDen = new Float64Array(AH), trEwE = new Float64Array(AH),
  trNsG = new Float64Array(AH), trNsPiv = new Float64Array(AH), trNsA = new Float64Array(AH), trX = new Float64Array(Math.max(AW, AH));
function factorAir(d) {
  trD = d;
  for (let r = 0; r < AH; r++) { // east-west: a = c = -e, b = 1+2e, wrapping; Sherman-Morrison modifies the first and last diagonal
    const row0 = r*AW, cosR = airCos[r], e = d/(cosR*cosR), alpha = -e, beta = -e, gamma = -(1+2*e);
    trEwE[r] = e;
    let piv = (1+2*e)-gamma;
    trEwPiv[row0] = piv;
    let z = gamma/piv;
    trEwZ[row0] = z;
    for (let k = 1; k < AW; k++) {
      const g = -e/piv;
      trEwG[row0+k] = g;
      piv = (k === AW-1 ? (1+2*e)-alpha*beta/gamma : 1+2*e)-(-e)*g;
      trEwPiv[row0+k] = piv;
      z = ((k === AW-1 ? alpha : 0)-(-e)*z)/piv;
      trEwZ[row0+k] = z;
    }
    for (let k = AW-2; k >= 0; k--) trEwZ[row0+k] -= trEwG[row0+k+1]*trEwZ[row0+k+1];
    trEwDen[r] = 1+trEwZ[row0]+beta*trEwZ[row0+AW-1]/gamma;
  }
  for (let r = 0; r < AH; r++) { // north-south, no flux through the poles
    const cN = d*airCosEdge[r]/airCos[r], cS = d*airCosEdge[r+1]/airCos[r];
    trNsA[r] = -cN;
    const b = 1+cN+cS;
    if (r === 0) trNsPiv[0] = b;
    else {
      const cPrev = -(d*airCosEdge[r]/airCos[r-1]), g = cPrev/trNsPiv[r-1];
      trNsG[r] = g;
      trNsPiv[r] = b-(-cN)*g;
    }
  }
}
function transportAir(h, field) {
  const f = airMixFactor();
  if (!f) return;
  const d = K_V*f*h*3600/(111.2e3*111.2e3), adv = U_V*f*h*3600/111.2e3; // diffusion number and wind shift, per 1° cell at the equator
  if (d !== trD) factorAir(d);
  const x = trX;
  for (let r = 0; r < AH; r++) {
    const row0 = r*AW, cosR = airCos[r], windRow = wind[(r*RES)|0] || 0;
    const shift = adv*windRow/cosR; // cells moved east this step
    if (Math.abs(shift) > 1e-6) {
      const s = ((shift%AW)+AW)%AW, k0 = Math.floor(s), fr = s-k0;
      for (let q = 0; q < AW; q++) {
        let j0 = q-k0-1; // departure point q-s lies between j0 and j0+1
        if (j0 < 0) j0 += AW;
        if (j0 < 0) j0 += AW;
        const j1 = j0+1 === AW ? 0 : j0+1;
        tracerNext[row0+q] = field[row0+j0]*fr+field[row0+j1]*(1-fr);
      }
      for (let q = 0; q < AW; q++) field[row0+q] = tracerNext[row0+q];
    }
    const ae = -trEwE[r], beta = ae, gamma = -(1+2*trEwE[r]); // east-west, cyclic
    x[0] = field[row0]/trEwPiv[row0];
    for (let k = 1; k < AW; k++) x[k] = (field[row0+k]-ae*x[k-1])/trEwPiv[row0+k];
    for (let k = AW-2; k >= 0; k--) x[k] -= trEwG[row0+k+1]*x[k+1];
    const fact = (x[0]+beta*x[AW-1]/gamma)/trEwDen[r];
    for (let q = 0; q < AW; q++) field[row0+q] = x[q]-fact*trEwZ[row0+q];
  }
  for (let q = 0; q < AW; q++) { // north-south
    x[0] = field[q]/trNsPiv[0];
    for (let r = 1; r < AH; r++) x[r] = (field[r*AW+q]-trNsA[r]*x[r-1])/trNsPiv[r];
    for (let r = AH-2; r >= 0; r--) x[r] -= trNsG[r+1]*x[r+1];
    for (let r = 0; r < AH; r++) field[r*AW+q] = x[r];
  }
}
function expNeg(k) {return k < 0.7 ? 1/(1+k+k*k*0.5+k*k*k*0.1667) : Math.exp(-k);} // cheap exp(-k) for the small per-step rates (accurate to ~1e-3 below 0.7)
// the air column holds 1/1550 of a reference ocean column's heat; it mixes, is blown by the zonal wind, and radiates to space by a T^4 law on a 35-day timescale scaled by the cooling slider
function airStep(h) {
  // the white surface reflects sunlight that today's climate absorbs: a forcing on every air cell; the slider scales the radiative response
  const forcing = F_ALB*(seaWhite+LAND_ALB*landWhiteSeen/waterCount), cellsPerAir = RES*RES, coolK = coolSlider.value/4,
    gh = greenhouseCk.checked, cl = cloudsCk.checked, secs = h*3600;
  // the heat from the sea (and from freezing rain) arrives, then the anomaly from climatology is moved: the climatological transport is part of the climatology (held fixed)
  for (let a = 0; a < AN; a++) airTnext[a] = airT[a]+airIn[a]/AIR_C/cellsPerAir-airTclim[a];
  transportAir(h, airTnext);
  transportAir(h, vapour); // vapour travels with the same air; vapourToday is at steady state from spinVapourToday
  transportAir(h, latentAir);
  if (snowCk.checked) transportAir(h, crystals);
  if (!olrClimOk || olrClimGh !== gh || olrClimCl !== cl) {
    for (let a = 0; a < AN; a++) olrClim[a] = olr(airTclim[a], gh, cl);
    olrClimOk = true;
    olrClimGh = gh;
    olrClimCl = cl;
  }
  let sum = 0, capped = 0, wAll = 0;
  for (let r = 0; r < AH; r++) {
    const row0 = r*AW, cosR = cosLat[(r*RES)|0], capRow = rowSea[r]+CONV_DT, wAir = AIR_C*cellsPerAir*cosR; // a warming cap, added to each cell's climatology
    wAll += wAir*AW;
    for (let q = 0; q < AW; q++) {
      const a = row0+q, tc = airTclim[a];
      let t = tc+airTnext[a];
      // net radiation above today's balance at this cell, stepped backward-Euler on the local slope (stable at any step length)
      olrBoth(t, gh, cl);
      const flux = coolK*(olrOut-olrClim[a]+forcing), slope = Math.max(0.05, coolK*olrSlopeOut);
      const tIn = t;
      t -= flux*secs/(C_AIR+slope*secs);
      budget.air += (tIn-t)*wAir;
      if (t > airTclim[a]+capRow) { // NaN where the row has no sea: no cap
        capped += (t-airTclim[a]-capRow)*wAir;
        t = airTclim[a]+capRow;
      }
      const tCap = t;
      t = Math.max(-90, Math.min(400, t));
      budget.vent += (tCap-t)*wAir; // the safety clamps only; should stay zero
      airT[a] = t;
      sum += airT[a]*cosR;
    }
  }
  // convection carries the capped heat aloft, where the circulation spreads it: it stays in the air, spread evenly, and leaves through the radiation above
  const spread = capped/wAll;
  if (spread) for (let a = 0; a < AN; a++) airT[a] += spread;
  let wSum = 0;
  for (let r = 0; r < AH; r++) wSum += cosLat[(r*RES)|0]*AW;
  airMean = sum/wSum+spread;
}
// ===== implicit solvers, east-west conduction, and heat carried by currents =====
// east-west conduction catch-up: a cell is cos(lat) as wide as it is tall, so east-west exchange should be 1/cos² times the isotropic pass's.
// Solved implicitly per row (tridiagonal, cyclic when the row is all water), so it is stable at any latitude and costs one pass.
let triA, triB, triC, triD, triX, triZ, triG, triSize = 0;
let atRest = new Uint8Array(0), chunkQuiet, chunkRest, nChunks = 0;
const CHUNK = 32;
function triAlloc(n) {
  if (triSize >= n) return;
  triSize = n;
  triA = new Float64Array(n);
  triB = new Float64Array(n);
  triC = new Float64Array(n);
  triD = new Float64Array(n);
  triX = new Float64Array(n);
  triZ = new Float64Array(n);
  triG = new Float64Array(n);
}
function solveTridiag(n, d, x) { // a[k]x[k-1]+b[k]x[k]+c[k]x[k+1]=d[k]; a[0] and c[n-1] are not used
  let piv = triB[0];
  x[0] = d[0]/piv;
  for (let k = 1; k < n; k++) {
    triG[k] = triC[k-1]/piv;
    piv = triB[k]-triA[k]*triG[k];
    x[k] = (d[k]-triA[k]*x[k-1])/piv;
  }
  for (let k = n-2; k >= 0; k--) x[k] -= triG[k+1]*x[k+1];
}
function solveCyclic(n) { // the same with wrap terms a[0] (to x[n-1]) and c[n-1] (to x[0]), by Sherman-Morrison; result in tdX, tdD is consumed
  const alpha = triC[n-1], beta = triA[0], gamma = -triB[0], bFirst = triB[0], bLast = triB[n-1];
  triB[0] = bFirst-gamma;
  triB[n-1] = bLast-alpha*beta/gamma;
  solveTridiag(n, triD, triX);
  triD.fill(0, 0, n);
  triD[0] = gamma;
  triD[n-1] = alpha;
  solveTridiag(n, triD, triZ);
  const fact = (triX[0]+beta*triX[n-1]/gamma)/(1+triZ[0]+beta*triZ[n-1]/gamma);
  for (let k = 0; k < n; k++) triX[k] -= fact*triZ[k];
  triB[0] = bFirst;
  triB[n-1] = bLast;
}
// heat carried by currents and wind drift, as a symmetric exchange between each column and its downstream neighbour: conserves heat exactly and stays bounded. Upwind advection
// was tried and rejected: the model's velocity field is not divergence-free on the grid (asymmetric gyre scalings, coasts), so the advective form destroyed more heat than the
// surface shed over years, and the flux form piled heat into convergence cells. Along-flow mixing keeps what matters here, heat smeared along the currents, without inventing any.
let advHeat = new Float32Array(0);
function exchange(i, dst, coef, areaI, areaDst) { // areaI, areaDst: AREA(i), AREA(dst), passed in by advect
  if (grid[dst] === 1 || kind[dst] === 3) return;
  const wSrc = CAP(i)*areaI*(1-0.5*phi[i]), wDst = CAP(dst)*areaDst*(1-0.5*phi[dst]), dT = coef*(T[dst]-T[i])*wSrc*wDst/(wSrc+wDst); // heat capacities: solid holds half
  advHeat[i] += dT/wSrc;
  advHeat[dst] -= dT/wDst;
} // moves heat dT*... so both sides change in proportion to their capacities
function advect(Awind, curRate) {
  const N = W*H;
  if (advHeat.length !== N) advHeat = new Float32Array(N);
  else advHeat.fill(0);
  for (let r = 0; r < H; r++) {
    const row0 = r*W, areaR = cosLat[r], cosR = Math.max(1e-3, cosLat[r]), windRow = wind[r], windRate = Awind && Math.abs(windRow) > 0.02 ? Math.min(0.2, Awind*Math.abs(windRow)/cosR) : 0;
    for (let q = 0; q < W; q++) {
      const i = row0+q;
      if (grid[i] === 1 || kind[i] === 3) continue;
      const east = q === W-1 ? row0 : i+1, west = q === 0 ? row0+W-1 : i-1;
      const openHere = openSurface(i);
      if (openHere <= 0) continue; // no wind stress and no current under ice
      if (windRate) {
        const dst = windRow > 0 ? east : west;
        const openBoth = Math.min(openHere, openSurface(dst));
        if (openBoth > 0) exchange(i, dst, windRate*openBoth, areaR, areaR);
      } // wind drift needs open water on both sides of the exchange
      if (curRate) {
        const u = curU[i], v = curV[i], flowF = flowFactor(i);
        if (Math.abs(u) > 0.05) {
          const dst = u > 0 ? east : west;
          exchange(i, dst, Math.min(0.2, curRate*Math.abs(u)*flowF*Math.min(1, openSurface(dst)/openHere)/cosR), areaR, areaR);
        }
        if (Math.abs(v) > 0.05) {
          const rowTo = r+(v > 0 ? -1 : 1);
          if (rowTo >= 0 && rowTo < H) {
            const dst = rowTo*W+q;
            exchange(i, dst, Math.min(0.2, curRate*Math.abs(v)*flowF*Math.min(1, openSurface(dst)/openHere)), areaR, cosLat[rowTo]);
          }
        }
      }
    }
  }
}
function ewConduct(Dcond) {
  triAlloc(Math.max(W, AW));
  for (let r = 0; r < H; r++) {
    const cosR = cosLat[r], extra = Dcond*(1/(cosR*cosR)-1);
    if (extra < 0.02) continue;
    const row0 = r*W;
    let dryQ = -1;
    for (let q = 0; q < W; q++) {
      const i = row0+q;
      if (grid[i] === 1 || kind[i] === 3) {
        dryQ = q;
        break;
      }
    }
    let isFlat = true;
    for (let q = 0; q < W-1; q++) {
      const i = row0+q;
      if (Math.abs(T[i]-T[i+1]) >= 1e-3 && condW[i*4]) {
        isFlat = false;
        break;
      }
    } // rows at rest are exactly flat; skip them before building anything
    if (isFlat && !(dryQ < 0 && Math.abs(T[row0]-T[row0+W-1]) >= 1e-3)) continue;
    if (dryQ < 0) { // all water: one cyclic system
      for (let q = 0; q < W; q++) {
        const i = row0+q, east = extra*condW[i*4], west = extra*condW[i*4+1];
        triA[q] = -west;
        triC[q] = -east;
        triB[q] = 1+east+west;
        triD[q] = T[i];
      }
      solveCyclic(W);
      for (let q = 0; q < W; q++) T[row0+q] = triX[q];
      continue;
    }
    // otherwise walk the row from just east of a land or ice-sheet cell and solve each run of water on its own, skipping flat runs
    let n = 0, runStart = 0, maxGap = 0;
    for (let k = 1; k <= W; k++) {
      let q = dryQ+k;
      if (q >= W) q -= W;
      const i = row0+q, isDry = k === W || grid[i] === 1 || kind[i] === 3;
      if (!isDry) {
        if (n === 0) {
          runStart = q;
          maxGap = 0;
        } else {
          const d = Math.abs(T[i]-triD[n-1]);
          if (d > maxGap) maxGap = d;
        }
        const east = extra*condW[i*4], west = extra*condW[i*4+1];
        triA[n] = -west;
        triC[n] = -east;
        triB[n] = 1+east+west;
        triD[n] = T[i];
        n++;
        continue;
      }
      if (n > 1 && maxGap >= 1e-3) {
        solveTridiag(n, triD, triX);
        for (let j = 0; j < n; j++) {
          let qOut = runStart+j;
          if (qOut >= W) qOut -= W;
          T[row0+qOut] = triX[j];
        }
      }
      n = 0;
    }
  }
}
// open surface: the share of a column's surface the wind acts on. A floating crust covers it as it grows; a sinking solid lies on the floor and the surface stays open until the column is frozen through (the last tenth, as drawn)
function openSurface(i) {
  const p = phi[i];
  return floatMode ? 1-p : p < 0.9 ? 1 : Math.max(0, (1-p)*10);
}
// leads: a share of a floating crust kept open by cracking (leads slider, open-water equivalent). They spray crystals, count as open sea for
// evaporation and are dark; their heat comes from the deep layer (leadStep). Not used for the wind's grip on the gyres, which a cracked crust still blocks.
const LEAD_STEPS = [0, 0.001, 0.002, 0.003, 0.005, 0.01, 0.02, 0.03, 0.05];
function leadShare() {return floatMode ? LEAD_STEPS[leadsSlider.value] : 0;}
function leadOpen(i, lead) {return lead > 0 && kind[i] === 0 && grid[i] === 2 ? Math.max(lead, openSurface(i)) : openSurface(i);}
// the gyres are wind-driven: by Sverdrup balance a gyre's transport scales with the wind stress over its basin, so with the basin's open surface share; locally there is no flow under ice
const systemOpen = new Float64Array(9);
function updateSystems() {
  systemOpen.fill(0);
  for (let i = 0; i < grid.length; i++) {
    const sy = cellSystem[i];
    if (sy < 255) systemOpen[sy] += AREA(i)*openSurface(i);
  }
  for (let k = 0; k < 9; k++) systemFlow[k] = systemArea[k] ? systemOpen[k]/systemArea[k] : 1;
}
function flowFactor(i) {
  const sy = cellSystem[i];
  return (sy < 255 ? systemFlow[sy] : 1)*openSurface(i);
}
function latBand(x, a, b) {return x < a || x > b ? 0 : Math.sin(Math.PI*(x-a)/(b-a));}
function currentAt(lon, lat) {
  const e = 0.5;
  let u = -(streamFn(lon, lat+e)-streamFn(lon, lat-e))/(2*e)*10, v = (streamFn(lon+e, lat)-streamFn(lon-e, lat))/(2*e)*25; // meridional flow emphasised: boundary currents are the fast ones
  u += 0.8*latBand(lat, -65, -45);
  u -= 0.7*latBand(lat, -8, 3);
  if (lon < -80 || lon > 120 || (lon > -55 && lon < 10)) u += 0.9*latBand(lat, 3, 9);
  else u -= 0.4*latBand(lat, 3, 9);
  const sp = Math.hypot(u, v);
  if (sp > 1.2) {
    u *= 1.2/sp;
    v *= 1.2/sp;
  }
  return [u, v];
}
// ===== building the grid =====
// an ocean column of depth d at row r: one layer, or in floats mode a mixed layer over a deep layer with an exponential thermocline (e-folding 500 m) from the surface climatology to 2 °C
function initOceanColumn(i, r, depthM) {
  depth[i] = depthM;
  const cos2 = cosLat[r]*cosLat[r];
  if (floatMode) {
    const mixM = Math.min(depthM, HM), deepM = depthM-mixM, tSurf = -1+29*cos2;
    cap[i] = Math.max(0.02, mixM/3700);
    const capDeep = Math.min(2.2, depthM/3700)-cap[i];
    capd[i] = capDeep > 1e-3 ? capDeep : 0;
    T0[i] = tSurf;
    T0surf[i] = tSurf;
    T0d[i] = deepM > 0 ? 2+(tSurf-2)*(500/deepM)*(1-Math.exp(-deepM/500)) : tSurf;
    if (capd[i] > 0) {
      const excessRho = rhoW(tSurf, S0)-rhoW(T0d[i], S0)+0.05;
      if (excessRho > 0) sal0[i] = S0-excessRho/0.78;
    }
    sal[i] = sal0[i];
  } // surface water that would be denser than the water below is fresher, as in the real polar ocean (0.78 kg/m³ per g/kg) // no deep layer thinner than a few metres
  else {
    cap[i] = Math.max(0.05, Math.min(2.2, depthM/3700));
    capd[i] = 0;
    T0[i] = 2+6*cos2;
    T0d[i] = T0[i];
    T0surf[i] = -1+29*cos2; // today's sea surface: the reference once crystals have mixed the column (see seaRef)
  }
  waterCount += cosLat[r];
  massTotal += (CAP(i)+capd[i])*cosLat[r];
}
function build(res) {
  RES = res;
  floatMode = floatsCk.checked;
  W = 360*res;
  H = 180*res;
  gridCanvas.width = W;
  gridCanvas.height = H;
  gridImg = gridCtx.createImageData(W, H);
  gridPx = gridImg.data;
  const N = W*H;
  front = new Int32Array(Math.max(1024, N>>4));
  frontN = 0;
  grid = new Uint8Array(N);
  phi = new Float32Array(N);
  T = new Float32Array(N);
  T0 = new Float32Array(N);
  T0surf = new Float32Array(N);
  Tnext = new Float32Array(N);
  cap = new Float32Array(N);
  depth = new Float32Array(N);
  Td = new Float32Array(N);
  T0d = new Float32Array(N);
  sal = new Float32Array(N).fill(S0);
  bloom = new Float32Array(N);
  sal0 = new Float32Array(N).fill(S0);
  sald = new Float32Array(N).fill(S0);
  phid = new Float32Array(N);
  capd = new Float32Array(N);
  cosLat = new Float32Array(H);
  sinLat = new Float32Array(H);
  wind = new Float32Array(H);
  curU = new Float32Array(N);
  curV = new Float32Array(N);
  cellSystem = new Uint8Array(N).fill(255);
  kind = new Uint8Array(N);
  wetBed = new Uint8Array(N);
  inlandCount = 0;
  sheetMass = 0;
  sheetFrozen = 0;
  airCell = new Uint32Array(N);
  seaIceCover = new Float32Array(N);
  seaIceDay = -1;
  frozenList = new Int32Array(Math.max(1024, N>>2));
  frozenN = 0;
  nChunks = Math.ceil(W/CHUNK);
  atRest = new Uint8Array(0);
  probLiquid = new Float32Array(H*3);
  probSolid = new Float32Array(H*3);
  probBasal = new Float32Array(H*3);
  for (let i = 0; i < N; i++) airCell[i] = airIndexOf(i);
  systemArea.fill(0);
  systemFlow.fill(1);
  insolation = new Float32Array(N);
  night = new Uint8Array(N);
  nightMask = new Uint8Array(N);
  nightCanvas.width = W;
  nightCanvas.height = H;
  nightImg = nightCtx.createImageData(W, H);
  waterCount = 0;
  massTotal = 0;
  const sub = BR/res; // base cells per grid cell per axis
  for (let r = 0; r < H; r++) {
    const lat = 90-(r+.5)/res;
    cosLat[r] = Math.cos(lat*Math.PI/180);
    sinLat[r] = Math.sin(lat*Math.PI/180);
    // smooth zonal wind: easterly trades near the equator, westerlies in mid-latitudes, fading to calm over the poles
    const a = Math.abs(lat);
    wind[r] = a < 70 ? -Math.cos(a*Math.PI/30)*(a < 40 ? 1 : Math.cos((a-40)*Math.PI/60)) : 0;
    for (let q = 0; q < W; q++) {
      let land = 0, depthSum = 0, seaN = 0;
      let lake = 0, river = 0;
      for (let y = 0; y < sub; y++) for (let x = 0; x < sub; x++) {
        const c = base[(r*sub+y)*BW+q*sub+x];
        if (c&128) land++;
        else {
          if (c&64) lake++;
          else {
            depthSum += LEVEL_M[c&15];
            seaN++;
          }
        }
        if (c&32) river++;
      }
      const i = r*W+q;
      const isLand = land > sub*sub/2;
      grid[i] = isLand ? 1 : 0;
      if (isLand) {
        kind[i] = river ? 2 : 0;
        if (river) {
          grid[i] = 0;
          depth[i] = 5;
          cap[i] = 0.05;
          inlandCount += cosLat[r];
        }
        const lon = (q+.5)/res-180;
        let thick = 0;
        if (lat < -60) thick = 400+2600*Math.min(1, Math.max(0, (-lat-66)/18)); // Antarctica: thin at the coast, 3 km inland
        else if (lat > 59.5 && lat < 84 && lon > -73 && lon < -11) thick = 300+2700*Math.exp(-(((lon+40)/16)**2))*Math.min(1, Math.max(0, (lat-60)/6)); // Greenland ridge
        if (thick > 0) {
          kind[i] = 3;
          grid[i] = 0;
          depth[i] = thick;
          cap[i] = Math.max(0.05, Math.min(2.2, thick/3700*0.5)); // ice holds half the heat per degree
          const texture = 0.7*hash(q>>2, r>>2)+0.3*hash(q, r);
          wetBed[i] = texture < (lat < -60 ? (lat < -80 ? 0.3 : 0.55) : 0.35) ? 1 : 0; // wet-based share: ~55% Antarctica, 35% Greenland, drier at the pole
          T0[i] = lat < -60 ? -12-0.9*(-lat-66) : -8-1.2*(lat-60);
          sheetMass += cap[i]*cosLat[r];
        }
      }
      else if (lake > seaN) {
        kind[i] = 1;
        depth[i] = 50;
        cap[i] = 0.05;
        inlandCount += cosLat[r];
      }
      else {
        initOceanColumn(i, r, seaN ? depthSum/seaN : 50);
        const lon = (q+.5)/res-180, c = currentAt(lon, lat);
        curU[i] = c[0];
        curV[i] = c[1];
        const system = systemOf(lon, lat);
        cellSystem[i] = system;
        if (system < 255) systemArea[system] += cosLat[r];
      }
      if (kind[i] !== 3 && !(grid[i] === 0 && kind[i] === 0)) T0[i] = 2+6*cosLat[r]*cosLat[r];
    }
  }
  // narrow straits vanish when the map is block-averaged; carve the ones that connect major seas
  const STRAITS = [[-5.6, 36], [26.3, 40.2], [29, 41.1], [43.3, 12.6], [56.5, 26.5], [12.7, 56], [10.8, 57.6], [103, 1.4], [-169, 65.8], [-80.5, 24.5], [-61, 10.5]];
  for (const [lon, lat] of STRAITS) {
    const q = Math.floor((lon+180)*res), r = Math.floor((90-lat)*res);
    const i = r*W+q;
    if (grid[i] === 1) {
      grid[i] = 0;
      initOceanColumn(i, r, 100);
      const c = currentAt(lon, lat);
      curU[i] = c[0];
      curV[i] = c[1];
      cellSystem[i] = 255;
    }
  }
  if (!riverBaseCells) {
    const cells = [];
    for (let i = 0; i < BW*BH; i++) if (base[i]&32) cells.push(i);
    riverBaseCells = Int32Array.from(cells);
  }
  buildWeights();
  buildShade();
  buildAirClimate(); // needs cosLat
  airT.set(airTclim);
  snowBuild(); // needs grid, kind and cosLat
  T.set(T0);
  Td.set(T0d);
  $('resV').textContent = 1/res+'° · '+N.toLocaleString()+' cells';
}
let frozen = 0, frozenMass = 0, inlandFrozen = 0, hours = 0, running = false, hotCount = 0, stalled = 0,
  airMean = TA0, phi;
// ===== controls and the satellite base image =====
const playBtn = $('play'), rateSlider = $('rate'), speedSlider = $('speed'), latentSlider = $('lat'), coolSlider = $('cool'), thermo = $('thermo'),
  solar = $('solar'), mixSlider = $('mix'), atmo = $('atmo'), airborne = $('airborne'), depthOn = $('depthOn'),
  resSel = $('res'), currents = $('currents'), showcur = $('showcur'), showair = $('showair'), showphi = $('showphi'), naturalCk = $('natural'),
  solidSlider = $('solid'), globeCk = $('globe'), satelliteCk = $('satellite'), floatsCk = $('floats'), snowCk = $('snowfall'), greenhouseCk = $('greenhouse'), cloudsCk = $('clouds'), lifeCk = $('life'), washSlider = $('wash'), loftSlider = $('loft'),
  threshSlider = $('thresh'), leadsSlider = $('leads');
// natural-colour relief base (NOAA ETOPO1), loaded once; drawn beneath the simulation in satellite mode
const satCanvas = document.createElement('canvas');
satCanvas.width = BW;
satCanvas.height = BH;
let satPixels = null;
const satImg = new Image();
satImg.onload = () => {
  const g = satCanvas.getContext('2d');
  g.drawImage(satImg, 0, 0, BW, BH);
  satPixels = g.getImageData(0, 0, BW, BH).data;
  if (base) draw();
};
satImg.src = 'data/satellite.jpg';
satelliteCk.addEventListener('change', draw);
for (const o of [...resSel.options]) if (+o.value > BR) o.remove(); // no grid finer than the base data
function solidRate() {return Math.pow(10, solidSlider.value/100*2.3);} // 1 … 200 m/h
const GROW = 0.5; // fraction of a column that can lock per hour once seeded
// floats mode: each ocean column is an HM-deep mixed layer (T, phi, cap: everything the front does) over a deep layer (Td, phid, capd) that exchanges heat with it only vertically.
// KV_L and KV_I are eddy diffusion through liquid (1e-4 m²/s) and conduction through the crust (1.2e-6 m²/s) across ~300 m, in column-capacity units per hour per kelvin. Both are deliberately tiny.
const OVERTURN_W = 0.02; // m/s: open-ocean convective plumes descend at a few cm/s (Marshall & Schott 1999: up to about 10 cm/s)
const HM = 100, KV_L = 1e-4/300*3600/3700, KV_I = 1.2e-6/300*3600/3700;
// the latent-heat and depth controls, cached when they change: latentK() and CAP() are called per cell in the hot loops, and a DOM read there is slow
let latentSet = 0, depthSet = false;
function readControls() {
  latentSet = thermo.checked ? +latentSlider.value : 0;
  depthSet = depthOn.checked;
}
readControls();
for (const [el, ev] of [[thermo, 'change'], [latentSlider, 'input'], [latentSlider, 'change'], [depthOn, 'change']]) el.addEventListener(ev, readControls); // registered before the other listeners, which read the cache
function useDepth() {return floatMode || depthSet;} // the two-layer column needs real capacities
// ===== derived constants (see agent_docs/physics.md for each derivation) =====
const SALT = 2.2, SALT_SAT = 16; // seawater melting-point depression at 45.8 °C (cryoscopic constant 2.17 K kg/mol); brine concentrates as 1/(1-phi) and saturates at about 7x seawater
const S0 = 35; // seawater salinity, g/kg. The solid excludes salt, so a layer's liquid has salinity s/(1-p) for bulk salinity s
function meltPt(p, s = S0) {return s > 0 ? MELT-Math.min(SALT_SAT, SALT*s/S0/Math.max(1e-6, 1-p)) : MELT;} // the depression is proportional to the liquid's salinity; beyond saturation salt precipitates and it stops growing; fresh water has none
function meltSlope(p, s = S0) { // -d(meltPt)/dp
  if (!(s > 0)) return 0;
  const d = SALT*s/S0/Math.max(1e-6, 1-p);
  return d < SALT_SAT ? d/Math.max(1e-6, 1-p) : 0;
}
// liquid density, kg/m³: UNESCO 1980 at atmospheric pressure, first-order salinity term; S is capped at saturation (about 260 g/kg), where the fit is an extrapolation but has the right sign and size
function rhoW(t, S) {
  S = Math.min(S, 260);
  return 999.842594+t*(6.793952e-2+t*(-9.09529e-3+t*(1.001685e-4+t*(-1.120083e-6+t*6.536332e-9))))+S*(0.824493+t*(-4.0899e-3+t*(7.6438e-5+t*(-8.2467e-7+t*5.3875e-9))))-5.72466e-3*S*Math.sqrt(S);
}
// the climatology a column's air-sea exchange is measured against: its own mean while it is stratified, today's surface once the lattice
// has mixed it (a seeded sinking column is slush top to bottom, so its surface is its mean). In floats mode the two are the same for the sea.
// Seeded lakes and rivers use the annual air climatology above them as their surface climatology.
function seaRef(i) {
  if (grid[i] !== 2) return T0[i];
  return kind[i] === 0 ? T0surf[i] : kind[i] === 3 ? T0[i] : airTannual[airCell[i]];
}
function salinityOf(i) {return kind[i] ? 0 : floatMode ? sal[i] : S0;} // inland water is fresh
function meltPtOpen(i) {return meltPt(0, salinityOf(i));} // melting point of a column with no solid yet: above it the lattice cannot take hold
// ===== map colours =====
// built in OKLab so the ramps are perceptually even; the legend swatches are generated from the same values
function oklabToRgb(lum, a, b) { // OKLab to sRGB bytes
  const l_ = lum+0.3963377774*a+0.2158037573*b, m_ = lum-0.1055613458*a-0.0638541728*b, s_ = lum-0.0894841775*a-1.291485548*b;
  const l = l_*l_*l_, m = m_*m_*m_, q = s_*s_*s_;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*q, -1.2684380046*l+2.6097574011*m-0.3413193965*q, -0.0041960863*l-0.7034186147*m+1.707614701*q]
    .map(v => {
      v = Math.max(0, Math.min(1, v));
      return Math.round(255*(v <= 0.0031308 ? 12.92*v : 1.055*Math.pow(v, 1/2.4)-0.055));
    });
}
function oklch(lightness, C, h) {return [lightness, C*Math.cos(h*Math.PI/180), C*Math.sin(h*Math.PI/180)];}
function rampLUT(stops, x0, x1, n) { // stops: [x, [L, a, b]], interpolated in OKLab into n entries over x0..x1
  const lut = new Uint8Array(n*3);
  for (let k = 0; k < n; k++) {
    const x = x0+(x1-x0)*k/(n-1);
    let j = 0;
    while (j < stops.length-2 && x > stops[j+1][0]) j++;
    const [xa, A] = stops[j], [xb, B] = stops[j+1], f = Math.max(0, Math.min(1, (x-xa)/(xb-xa)));
    const c = oklabToRgb(A[0]+(B[0]-A[0])*f, A[1]+(B[1]-A[1])*f, A[2]+(B[2]-A[2])*f);
    lut[k*3] = c[0];
    lut[k*3+1] = c[1];
    lut[k*3+2] = c[2];
  }
  return lut;
}
// temperature, water and air: lightness rises steadily from cold to warm and stays well below ice white; resolution is spent where the slush lives (25-44 °C)
const T_LO = -25, T_HI = 50, T_N = 751;
const TEMP_STOPS = [[-25, oklch(0.24, 0.07, 262)], [-2, oklch(0.33, 0.09, 255)], [8, oklch(0.44, 0.11, 240)], [18, oklch(0.54, 0.09, 200)],
  [28, oklch(0.62, 0.09, 105)], [36, oklch(0.69, 0.1, 80)], [43.6, oklch(0.75, 0.115, 62)], [50, oklch(0.82, 0.1, 75)]]; // chroma stays moderate at the warm end: the slush ocean is a large uniform field
const TLUT = rampLUT(TEMP_STOPS, T_LO, T_HI, T_N);
function tempLutIndex(t) {return Math.max(0, Math.min(T_N-1, Math.round((t-T_LO)*(T_N-1)/(T_HI-T_LO))))*3;}
const HOT = oklabToRgb(...oklch(0.56, 0.2, 27)); // above the melting point: outside the temperature scale on purpose
const ICE9 = oklabToRgb(...oklch(0.94, 0.045, 225)); // ice-nine: blue-white, as the novel describes it
const ICE = oklabToRgb(...oklch(0.86, 0.008, 250)); // ordinary ice: neutral
const ALGAE = oklabToRgb(...oklch(0.62, 0.11, 35)); // a bloom in the crust's brine: the reddish-brown of carotenoid-rich algae and halophilic mats
// natural colour (display option): the sea as seen from above, whatever its temperature. Display only, drawn for legibility, not the
// albedo the model uses: seeded sinking water takes a milky turquoise tint from crystals in suspension (inference, as for glacial silt),
// never white; floating ice gathers at the top, so the crust shows brighter than its solid fraction (square root of phi/NAT_FULL)
const SEA = oklabToRgb(...oklch(0.40, 0.085, 242));
const MILK = oklabToRgb(...oklch(0.66, 0.09, 195));
const NAT_FULL = 0.4; // solid fraction at which the tint, or the floating crust, reaches full strength
const MILK_MAX = 0.75; // the strongest milky tint, so a slush sea never reads as white ice
const CRUST_MAX = 0.88; // the floating crust stops short of snow white, so coastlines stay readable
const PLUT = rampLUT([[0, oklch(0.34, 0.11, 310)], [1, oklch(0.95, 0.03, 310)]], 0, 1, 101); // solid-fraction overlay: purple, off the water hues
const NIGHT = [0.62, 0.66, 0.78];
function css(c) {return 'rgb('+c[0]+','+c[1]+','+c[2]+')';}
function lutCss(lut, x0, x1, n, a, b, k) {
  const out = [];
  for (let j = 0; j <= k; j++) {
    const x = a+(b-a)*j/k, m = Math.round((x-x0)*(n-1)/(x1-x0))*3;
    out.push(css([lut[m], lut[m+1], lut[m+2]]));
  }
  return 'linear-gradient(90deg,'+out.join(',')+')';
}
let shade = null; // bathymetric relief shading per cell, zero-mean around 1
function buildShade() { // light from the north-west; slopes between columns brighten or darken without shifting a region's overall tone
  shade = new Float32Array(W*H).fill(1);
  const depthAt = i => (grid[i] === 1 || kind[i]) ? NaN : depth[i];
  for (let r = 1; r < H-1; r++) {
    for (let q = 0; q < W; q++) {
      const i = r*W+q;
      if (grid[i] === 1 || kind[i]) continue;
      const dHere = depth[i], east = depthAt(r*W+(q+1)%W), west = depthAt(r*W+(q+W-1)%W), north = depthAt(i-W), south = depthAt(i+W);
      const slope = ((east === east ? east : dHere)+(south === south ? south : dHere))-((west === west ? west : dHere)+(north === north ? north : dHere));
      shade[i] = 1+0.12*Math.tanh(slope*RES/6000);
    }
  }
}
// ===== air-sea exchange =====
const H_SENS = 10, H_LW = 5, H_LAT20 = 22; // bulk air-sea flux coefficients, W/m²/K: sensible, net longwave, latent at 20 °C (doubles every ~12 K by Clausius-Clapeyron)
function hLat(t) {return H_LAT20*Math.exp(0.06*(t-20));}
const KC = 3600/(4.18e6*3700); // per-hour relaxation rate of a reference column (3700 m of water, cap 1) per W/m²/K
// of a column's heat loss (tBefore-t), the share that went into the air: turbulent flux ht*(u-dTa) against the whole hx*(u-cp*dTa), with u the anomaly from climatology
function airShare(ht, hx, cp, u, dTa) {
  const tot = hx*(u-cp*dTa);
  return Math.abs(tot) > 1e-9 ? ht*(u-dTa)/tot : 0;
}
// convective cap: the sea is what heats the air, and over warm water moist convection couples the lower atmosphere to the sea surface, so the
// air's warming (from its seasonal climatology) may exceed the warming of the sea surface at its latitude by at most CONV_DT; the excess is
// carried aloft and spread over the whole air (airStep), so it must still leave by radiation. Measured as warming, so today's land-sea
// contrast (hot continental summers) is kept.
const CONV_DT = 3;
const rowSea = new Float64Array(AH); // mean sea-surface warming per air row, NaN where the row has no sea
// sunshine weight per air row: daily-mean insolation for the date against its global mean (the annual-mean profile when seasons are off),
// so a white square metre reflects what the sun puts on it; polar night reflects nothing
const sunW = new Float64Array(AH);
function updateSunWeights() {
  if (solar.checked) {
    updateDaylight();
    let s = 0, w = 0;
    for (let r = 0; r < AH; r++) {
      const c = airCos[r];
      s += dayFrac[r]*dayCos[r]*c;
      w += c;
    }
    const mean = s/w;
    for (let r = 0; r < AH; r++) sunW[r] = dayFrac[r]*dayCos[r]/mean;
  }
  else for (let r = 0; r < AH; r++) {
    const x = Math.sin((89.5-r)*Math.PI/180);
    sunW[r] = 1-0.482*(3*x*x-1)/2; // annual-mean insolation (North 1975), global mean 1
  }
}
let seaWhite = 0; // share of the ocean surface that is white ice-nine (the floating crust, or a sinking column frozen through, as drawn), weighted by what the clouds let through
function updateRowSea() {
  const stride = Math.max(1, RES>>1), crustWhite = 1-leadShare(); // leads are dark
  let wSum = 0, aSum = 0;
  for (let ra = 0; ra < AH; ra++) {
    let s = 0, n = 0;
    for (let r = ra*RES; r < (ra+1)*RES; r += stride) {
      const row0 = r*W, c = cosLat[r];
      for (let q = 0; q < W; q += stride) {
        const i = row0+q;
        if (grid[i] === 1 || kind[i]) continue;
        s += T[i]-seaRef(i); // the surface's warming: a stratified sinking column's anomaly, a mixed column's departure from today's surface
        n++;
        wSum += c*(floatMode ? Math.min(phi[i], crustWhite) : Math.max(0, (phi[i]-0.9)*10))*cloudMask(cloud[airCell[i]])*sunW[ra]*(lifeCk.checked ? 1-BIO_DARK*bloom[i] : 1); // as seen from space
        aSum += c;
      }
    }
    rowSea[ra] = n ? s/n : NaN;
  }
  seaWhite = aSum ? wSum/aSum : 0;
}
const C_AIR = 1e7; // J/m²/K, heat capacity of the air column
const AIR_C = C_AIR/(4.18e6*3700); // the same as a share of the reference ocean column: 1/1550
// outgoing longwave radiation against air temperature (K): the Planck response LAMBDA_P*(T/288)³ less a water-vapour (and lapse-rate) feedback
// that is LAMBDA_WV today and grows as the air holds more vapour, so the net slope falls to zero near 330 K, where the outgoing radiation of a
// saturated atmosphere approaches its limit (the runaway threshold). Without the greenhouse the slope is the Planck response alone.
// Clouds add the net cloud feedback LAMBDA_C (AR6 central estimate) to the slope.
const LAMBDA_P = 3.3, LAMBDA_WV = 1.3, TAU_WV = 31, LAMBDA_C = 0.42;
let olrOut = 0, olrSlopeOut = 0; // olrBoth(): the radiation and its slope from one exp
function olrBoth(tC, gh, cl) {
  const T = tC+273.15, ex = gh ? Math.exp((T-288)/TAU_WV) : 0;
  olrOut = LAMBDA_P*72*(T/288)**4-(gh ? LAMBDA_WV*TAU_WV*ex : 0)-(cl ? LAMBDA_C*(T-288) : 0);
  olrSlopeOut = LAMBDA_P*(T/288)**3-(gh ? LAMBDA_WV*ex : 0)-(cl ? LAMBDA_C : 0);
}
// today's radiation at each air cell's climatology: recomputed only when the season moves (setAirSeason) or the greenhouse or clouds are switched
const olrClim = new Float64Array(AN);
let olrClimOk = false, olrClimGh = false, olrClimCl = false;
function olr(tC, gh, cl) {
  const T = tC+273.15;
  return LAMBDA_P*72*(T/288)**4-(gh ? LAMBDA_WV*TAU_WV*Math.exp((T-288)/TAU_WV) : 0)-(cl ? LAMBDA_C*(T-288) : 0); // 72 = 288/4: the integral of the Planck slope
}
function olrSlope(tC, gh, cl) {
  const T = tC+273.15;
  return LAMBDA_P*(T/288)**3-(gh ? LAMBDA_WV*Math.exp((T-288)/TAU_WV) : 0)-(cl ? LAMBDA_C : 0);
}
// clouds hide the surface: a white surface under cloud adds less to the planet's reflection. The surface's share is the clear sky plus the
// sunlight that gets through cloud (CLOUD_T); at today's cover CLOUD0 that halves the effect of a surface albedo change, as observed.
// F_ALB is measured with today's clouds, so the share enters as a ratio to today's. Cover follows the vapour the air holds against today's.
const CLOUD0 = 0.67, CLOUD_MAX = 0.9, CLOUD_T = 0.3;
function cloudMask(c) {return ((1-c)+c*CLOUD_T)/((1-CLOUD0)+CLOUD0*CLOUD_T);}
const F_ALB = 102; // W/m² of sunlight reflected when the whole ocean is white: planetary albedo 0.3 to 0.6 of 340 W/m²
// ===== ice-nine snowfall on land =====
// rain that falls through crystal-laden air freezes where it lands (derivations in agent_docs/physics.md)
const E0 = 88; // W/m², present ocean-mean latent heat flux (413,000 km³/yr of evaporation)
const SNOW_MASK = 0.02; // m water equivalent that hides the ground
const LAND_ALB = 0.74; // white land's albedo gain (0.25 to 0.8) relative to white ocean's (0.06 to 0.8)
// The three crystal parameters are uncertain (a sensitivity sweep moved year-one land cover from 95% to below 20%), so each has a slider; the
// defaults sit at the middle of the slider. Values below are the defaults.
let CRY_MIN = 1e-4; // crystal level (share of that over seeded water) above which all rain freezes: one crystal freezes a drop, and frozen drops freeze the ones they hit
let CRY_UP = 1/24, CRY_OUT = 1/168; // per hour: spray lofts crystals over seeded water within a day; rain washes them out in a week
const RAIN_EVERY = 72; // h between rain events on land at today's precipitation
const TAU_V = 9*24; // h, residence time of water vapour: 25 mm of precipitable water over 2.7 mm/day of rain
const CAP_J = 4.18e6*3700; // J/m²/K of a cap-1 column
const G_SUN = 10; // K: bare ground in daylight runs this far above the air, at the equator at equinox (dry ground at noon: 15-25 K; averaged over daylight hours); snow cover shields it in proportion to its whiteness
// daily sunshine per air row: the daylight fraction and the mean cos(zenith) over the daylight hours, from the date's declination (equinox when seasons are off)
const dayFrac = new Float64Array(AH), dayCos = new Float64Array(AH);
function updateDaylight() {
  const doy = START_DOY+(START_HOUR+hours)/24, decl = solar.checked ? 23.44*Math.PI/180*Math.sin(2*Math.PI*(doy-81)/365) : 0;
  for (let r = 0; r < AH; r++) {
    const lat = (89.5-r)*Math.PI/180, x = -Math.tan(lat)*Math.tan(decl), h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
    const q = (h0*Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)*Math.sin(h0))/Math.PI; // daily-mean cos(zenith)
    dayFrac[r] = h0/Math.PI;
    dayCos[r] = h0 > 0 ? q/dayFrac[r] : 0;
  }
}
// ===== life in the brine (option) =====
// The brine left in a floating crust is liquid at its own melting point, as in the brine channels of ordinary sea ice, where algae live;
// cells isotonic with that brine are not supercooled, so the crystals around them need not freeze them (an inference, not an observation).
// Candidates: halotolerant, moderately thermophilic cyanobacteria (Halothece / Aphanothece halophytica grows up to NaCl saturation) and
// Dunaliella salina (grows to saturation, above 40 °C). A bloom darkens the crust it lives in; ice-nine snow on land holds no liquid water
// below 45.8 °C, and a sinking ocean's surface is open slush, so neither changes.
const BIO_DARK = 0.13; // share of the white surface's extra reflection a full bloom removes: red snow algae on Arctic glaciers, one season (local ice-algae blooms: 3-43%)
const BIO_GROW = 0.3/24, BIO_DIE = 0.05/24, BIO_SEED = 0.01; // per hour: doubling in about 2.3 days with light and brine; decay in about 3 weeks without; seed population from the plankton
const BIO_TMIN = -15, BIO_TMAX = 45; // brine temperatures with known photosynthesis: sea-ice algae near -15 °C; moderately thermophilic halotolerant cyanobacteria to about 45 °C (upper end approximate)
function lifeStep(h) {
  updateDaylight();
  const N = W*H;
  for (let i = 0; i < N; i++) {
    if (grid[i] === 1 || kind[i]) continue;
    let b = bloom[i];
    const p = phi[i], ra = ((i/W)|0)/RES|0;
    if (floatMode && p > 0.02 && p < 0.999 && T[i] > BIO_TMIN && T[i] < BIO_TMAX && dayFrac[ra] > 0) {
      if (b < BIO_SEED) b = BIO_SEED;
      b += BIO_GROW*h*b*(1-b);
    }
    else if (b > 0) b -= BIO_DIE*h*b;
    bloom[i] = Math.max(0, Math.min(1, b));
  }
}
function snowBuild() {
  const N = W*H, lands = [], inlands = [];
  seaCells.fill(0);
  landArea = 0;
  for (let i = 0; i < N; i++) {
    const kindI = kind[i];
    if ((grid[i] === 1 && kindI === 0) || kindI === 2) { // land, and the land around a river channel
      lands.push(i);
      landArea += AREA(i);
    }
    if (kindI === 1 || kindI === 2) inlands.push(i);
    if (grid[i] !== 1 && kindI === 0) seaCells[airCell[i]]++;
  }
  landList = Int32Array.from(lands);
  inlandList = Int32Array.from(inlands);
  snow = new Float32Array(N);
  spinVapourToday();
  snowClear();
}
// today's vapour: spin the reference field up to steady state under today's evaporation and the current air transport
function spinVapourToday() {
  const cellsPerAir = RES*RES, stepH = 12, keep = 1/(1+stepH/TAU_V);
  vapourToday.fill(0);
  for (let k = 0; k < 100; k++) { // 50 days, five residence times
    for (let a = 0; a < AN; a++) vapourToday[a] = (vapourToday[a]+E0*seaCells[a]/cellsPerAir*stepH)*keep;
    transportAir(stepH, vapourToday);
  }
  let total = 0;
  for (let a = 0; a < AN; a++) total += vapourToday[a];
  vapourEps = 0.01*total/AN; // keeps the ratio finite over the driest interiors
}
function snowClear() {
  if (snow) snow.fill(0);
  crystals.fill(0);
  vapour.set(vapourToday);
  landRain.set(landPrecip);
  evapAnom.fill(0);
  landWhite = 0;
  landWhiteSeen = 0;
  cloud.fill(CLOUD0);
  snowVol = 0;
  rainRatio = 1;
}
// water vapour, rain and clouds (always, with the atmosphere), and the crystals (with snowfall)
function vapourStep(h) {
  // crystals: lofted from seeded water, carried with the air (airStep), washed out by rain
  const snowOn = snowCk.checked, cloudsOn = cloudsCk.checked, lead = leadShare();
  crystalSrc.fill(0);
  seaCovered.fill(0);
  for (let k = 0; k < frozenN; k++) {
    const i = frozenList[k];
    if (grid[i] === 2 && kind[i] === 0) {
      const a = airCell[i];
      const open = leadOpen(i, lead);
      crystalSrc[a] += open; // spray comes off open water, slush and leads, not a closed crust
      seaCovered[a] += 1-open;
    }
  }
  // water vapour: each air cell gets today's evaporation from its open sea plus the anomalous latent flux of this tick, and rains out on TAU_V;
  // the reference field (today's evaporation from all sea, spun up in snowBuild) does not change. Extra vapour rains out as extra rain on top of today's map, so the extra
  // evaporation falls somewhere (water is conserved); air drier than today's rains less in proportion
  const cellsPerAir = RES*RES, keep = 1/(1+h/TAU_V), wattsPerCap = CAP_J/(h*3600), liftFrac = 1-Math.exp(-h*CRY_UP), rainPerVapour = 3600/2.45e9/TAU_V;
  for (let a = 0; a < AN; a++) {
    const src = Math.max(0, E0*(seaCells[a]-seaCovered[a])+evapAnom[a]*wattsPerCap)/cellsPerAir;
    vapour[a] = (vapour[a]+src*h)*keep;
    // the latent heat of the anomalous evaporation travels with the air (latentAir, W·h/m²) and is released where the vapour rains out, on the same timescale
    const lt = latentAir[a]+evapAnom[a]*wattsPerCap/cellsPerAir*h, lk = lt*keep;
    airIn[a] += (lt-lk)*3600*cellsPerAir/CAP_J;
    latentAir[a] = lk;
    const excess = vapour[a]-vapourToday[a], vapRatio = (vapour[a]+vapourEps)/(vapourToday[a]+vapourEps);
    landRain[a] = excess >= 0 ? landPrecip[a]+excess*rainPerVapour : landPrecip[a]*vapRatio; // W·h/m² of vapour over TAU_V and the latent heat of vaporisation: m of rain per hour
    cloud[a] = cloudsOn ? CLOUD_MAX-(CLOUD_MAX-CLOUD0)*Math.exp(-(vapRatio-1)) : CLOUD0; // today's cover where the air holds today's vapour
    if (snowOn) {
      let cr = crystals[a];
      if (crystalSrc[a] > 0) cr += (1-cr)*liftFrac*Math.min(1, crystalSrc[a]/seaCells[a]);
      crystals[a] = cr*Math.exp(-h*CRY_OUT*Math.max(1, vapRatio)); // rain washes crystals out
    }
  }
  evapAnom.fill(0);
}
function snowStep(h) {
  const latJ = latentK()*4180, meltPerK = 15*h*3600/(1000*(latJ || 389e3)), cellArea = (111.2e3/RES)**2, cosEq = 2/Math.PI; // daylight-mean cos(zenith) at the equator at equinox
  updateDaylight();
  let whiteArea = 0, whiteSeen = 0, snowWater = 0, rainSum = 0, rainTodaySum = 0;
  for (let k = 0; k < landList.length; k++) {
    const i = landList[k], r = (i/W)|0, a = airCell[i], airTa = airT[a];
    let swe = snow[i];
    rainSum += landRain[a]*cosLat[r];
    rainTodaySum += landPrecip[a]*cosLat[r];
    if (airTa < MELT) { // rain freezes on the crystals it carries
      const deposit = landRain[a]*h*Math.min(1, crystals[a]/CRY_MIN);
      swe += deposit;
      airIn[a] += deposit*1000*latJ/CAP_J;
    }
    if (swe > 0) { // warm air melts it back all day; sunlit ground, which the snow shields as it whitens, melts it in daylight
      const ra = (a/AW)|0, ground = airTa+G_SUN*dayCos[ra]/cosEq*(1-Math.min(1, swe/SNOW_MASK));
      const excess = Math.max(0, airTa-MELT)+Math.max(0, ground-Math.max(airTa, MELT))*dayFrac[ra];
      if (excess > 0) {
        const melted = Math.min(swe, excess*meltPerK);
        swe -= melted;
        airIn[a] -= melted*1000*latJ/CAP_J; // the melt heat comes out of the air, which the sunlit ground would otherwise have warmed
      }
    }
    snow[i] = swe;
    if (swe > 0) {
      const wa = Math.min(1, swe/SNOW_MASK)*cosLat[r];
      whiteArea += wa;
      whiteSeen += wa*cloudMask(cloud[a])*sunW[(a/AW)|0]; // as seen from space, through the clouds, weighted by the sunshine on it
      snowWater += swe*cosLat[r];
    }
  }
  landWhite = whiteArea;
  landWhiteSeen = whiteSeen;
  snowVol = snowWater*cellArea;
  rainRatio = rainTodaySum ? rainSum/rainTodaySum : 1; // land rain against today's, for the readout
  // rain carrying crystals seeds lakes and rivers it falls on
  for (let k = 0; k < inlandList.length; k++) {
    const i = inlandList[k];
    if (grid[i] !== 0) continue;
    const a = airCell[i], frozenShare = Math.min(1, crystals[a]/CRY_MIN);
    if (frozenShare > 0 && airT[a] < MELT && T[i] < meltPtOpen(i) && Math.random() < 1-Math.exp(-h*landRain[a]/Math.max(landPrecip[a], 1e-8)*frozenShare/RAIN_EVERY)) seedCell(i);
  }
  // and the open sea: the same rule, with the rain against today's from the vapour the air holds
  for (let i = 0; i < W*H; i++) {
    if (grid[i] !== 0 || kind[i]) continue;
    const a = airCell[i], frozenShare = Math.min(1, crystals[a]/CRY_MIN);
    if (frozenShare <= 0 || airT[a] >= MELT || T[i] >= meltPtOpen(i)) continue;
    const ratio = (vapour[a]+vapourEps)/(vapourToday[a]+vapourEps);
    if (Math.random() < 1-Math.exp(-h*ratio*frozenShare/RAIN_EVERY)) seedCell(i);
  }
}
const KH = 1e3*3600/(1.11e5*1.11e5); // lateral eddy diffusivity 1e3 m²/s as a per-hour exchange fraction between 1° cells: 3e-7, nothing
const A_WIND = 0.006; // wind-driven surface drift, 3% of a 7 m/s wind, in 1° cells per hour
// ===== seasonal sea ice and small helpers =====
// seasonal sea ice: Arctic edge swings between ~64°N (March) and ~76°N (September), Antarctic between ~60°S (September) and ~70°S (March)
// The edge follows the ocean, not the parallels: the Barents and Norwegian seas stay open under the North Atlantic Drift while Hudson Bay, the Okhotsk and Bering seas freeze far south; the Weddell Sea pushes the Antarctic edge north.
let seasonN = 0, seasonS = 0;
function seaIceEdges() {
  const doy = START_DOY+(START_HOUR+hours)/24;
  seasonN = Math.cos(2*Math.PI*(doy-75)/365);
  seasonS = Math.cos(2*Math.PI*(doy-258)/365);
  const day = Math.floor(doy);
  if (day !== seaIceDay) {
    seaIceDay = day;
    const r45 = Math.floor(45*RES);
    for (let r = 0; r < H; r++) {
      if (r >= r45 && r < H-r45) continue;
      const o = r*W;
      for (let q = 0; q < W; q++) seaIceCover[o+q] = seaIceAt(o+q);
    }
  }
} // +1 at each pole's maximum extent
function lobe(lon, c, w) {
  let d = lon-c;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d) < w ? Math.cos(Math.PI*d/(2*w)) : 0;
}
function edgeN(lon) {
  let e = 72-5*seasonN; // base: 67°N at the March maximum, 77°N in September
  e += 8*lobe(lon, 25, 40)+3*lobe(lon, -20, 15); // Barents / Norwegian / Greenland seas open
  e -= (14+2*seasonN)*lobe(lon, -83, 13); // Hudson Bay
  e -= (8+6*seasonN)*lobe(lon, 148, 15); // Sea of Okhotsk
  e -= (5+9*seasonN)*lobe(lon, -172, 14); // Bering Sea
  e -= (4+4*seasonN)*lobe(lon, -55, 12); // Labrador Sea / Baffin Bay
  e -= 3*lobe(lon, 100, 40); // Siberian shelf seas
  return e;
}
function edgeS(lon) {
  let e = -66+5*seasonS; // base: 61°S at the September maximum, 71°S in March
  e += (4+2*seasonS)*lobe(lon, -40, 30); // Weddell Sea
  e += 2*seasonS*lobe(lon, -170, 30); // Ross Sea
  e -= 3*lobe(lon, 80, 40); // Indian sector
  return e;
}
function poisson(m) {
  if (m > 30) return Math.max(0, Math.round(m+Math.sqrt(m)*Math.sqrt(-2*Math.log(1-Math.random()))*Math.cos(2*Math.PI*Math.random())));
  const expM = Math.exp(-m);
  let k = 0, p = Math.random();
  while (p > expM) {
    k++;
    p *= Math.random();
  }
  return k;
}
function hash(x, y) {
  let n = (x*374761393+y*668265263)|0;
  n = (n^(n>>>13))*1274126177;
  return ((n^(n>>>16))>>>0)/4294967296;
}
function seaIceAt(i) {
  const r = (i/W)|0, q = i-r*W, lat = 90-(r+.5)/RES, lon = (q+.5)/RES-180;
  let m;
  if (lat > 45) m = lat-edgeN(lon);
  else if (lat < -45) m = edgeS(lon)-lat;
  else return 0;
  if (m < -3) return 0;
  const pq = Math.floor(q/RES), pr = Math.floor(r/RES), tex = 0.6*hash(pq>>1, pr>>1)+0.4*hash(pq, pr); // patchy floes in the marginal zone
  const c = Math.max(0, Math.min(1, (m+3)/6+(tex-0.5)*0.9));
  return c < 0.08 ? 0 : c;
}
function hoursPerFrame() {return Math.pow(10, speedSlider.value/100*2.68-1);}
function CAP(i) {return useDepth() ? cap[i] : 1;}
// ===== run state: reset, latent heat, seeding, sunlight =====
function reset() {
  for (let i = 0; i < grid.length; i++) if (grid[i] === 2) grid[i] = 0;
  latentAir.fill(0);
  phi.fill(0);
  phid.fill(0);
  bloom.fill(0);
  sal.set(sal0);
  sald.fill(S0);
  systemFlow.fill(1);
  T.set(T0);
  Td.set(T0d);
  histReset();
  drawSparks();
  frozen = 0;
  frozenMass = 0;
  inlandFrozen = 0;
  sheetFrozen = 0;
  frozenN = 0;
  hours = 0;
  budget.sea = budget.air = budget.vent = budget.season = 0;
  setAirSeason(false); // today's date: the air starts on its seasonal climatology
  airT.set(airTclim);
  snowClear();
  running = false;
  stalled = 0;
  airMean = TA0;
  seaIceDay = -1;
  seaIceEdges();
  playBtn.textContent = 'Start';
  setStatus('Waiting for a seed', '');
  draw();
  stats();
}
function latentK() {return latentSet;}
function latentPerPhi(i) {
  return latentK()*(1-2*seaIceCover[i]/Math.max(2, floatMode ? Math.min(depth[i], HM) : depth[i]));
} // latent heat released per unit solid fraction, less the share that was ordinary sea ice already
// Solid ice-nine holds half the heat per degree that water does, so the latent heat depends on the temperature of freezing (Kirchhoff):
// l(T) = l - 0.5*(MELT - T) per unit solid fraction, with l measured at MELT. A column's enthalpy per unit capacity is then
// H = (1 - phi/2)*T - phi*(l - MELT/2), which every freeze or melt increment conserves exactly (latentStep).
function warmingPerPhi(p, qs, t) {return Math.max(1, qs-0.5*(MELT-t))/(1-0.5*p);} // warming per unit solid fraction at (p, t), given qs = latentPerPhi(i)
function latentStep(t, p, dphi, q) {return ((1-0.5*p)*t+dphi*(q-0.5*MELT))/(1-0.5*(p+dphi));} // the temperature after freezing dphi (melting if negative) at constant enthalpy
// change a column's solid fraction by dphi; all latent heat stays in the column (lateral eddy mixing over tens of kilometres is nil on these timescales). The air is warmed only through the sea surface.
function addPhi(i, dphi) {
  phi[i] += dphi;
  const da = dphi*AREA(i);
  if (kind[i] === 3) {sheetFrozen += da*CAP(i);} else if (kind[i]) {inlandFrozen += da;} else {
    frozen += da;
    frozenMass += da*CAP(i);
  }
  const l = latentK();
  if (!l) return;
  if (kind[i] === 3) {
    T[i] += 2*Math.max(0, l-80)*dphi;
    return;
  } // ice sheet: only the difference between the two latent heats is released, it all stays in the column, and ice warms twice as much per joule as water
  T[i] = latentStep(T[i], phi[i]-dphi, dphi, latentPerPhi(i));
} // exact at constant enthalpy, so a freeze and the melt that undoes it cancel
function seedCell(i) {
  grid[i] = 2;
  addPhi(i, 0.02);
  if (frozenN >= frozenList.length) {
    const f = new Int32Array(frozenList.length*2);
    f.set(frozenList);
    frozenList = f;
  }
  frozenList[frozenN++] = i;
} // frozenList holds every seeded cell; step drops the ones that melted out
function seed(q, r) {
  const i = r*W+q;
  if (grid[i] === 1) {
    flash('That is land. Drop it in water.');
    return;
  }
  if (grid[i] === 2) return;
  if (thermo.checked && T[i] >= meltPtOpen(i)) {
    flash('Too hot here: above its melting point, '+meltPtOpen(i).toFixed(1)+' °C');
    return;
  }
  seedCell(i);
  setStatus('Lattice propagating', 'on');
  stats();
  draw();
}
function updateSun() {
  const dayOfYear = START_DOY+(START_HOUR+hours)/24, utcHour = (START_HOUR+hours)%24;
  const decl = 23.44*Math.PI/180*Math.sin(2*Math.PI*(dayOfYear-81)/365), cosDecl = Math.cos(decl), sinDecl = Math.sin(decl);
  const cosHour = new Float32Array(W);
  for (let q = 0; q < W; q++) {
    const lon = (q+.5)/RES-180;
    cosHour[q] = Math.cos(((utcHour+lon/15)-12)*15*Math.PI/180);
  }
  for (let r = 0; r < H; r++) {
    const cosTerm = cosLat[r]*cosDecl, sinTerm = sinLat[r]*sinDecl, row0 = r*W;
    for (let q = 0; q < W; q++) {
      const sinElev = cosTerm*cosHour[q]+sinTerm;
      insolation[row0+q] = sinElev > 0 ? sinElev : 0;
      night[row0+q] = sinElev <= 0 ? 1 : 0;
    }
  }
  return Math.sin(2*Math.PI*(dayOfYear-80)/365);
}
// ===== the front: contact propagation and the floats-mode deep layer =====
let front = new Int32Array(0), frontN = 0;
function pushFront(i) {
  if (frontN >= front.length) {
    const f = new Int32Array(Math.max(1024, front.length*2));
    f.set(front);
    front = f;
  }
  front[frontN++] = i;
}
let probLiquid, probSolid, probBasal; // per-row contact probabilities for liquid, solid-state and basal spread, 3 per target row: north-south, east-west, diagonal
function rowProbs(out, p) {
  for (let r = 0; r < H; r++) {
    const cosR = Math.max(1e-3, cosLat[r]), idx = r*3;
    out[idx] = p;
    out[idx+1] = 1-Math.pow(1-p, 1/cosR);
    out[idx+2] = 1-Math.pow(1-p, 1/Math.sqrt(1+cosR*cosR));
  }
} // an east-west neighbour is cos(lat) as far away, a diagonal one sqrt(1+cos²)
function tryIce(i, n, thermoOn, probIdx) { // into an ice sheet: through basal water at a third of the liquid rate where the bed is wet, else by solid-state transformation
  const prob = (kind[i] === 3 && !wetBed[i]) ? probSolid[probIdx] : (wetBed[n] || kind[i] !== 3) ? probBasal[probIdx] : probSolid[probIdx];
  return Math.random() < prob && (!thermoOn || T[n] < MELT);
}
// floats mode, the deep layer under a seeded column: slow vertical exchange, brine-driven overturn, and freezing against the crystals once the mixed layer is solid or the column overturns. All of the deep layer's latent heat stays in it.
function deepStep(i, growMax, latK, h) {
  const capDeep = capd[i], area = AREA(i), heatMix = cap[i]*(1-0.5*phi[i]), heatDeep = capDeep*(1-0.5*phid[i]);
  const kvH = (KV_L*(1-phi[i])+KV_I*phi[i])*h, flux = kvH*(T[i]-Td[i])/(1+kvH*(1/heatMix+1/heatDeep));
  T[i] -= flux/heatMix;
  Td[i] += flux/heatDeep; // implicit, so it can only move the two toward each other
  // convective overturn: if the mixed layer's liquid (warmed by latent heat, salted by the brine the crust rejects) is denser than the deep liquid, the two mix
  // at the rate convective plumes cross the column (OVERTURN_W, so a 4 km column mixes in about 2.3 days, whatever the time step); heat mixes over both layers,
  // salt over their liquid. While a column overturns, deep water reaches the crystals and the deep layer can freeze before the crust is complete.
  let overturned = false;
  const liqMix = 1-phi[i], liqDeep = 1-phid[i];
  const contactF = 1-Math.exp(-h*3600*OVERTURN_W/depth[i]); // the share of the deep layer that reaches the crystals this step (overturn, or convection under a solid crust)
  if (liqMix > 1e-3 && liqDeep > 1e-3 && rhoW(T[i], sal[i]/liqMix) > rhoW(Td[i], sald[i]/liqDeep)) {
    overturned = true;
    overturnMass += area*capDeep;
    const mixF = contactF; // share of the way to full mixing this step; conserves heat and salt
    const Tmix = (T[i]*heatMix+Td[i]*heatDeep)/(heatMix+heatDeep);
    T[i] += mixF*(Tmix-T[i]);
    Td[i] += mixF*(Tmix-Td[i]);
    const liqSal = (sal[i]*cap[i]+sald[i]*capDeep)/(cap[i]*liqMix+capDeep*liqDeep);
    sal[i] += mixF*(liqSal*liqMix-sal[i]);
    sald[i] += mixF*(liqSal*liqDeep-sald[i]);
  }
  if (phi[i] < 1 && !overturned) return;
  // as in the surface step: increments of at most 0.1 sized to land on the moving melting point, applied with the midpoint heat capacity
  const salt = sald[i];
  let left = Math.min(growMax, contactF*(1-phid[i])); // freezing only the water that has reached the crystals, so the deep layer approaches its stall at the contact rate, whatever the step
  for (let k = 0; k < 20; k++) {
    const p = phid[i], meltP = meltPt(p, salt), slope = meltSlope(p, salt), warmPer = warmingPerPhi(p, latK, Td[i]);
    if (Td[i] < meltP) {
      if (left <= 1e-6) break;
      const dPhi = Math.min(1-p, left, 0.1, (meltP-Td[i])/(warmPer+slope));
      if (dPhi <= 1e-6) break;
      phid[i] += dPhi;
      Td[i] = latentStep(Td[i], p, dPhi, latK);
      frozenMass += dPhi*capDeep*area;
      left -= dPhi;
    }
    else {
      const dPhi = Math.min(p, 0.1, (Td[i]-meltP)/(warmPer+slope));
      if (dPhi <= 1e-6) break;
      phid[i] -= dPhi;
      Td[i] = latentStep(Td[i], p, -dPhi, latK);
      frozenMass -= dPhi*capDeep*area;
    }
  }
}
// floats mode, leads: where the crust covers more than 1-lead, the missing open share exposes the deep layer's liquid (at its melting point under a
// closed crust) to the air at the bulk rates of the surface step, toward the same air-shifted target; the turbulent part goes to the air (sensible
// to airIn, latent with the vapour), the longwave part leaves directly. The deep layer then freezes against the crystals (deepStep). Leads only shed
// heat. Runs after the heat loop on every substep, since airIn is cleared at its start.
function leadStep(h, lead) {
  for (let k = 0; k < frozenN; k++) {
    const i = frozenList[k];
    if (grid[i] !== 2 || kind[i] !== 0 || !(capd[i] > 0) || phid[i] >= 0.999) continue;
    const f = lead-(1-phi[i]);
    if (f <= 0) continue;
    const r = (i/W)|0, a = airCell[i], dTa = airT[a]-airTclim[a], t0 = Td[i];
    const ht = H_SENS+hLat(t0), hx = ht+H_LW, cp = ht/hx, ref = seaRef(i), seasonSea = 3*sinLat[r]*season;
    const heatDeep = capd[i]*(1-0.5*phid[i]), target = ref+cp*dTa+seasonSea;
    const t = target+(t0-target)*Math.exp(-f*hx*KC*h/heatDeep);
    if (t >= t0) continue;
    const lost = (t0-t)*heatDeep, v = lost*airShare(ht, hx, cp, t0-ref-seasonSea, dTa);
    Td[i] = t;
    airIn[a] += v*H_SENS/ht;
    evapAnom[a] += v*(ht-H_SENS)/ht;
    budget.sea += (lost-v)*cosLat[r];
  }
}
function trySeed(i, n, thermoOn, probIdx) {
  if (grid[n] === 0 && (kind[n] === 3 ? tryIce(i, n, thermoOn, probIdx) : (!thermoOn || T[n] < meltPtOpen(n)) && Math.random() < probLiquid[probIdx])) {
    seedCell(n);
    pushFront(n);
  }
}
function propagate(thermoOn) {
  const frontEnd = frontN; // the per-row probabilities keep the front round in kilometres; any crystal at the surface can seed its neighbours, however little of the column has locked
  for (let k = 0; k < frontEnd; k++) {
    const i = front[k];
    if (phi[i] <= 0) continue;
    const r = (i/W)|0, q = i-r*W, qEast = (q+1)%W, qWest = (q+W-1)%W, row0 = r*W, probRow = r*3;
    trySeed(i, qEast+row0, thermoOn, probRow+1);
    trySeed(i, qWest+row0, thermoOn, probRow+1);
    if (r > 0) {
      const rowTo = row0-W, probTo = probRow-3;
      trySeed(i, q+rowTo, thermoOn, probTo);
      trySeed(i, qEast+rowTo, thermoOn, probTo+2);
      trySeed(i, qWest+rowTo, thermoOn, probTo+2);
    }
    if (r < H-1) {
      const rowTo = row0+W, probTo = probRow+3;
      trySeed(i, q+rowTo, thermoOn, probTo);
      trySeed(i, qEast+rowTo, thermoOn, probTo+2);
      trySeed(i, qWest+rowTo, thermoOn, probTo+2);
    }
  }
}
// ===== time stepping =====
function tick() {
  overturnMass = 0;
  const h = hoursPerFrame();
  const Dcond = KH*RES;
  const nSub = Math.min(16, Math.ceil(Math.max(h/12, h*RES*Dcond/0.45))), subH = h/nSub, before = frozenMass; // substeps of at most 12 h: the air responds to the sea on a 29 h timescale
  season = solar.checked ? updateSun() : 0;
  seaIceEdges();
  updateSystems(); // once per tick, not per substep
  updateSunWeights();
  if (lifeCk.checked) lifeStep(h);
  updateRowSea();
  setAirSeason(true);
  for (let s = 0; s < nSub; s++) step(subH, s === nSub-1 ? nSub : 0);
  overturnMass /= nSub; // deepStep tallies every substep; the readout is the share overturning, averaged over the tick
  if (thermo.checked) ewConduct(nSub*Math.min(0.45, Dcond*subH*RES)); // implicit, so once per tick with the substeps' summed coefficient
  if (Math.abs(frozenMass-before) < 1e-6) stalled += h;
  else stalled = 0;
  const thermoOn = thermo.checked;
  if (frozenMass >= massTotal*0.999) {
    running = false;
    playBtn.textContent = 'Start';
    setStatus('Every ocean is solid', 'done');
  }
  else if (floatMode && frozen >= waterCount*0.99) setStatus('Crust over a liquid deep ocean', 'hot');
  else if (thermoOn && stalled > 48) setStatus('Front held back by its own heat', 'hot');
  else if (!thermoOn && stalled > 3 && frozen > 0) {
    running = false;
    playBtn.textContent = 'Start';
    setStatus('Spread halted', 'done');
  }
  else if (frozen > 0) setStatus('Lattice propagating', 'on');
}
function step(h, last) { // last: the substep count on the tick's final substep, else 0
  const thermoOn = thermo.checked, solarOn = solar.checked, atmoOn = atmo.checked && thermoOn, airborneOn = airborne.checked, useCap = useDepth();
  const N = W*H, pContact = Math.min(0.95, frontKmh()/111/(3.6*Math.pow(RES, 0.15))), latK = latentK(); // contact probability per hour per 1° cell, calibrated so the realised front (several neighbours trying at once, diagonals included) runs at the chosen speed
  // 1. contact propagation from the active front, in substeps so the front's speed in km/h is independent of the time step
  frontN = 0;
  let kept = 0;
  for (let k = 0; k < frozenN; k++) {
    const i = frozenList[k];
    if (grid[i] !== 2) continue;
    grid[i] = 4;
    frozenList[kept++] = i;
  } // drop melted cells; the temporary 4 drops duplicates (a cell melted and re-seeded between steps)
  frozenN = kept;
  const seededN = kept;
  for (let k = 0; k < kept; k++) {
    const i = frozenList[k];
    grid[i] = 2;
  }
  for (let k = 0; k < kept; k++) {
    const i = frozenList[k], r = (i/W)|0, q = i-r*W;
    if (grid[q === W-1 ? i-q : i+1] === 0 || grid[q === 0 ? i+W-1 : i-1] === 0 || (r > 0 && grid[i-W] === 0) || (r < H-1 && grid[i+W] === 0)) pushFront(i);
  }
  const frontStart = frontN;
  const cellsPerStep = h*RES, passes = Math.max(1, Math.ceil(cellsPerStep*pContact/0.1)), pPass = 1-Math.pow(1-pContact, cellsPerStep/passes); // small per-substep probability keeps the stochastic front identical at any time step
  const cellMetres = 111000/RES;
  rowProbs(probLiquid, pPass);
  rowProbs(probSolid, 1-Math.pow(1-Math.min(0.9, solidRate()*h/cellMetres), 1/passes));
  rowProbs(probBasal, 1-Math.pow(1-pContact*0.33, cellsPerStep/passes));
  for (let k = 0; k < passes; k++) propagate(thermoOn);
  // 1c. crystal drift: a part-frozen front sheds fragments that ride the surface current downstream
  if (currents.checked) {
    const frontEnd = frontN;
    for (let k = 0; k < frontEnd; k++) {
      const i = front[k];
      if (phi[i] < 0.05) continue;
      const flowF = flowFactor(i);
      if (flowF < 0.02) continue;
      const u = curU[i], v = curV[i], speedF = Math.hypot(u, v)*flowF;
      if (speedF < 0.05) continue;
      const r = (i/W)|0, eastWest = Math.abs(u) > Math.abs(v);
      if (Math.random() < speedF*0.06*cellsPerStep*3/(eastWest ? Math.max(1e-3, cosLat[r]) : 1)) {
        const q = i-r*W;
        const qTo = (q+(eastWest ? (u > 0 ? 1 : -1) : 0)+W)%W, rTo = Math.min(H-1, Math.max(0, r+(Math.abs(v) >= Math.abs(u) ? (v > 0 ? -1 : 1) : 0)));
        const n = rTo*W+qTo;
        if (grid[n] === 0 && (!thermoOn || T[n] < meltPtOpen(n))) {
          seedCell(n);
          pushFront(n);
        }
      }
    }
  }
  if (airborneOn && !snowCk.checked) { // with snowfall on, the crystal field and rain seeding carry the same physics
    const pLaunch = 0.00004*(1+mixSlider.value)*h/RES*Math.min(2, frontKmh()/39); // storms loft fewer crystals when the front itself is slow
    for (let k = poisson(pLaunch*seededN); k > 0; k--) {
      const i = frozenList[(Math.random()*seededN)|0];
      if (phi[i] < 0.5) continue;
      const r = (i/W)|0, q = i-r*W;
      const w = wind[r] > 0.02 ? 1 : wind[r] < -0.02 ? -1 : (Math.random() < .5 ? 1 : -1); // same expected launches as a coin per cell with probability pa
      const qTo = ((q+w*Math.min(W>>1, Math.round((2+Math.floor(Math.random()*8*RES))/Math.max(0.05, cosLat[r]))))%W+W)%W,
        rTo = Math.max(0, Math.min(H-1, r+Math.floor(Math.random()*7*RES)-3*RES));
      const n = rTo*W+qTo;
      if (grid[n] === 0 && (!thermoOn || T[n] < meltPtOpen(n))) seedCell(n);
    }
  }
  // 2. growth and partial melting: a seeded column locks at up to GROW per hour while it is below 45.8 °C, and gives back ice as excess heat requires
  const growMax = GROW*h;
  const nGrow = seededN+(frontN-frontStart);
  for (let kk = 0; kk < nGrow; kk++) {
    const i = kk < seededN ? frozenList[kk] : front[frontStart+kk-seededN];
    if (grid[i] !== 2) continue;
    if (!thermoOn) {
      const d = Math.min(1-phi[i], growMax);
      if (d > 0) addPhi(i, d);
      if (floatMode && capd[i] > 0 && phi[i] >= 1) {
        const dd = Math.min(1-phid[i], growMax);
        if (dd > 0) {
          phid[i] += dd;
          frozenMass += dd*capd[i]*AREA(i);
        }
      }
      continue;
    }
    if (kind[i] === 3) { // ice sheet: solid-state conversion through dry ice, basal-water rate on a wet bed, and the full liquid rate once the column is above 0 °C and ordinary ice is melting
      const sheetRate = T[i] > 0 ? GROW : wetBed[i] ? GROW*0.3 : solidRate()/depth[i];
      const warmPerSheet = Math.max(0.5, 2*(latK-80));
      if (T[i] < MELT) {
        const d = Math.min(1-phi[i], sheetRate*h, (MELT-T[i])/warmPerSheet);
        if (d > 1e-6) addPhi(i, d);
      }
      else {
        const d = Math.min(phi[i], (T[i]-MELT)/warmPerSheet);
        if (d > 0) {
          addPhi(i, -d);
          if (phi[i] <= 1e-6) {
            sheetFrozen -= phi[i]*AREA(i)*CAP(i);
            phi[i] = 0;
            grid[i] = 0;
          }
        }
      }
      continue;
    }
    if (floatMode && capd[i] > 0) deepStep(i, growMax, latK, h); // every substep: the overturn test and the deep freezing depend on the state, so once per tick made them step-dependent
    // the heat per unit solid fraction grows as the column locks and the brine melting point falls with it, so freeze or melt in increments of at most 0.1, each sized to land on the moving melting point
    const latPer = latentPerPhi(i), salt = salinityOf(i);
    let left = growMax;
    for (let k = 0; k < 20; k++) {
      const p = phi[i], mp = meltPt(p, salt), slope = meltSlope(p, salt), warmPer = warmingPerPhi(p, latPer, T[i]);
      if (T[i] < mp) {
        if (left <= 1e-6) break;
        const d = Math.min(1-p, left, 0.1, (mp-T[i])/(warmPer+slope));
        if (d <= 1e-6) break;
        addPhi(i, d);
        left -= d;
      }
      else {
        const d = Math.min(p, 0.1, (T[i]-mp)/(warmPer+slope));
        if (d <= 1e-6) break;
        addPhi(i, -d);
        if (phi[i] <= 1e-6) {
          const dArea = phi[i]*AREA(i);
          if (kind[i] === 3) sheetFrozen -= dArea*CAP(i);
          else if (kind[i]) inlandFrozen -= dArea;
          else {
            frozen -= dArea;
            frozenMass -= dArea*CAP(i);
          }
          phi[i] = 0;
          grid[i] = 0;
          break;
        }
      }
    }
  }
  if (thermoOn) {
    const Dcond = KH*h*RES*RES, Awind = A_WIND*h*RES, curRate = currents.checked ? 0.06*h*RES : 0;
    if (atmoOn) airIn.fill(0);
    advect(Awind, curRate);
    // at-rest map: rest per cell, and per chunk of CH cells whether every cell would skip on its own (quiet) and whether every cell is at rest.
    // A quiet chunk whose neighbours (chunks above and below, cells either side) are all at rest is copied unchanged, without visiting its cells.
    if (atRest.length !== N) {
      atRest = new Uint8Array(N);
      chunkQuiet = new Uint8Array(H*nChunks);
      chunkRest = new Uint8Array(H*nChunks);
    }
    for (let r = 0, k = 0; r < H; r++) {
      const o = r*W;
      for (let c = 0; c < nChunks; c++, k++) {
        const q1 = Math.min(W, (c+1)*CHUNK);
        let quiet = 1, all = 1;
        for (let q = c*CHUNK; q < q1; q++) {
          const i = o+q;
          let rest = Math.abs(advHeat[i]) < 1e-5;
          if (rest) { // the exp in hLat only for cells that pass the cheap test
            const ht = kind[i] === 3 ? H_SENS : H_SENS+hLat(T[i])*openSurface(i), cp = ht/(ht+H_LW);
            rest = Math.abs(T[i]-seaRef(i)-(atmoOn ? cp*(airT[airCell[i]]-airTclim[airCell[i]]) : 0)) < 0.3;
          }
          if (rest) {
            atRest[i] = 1;
            if (quiet && grid[i] !== 1) {
              const p = phi[i];
              if (kind[i] === 3 ? p !== 0 : (p !== 0 && p < 1)) quiet = 0;
            }
          } else {
            atRest[i] = 0;
            quiet = 0;
            all = 0;
          }
        } // rest is measured against the air-shifted target
        chunkQuiet[k] = quiet;
        chunkRest[k] = all;
      }
    }
    for (let r = 0; r < H; r++) {
      const o = r*W, seasonSea = solarOn ? 3*sinLat[r]*season : 0, seasonSheet = solarOn ? 4*sinLat[r]*season : 0, hasN = r > 0,
        hasS = r < H-1;
      for (let c = 0; c < nChunks; c++) {
        const k = r*nChunks+c, q0 = c*CHUNK, q1 = Math.min(W, q0+CHUNK);
        if (chunkQuiet[k] && (!hasN || chunkRest[k-nChunks]) && (!hasS || chunkRest[k+nChunks]) && atRest[o+(q0 > 0 ? q0-1 : W-1)] && atRest[o+(q1 < W ? q1 : 0)]) {
          Tnext.set(T.subarray(o+q0, o+q1), o+q0);
          continue;
        }
        for (let q = q0; q < q1; q++) {
          const i = o+q, gridI = grid[i];
          if (gridI === 1) {
            Tnext[i] = T[i];
            continue;
          }
          const capI = useCap ? cap[i] : 1, kindI = kind[i];
          if (kindI === 3) {
            if (phi[i] === 0 && atRest[i]) {
              Tnext[i] = T[i];
              continue;
            }
            const a = airCell[i], airLocal = atmoOn ? airT[a] : TA0;
            const hx = H_SENS+H_LW, cp = H_SENS/hx, dTa = atmoOn ? airLocal-airTclim[a] : 0;
            let target = T0[i]+cp*dTa+seasonSheet, k = hx*KC*h/capI; // the sheet's whole heat capacity against a 15 W/m²/K surface exchange: a 2 km sheet relaxes over centuries
            if (solarOn) k *= night[i] ? 1.2 : (1-0.4*insolation[i]);
            const tBefore = T[i], t = target+(tBefore-target)*expNeg(k);
            const toAir = atmoOn ? (tBefore-t)*capI*airShare(H_SENS, hx, cp, tBefore-T0[i]-seasonSheet, dTa) : 0;
            airIn[a] += toAir;
            budget.sea += ((tBefore-t)*capI-toAir)*cosLat[r];
            Tnext[i] = t;
            continue;
          }
          const east = q === W-1 ? o : i+1, west = q === 0 ? o+W-1 : i-1;
          // dormant water (ocean, lake or river): unfrozen or fully locked, at its resting temperature, calm neighbours, cool air above: nothing would change, so skip the full update
          if ((phi[i] === 0 || phi[i] >= 1) && atRest[i] && atRest[east] && atRest[west] && (!hasN || atRest[i-W]) && (!hasS || atRest[i+W])) {
            Tnext[i] = T[i];
            continue;
          }
          // interior ice: every neighbour locked or land, so no conduction gradient worth computing; only the slow relaxation toward rest, which is linear toward a fixed target, so it runs once per tick on the last substep
          if (gridI === 2 && phi[i] >= 1 && grid[east] !== 0 && grid[west] !== 0 && (!hasN || grid[i-W] !== 0) && (!hasS || grid[i+W] !== 0)) {
            if (!last) {
              Tnext[i] = T[i];
              continue;
            }
            const a = airCell[i], airLocal = atmoOn ? airT[a] : TA0;
            const hx = H_SENS+H_LW, cp = H_SENS/hx, dTa = atmoOn ? airLocal-airTclim[a] : 0;
            const ref = seaRef(i);
            let target = ref+cp*dTa+seasonSea, k = hx*KC*h*last/(capI*0.5);
            if (solarOn) k *= night[i] ? 1.2 : (1-0.4*insolation[i]);
            const tBefore = T[i]+advHeat[i], t = target+(tBefore-target)*expNeg(k);
            const lost = (tBefore-t)*capI*0.5, toAir = atmoOn ? lost*airShare(H_SENS, hx, cp, tBefore-ref-seasonSea, dTa) : 0; // a solid column holds half the heat per degree
            airIn[a] += toAir;
            budget.sea += (lost-toAir)*cosLat[r];
            Tnext[i] = t;
            continue;
          }
          const Ti = T[i], wIdx = i*4;
          let s = condW[wIdx]*(T[east]-Ti)+condW[wIdx+1]*(T[west]-Ti);
          if (hasN) s += condW[wIdx+2]*(T[i-W]-Ti);
          if (hasS) s += condW[wIdx+3]*(T[i+W]-Ti);
          let t = Ti+Dcond*s;
          t += advHeat[i]; // heat carried along currents and wind drift, from the conservative exchange pass
          const a = airCell[i], airLocal = atmoOn ? airT[a] : TA0, dTa = atmoOn ? airLocal-airTclim[a] : 0, ht = H_SENS+hLat(t)*openSurface(i),
            hx = ht+H_LW, cp = ht/hx; // turbulent (sensible + latent from the open surface: a sinking solid lies on the floor) and radiative coefficients
          const ref = gridI !== 2 ? T0[i] : kindI === 0 ? T0surf[i] : airTannual[airCell[i]]; // seaRef, inline (no ice sheets reach this branch)
          let target = ref+cp*dTa+seasonSea, k = hx*KC*h/(capI*(1-0.5*phi[i])); // the sea relaxes toward climatology shifted by the air anomaly, at the bulk-formula rate for its heat capacity
          if (solarOn) k *= night[i] ? 1.2 : (1-0.4*insolation[i]); // diurnal insolation against a loss of ~1 kW/m² for a column 30 K too warm
          const tBefore = t, heatCap = capI*(1-0.5*phi[i]);
          t = target+(t-target)*expNeg(k);
          if (atmoOn) {
            const v = (tBefore-t)*heatCap*airShare(ht, hx, cp, tBefore-ref-seasonSea, dTa);
            airIn[a] += v*H_SENS/ht; // the sensible part warms the air above; the latent part travels with the vapour (vapourStep)
            budget.sea += ((tBefore-t)*heatCap-v)*cosLat[r];
            evapAnom[a] += v*(ht-H_SENS)/ht; // the latent part: anomalous evaporation, released where it rains out
          } // the turbulent share of what the sea sheds goes into the air (both signs); the longwave share leaves directly
          else budget.sea += (tBefore-t)*heatCap*cosLat[r];
          if (t > 100) {
            if (atmoOn) airIn[a] += (t-100)*heatCap;
            else budget.sea += (t-100)*heatCap*cosLat[r];
            t = 100;
          } // boiling: anything above 100 °C leaves as steam
          if (floatMode && gridI === 0 && capd[i] > 0) {
            const kv = KV_L*h, cDeep = capd[i]*(1-0.5*phid[i]), flux = kv*(t-Td[i])/(1+kv*(1/heatCap+1/cDeep));
            t -= flux/heatCap;
            Td[i] += flux/cDeep;
          } // floats: eddy exchange with the deep layer, slow by design
          Tnext[i] = t;
        }
      }
    }
    T.set(Tnext);
    if (floatMode && atmoOn && leadShare() > 0) leadStep(h, leadShare());
    if (atmoOn && last) {
      vapourStep(h*last);
      if (snowCk.checked) snowStep(h*last);
    }
    if (atmoOn) airStep(h);
  }
  hours += h;
}
// ===== view: pan and zoom =====
let zoom = 1, panX = 0, panY = 0, dpr = 1, baseScale = 1;
function fit() {
  const b = mapCanvas.getBoundingClientRect();
  dpr = globeCk.checked ? 1 : Math.min(2, devicePixelRatio || 1);
  mapCanvas.width = Math.round(b.width*dpr);
  mapCanvas.height = Math.round(b.height*dpr);
  baseScale = mapCanvas.width/W;
  clampPan();
}
function clampPan() {
  const s = baseScale*zoom, mw = W*s, mh = H*s;
  panX = Math.min(0, Math.max(mapCanvas.width-mw, panX));
  panY = Math.min(0, Math.max(mapCanvas.height-mh, panY));
}
function setZoom(z, cx, cy) {
  if (globeCk.checked) {
    zoom = Math.max(1, Math.min(48, z));
    blit();
    return;
  }
  cx = cx ?? mapCanvas.width/2;
  cy = cy ?? mapCanvas.height/2;
  const nz = Math.max(1, Math.min(48, z));
  const k = nz/zoom;
  panX = cx-(cx-panX)*k;
  panY = cy-(cy-panY)*k;
  zoom = nz;
  clampPan();
  blit();
}
// ===== globe: orthographic projection, inverse-mapped per pixel from the flat image =====
let lon0 = -60*Math.PI/180, lat0 = 20*Math.PI/180, globeImg = null;
function globeRadius() {return 0.47*mapCanvas.height*zoom;}
function globeToCell(x, y) {
  const R = globeRadius(), cx = mapCanvas.width/2, cy = mapCanvas.height/2;
  const X = (x-cx)/R, Y = (cy-y)/R;
  const rho = Math.hypot(X, Y);
  if (rho > 1) return null;
  const c = Math.asin(rho), sc = Math.sin(c), cc = Math.cos(c), s0 = Math.sin(lat0), c0 = Math.cos(lat0);
  const lat = rho < 1e-9 ? lat0 : Math.asin(cc*s0+Y*sc*c0/rho);
  const lon = lon0+Math.atan2(X*sc, rho*c0*cc-Y*sc*s0);
  let q = Math.floor(((lon/Math.PI+1)/2*W)%W);
  if (q < 0) q += W;
  const r = Math.min(H-1, Math.max(0, Math.floor((0.5-lat/Math.PI)*H)));
  return [q, r, cc];
}
// the projection from screen pixels to the grid depends only on the view, the canvas and the grid, not on the state: it is computed once per
// view (globeMap) and each frame only copies colours. Per visible pixel: its offset, its grid cell, its base-grid cell (satellite and rivers)
// and the limb darkening, with the same arithmetic as the per-pixel projection, so the picture is identical.
let globeKey = '', globeN = 0, globePix = null, globeCell = null, globeBase = null, globeLimb = null;
function globeMap(cw, ch) {
  const R = globeRadius(), key = [cw, ch, R, lon0, lat0, W, H, BW, BH].join();
  if (key === globeKey) return;
  globeKey = key;
  const cx = cw/2, cy = ch/2, sinLat0 = Math.sin(lat0), cosLat0 = Math.cos(lat0);
  const x0 = Math.max(0, Math.floor(cx-R)), x1 = Math.min(cw, Math.ceil(cx+R)), y0 = Math.max(0, Math.floor(cy-R)),
    y1 = Math.min(ch, Math.ceil(cy+R)), cap = Math.max(1, (x1-x0)*(y1-y0));
  if (!globePix || globePix.length < cap) {
    globePix = new Int32Array(cap);
    globeCell = new Int32Array(cap);
    globeBase = new Int32Array(cap);
    globeLimb = new Float64Array(cap);
  }
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const Y = (cy-y)/R;
    for (let x = x0; x < x1; x++) {
      const X = (x-cx)/R;
      const r2 = X*X+Y*Y;
      if (r2 > 1) continue;
      const rho = Math.sqrt(r2), cc = Math.sqrt(1-r2);
      const lat = rho < 1e-9 ? lat0 : Math.asin(cc*sinLat0+Y*rho*cosLat0/rho);
      const lon = lon0+Math.atan2(X*rho, rho*cosLat0*cc-Y*rho*sinLat0);
      let q = Math.floor(((lon/Math.PI+1)/2)*W)%W;
      if (q < 0) q += W;
      const r = Math.min(H-1, Math.max(0, Math.floor((0.5-lat/Math.PI)*H)));
      const baseQ = Math.min(BW-1, Math.floor(((lon/Math.PI+1)/2)*BW+BW)%BW), baseR = Math.min(BH-1, Math.max(0, Math.floor((0.5-lat/Math.PI)*BH)));
      globePix[n] = (y*cw+x)*4;
      globeCell[n] = r*W+q;
      globeBase[n] = (baseR*BW+baseQ)*4;
      globeLimb[n] = 0.55+0.45*cc;
      n++;
    }
  }
  globeN = n;
}
function blitGlobe() {
  const cw = mapCanvas.width, ch = mapCanvas.height;
  if (!globeImg || globeImg.width !== cw || globeImg.height !== ch) globeImg = mapCtx.createImageData(cw, ch);
  const out = globeImg.data;
  out.fill(0);
  globeMap(cw, ch);
  const R = globeRadius(), cx = cw/2, cy = ch/2, sinLat0 = Math.sin(lat0), cosLat0 = Math.cos(lat0), riverPx = riverImg ? riverImg.data : null,
    satOn = !!(satPixels && satelliteCk.checked);
  for (let k = 0; k < globeN; k++) {
    const cell = globeCell[k], o = cell*4, p = globePix[k], b = globeBase[k];
    let red = gridPx[o], green = gridPx[o+1], blue = gridPx[o+2];
    if (satOn) {
      const alpha = gridPx[o+3]/255;
      red = satPixels[b]*(1-alpha)+red*alpha;
      green = satPixels[b+1]*(1-alpha)+green*alpha;
      blue = satPixels[b+2]*(1-alpha)+blue*alpha;
    }
    if (riverPx) {
      const alpha = riverPx[b+3]/255;
      if (alpha > 0) {
        red += (riverPx[b]-red)*alpha;
        green += (riverPx[b+1]-green)*alpha;
        blue += (riverPx[b+2]-blue)*alpha;
      }
    }
    if (satOn && nightMask && nightMask[cell]) {
      red *= 0.62;
      green *= 0.66;
      blue *= 0.78;
    }
    const limb = globeLimb[k];
    out[p] = red*limb;
    out[p+1] = green*limb;
    out[p+2] = blue*limb;
    out[p+3] = 255;
  }
  mapCtx.setTransform(1, 0, 0, 1, 0, 0);
  mapCtx.clearRect(0, 0, cw, ch);
  mapCtx.putImageData(globeImg, 0, 0);
  if (showcur.checked) {
    const stepC = Math.max(1, Math.round(14*RES/zoom));
    mapCtx.lineWidth = 1.2;
    mapCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    mapCtx.beginPath();
    const len = R*stepC/RES*Math.PI/180*0.9;
    for (let r = 0; r < H; r += stepC) for (let q = 0; q < W; q += stepC) {
      const i = r*W+q;
      if (grid[i] === 1) continue;
      const fl = flowFactor(i), u = curU[i]*fl, v = curV[i]*fl, sp = Math.hypot(u, v);
      if (sp < 0.12) continue;
      const lat = (0.5-(r+.5)/H)*Math.PI, lon = ((q+.5)/W*2-1)*Math.PI, dl = lon-lon0;
      const cosc = sinLat0*Math.sin(lat)+cosLat0*Math.cos(lat)*Math.cos(dl);
      if (cosc <= 0.05) continue;
      const X = cx+R*Math.cos(lat)*Math.sin(dl), Y = cy-R*(cosLat0*Math.sin(lat)-sinLat0*Math.cos(lat)*Math.cos(dl));
      const k = len*Math.min(1, sp)/sp*cosc;
      const X2 = X+u*k, Y2 = Y-v*k;
      mapCtx.moveTo(X, Y);
      mapCtx.lineTo(X2, Y2);
      const a = Math.atan2(-v, u);
      mapCtx.moveTo(X2, Y2);
      mapCtx.lineTo(X2-Math.cos(a-0.5)*len*0.3, Y2-Math.sin(a-0.5)*len*0.3);
      mapCtx.moveTo(X2, Y2);
      mapCtx.lineTo(X2-Math.cos(a+0.5)*len*0.3, Y2-Math.sin(a+0.5)*len*0.3);
    }
    mapCtx.stroke();
  }
}
function blit() {
  if (globeCk.checked) {
    blitGlobe();
    return;
  }
  mapCtx.setTransform(1, 0, 0, 1, 0, 0);
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  const s = baseScale*zoom, sat = satelliteCk.checked && !!satPixels;
  if (sat) {
    mapCtx.setTransform(s/(BR/RES), 0, 0, s/(BR/RES), panX, panY);
    mapCtx.imageSmoothingEnabled = true;
    mapCtx.drawImage(satCanvas, 0, 0);
  }
  mapCtx.imageSmoothingEnabled = s < 1;
  mapCtx.setTransform(s, 0, 0, s, panX, panY);
  mapCtx.drawImage(gridCanvas, 0, 0);
  mapCtx.setTransform(s/(BR/RES), 0, 0, s/(BR/RES), panX, panY);
  mapCtx.imageSmoothingEnabled = true;
  mapCtx.drawImage(riverCanvas, 0, 0);
  mapCtx.setTransform(s, 0, 0, s, panX, panY);
  if (sat && solar.checked) {
    mapCtx.imageSmoothingEnabled = false;
    mapCtx.drawImage(nightCanvas, 0, 0);
  }
  if (showcur.checked) {
    const stepC = Math.max(1, Math.round(14*RES/zoom)), len = stepC*0.9;
    mapCtx.lineWidth = 1.2/s;
    mapCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    mapCtx.beginPath();
    const q0 = Math.max(0, Math.floor(-panX/s)), q1 = Math.min(W, Math.ceil((mapCanvas.width-panX)/s)), r0 = Math.max(0, Math.floor(-panY/s)),
      r1 = Math.min(H, Math.ceil((mapCanvas.height-panY)/s));
    for (let r = r0-r0%stepC; r < r1; r += stepC) for (let q = q0-q0%stepC; q < q1; q += stepC) {
      const i = r*W+q;
      if (grid[i] === 1) continue;
      const fl = flowFactor(i), u = curU[i]*fl, v = curV[i]*fl, sp = Math.hypot(u, v);
      if (sp < 0.12) continue;
      const k = len*Math.min(1, sp)/sp;
      const x = q+.5, y = r+.5, x2 = x+u*k, y2 = y-v*k;
      mapCtx.moveTo(x, y);
      mapCtx.lineTo(x2, y2);
      const a = Math.atan2(-v, u);
      mapCtx.moveTo(x2, y2);
      mapCtx.lineTo(x2-Math.cos(a-0.5)*len*0.3, y2-Math.sin(a-0.5)*len*0.3);
      mapCtx.moveTo(x2, y2);
      mapCtx.lineTo(x2-Math.cos(a+0.5)*len*0.3, y2-Math.sin(a+0.5)*len*0.3);
    }
    mapCtx.stroke();
  }
}
// ===== painting the map =====
function draw() {
  const dark = (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light') || document.documentElement.dataset.theme === 'dark';
  const landRGB = dark ? [59, 57, 52] : [140, 133, 119];
  if (legendDark !== dark) legend(landRGB, dark);
  const solarOn = solar.checked, showAirOn = showair.checked && atmo.checked, showPhiOn = showphi.checked, naturalOn = naturalCk.checked, satOn = satelliteCk.checked && !!satPixels,
    showSnow = snowCk.checked && !!snow, lifeOn = lifeCk.checked && !!bloom;
  if (solarOn && frozen === 0) updateSun();
  hotCount = 0;
  const N = W*H;
  for (let i = 0; i < N; i++) {
    const pix = i*4, gridI = grid[i], kindI = kind[i];
    let R, G, B, hot = false, snowCover = 0;
    // the surface: a sinking solid lies on the floor, so the surface is open water until the column is frozen through (it turns to ice over the last tenth); a floating solid is the surface
    const surfIce = floatMode ? phi[i] : Math.max(0, (phi[i]-0.9)*10);
    const iceK = naturalOn && floatMode ? CRUST_MAX*Math.min(1, Math.sqrt(phi[i]/NAT_FULL)) : surfIce; // how white the surface is drawn
    if (gridI === 1 || kindI === 2 || (kindI === 1 && gridI === 0)) { // land; river channels (drawn on their own layer) and lakes look like land until the lattice reaches them
      R = landRGB[0];
      G = landRGB[1];
      B = landRGB[2];
      if (showSnow && kindI !== 1 && snow[i] > 0) { // ice-nine snow on land
        snowCover = Math.min(1, snow[i]/SNOW_MASK);
        R += (ICE9[0]-R)*snowCover;
        G += (ICE9[1]-G)*snowCover;
        B += (ICE9[2]-B)*snowCover;
      }
    }
    else if (kindI === 3) { // ice sheet: ordinary ice turning to ice-nine as it converts
      const f = phi[i];
      R = ICE[0]+(ICE9[0]-ICE[0])*f;
      G = ICE[1]+(ICE9[1]-ICE[1])*f;
      B = ICE[2]+(ICE9[2]-ICE[2])*f;
    }
    else {
      const t = T[i];
      hot = gridI === 2 ? t > meltPt(phi[i], salinityOf(i))+0.5 : t >= meltPtOpen(i); // slush sits at its melting point; only water clearly above it is shown as hot
      if (hot && !kindI) hotCount++;
      if (naturalOn) { // no temperature: open water, seasonal sea ice and the milky tint of a seeded sinking column; floating ice is added below
        const shadeF = shade[i];
        R = SEA[0]*shadeF;
        G = SEA[1]*shadeF;
        B = SEA[2]*shadeF;
        const seaIceF = gridI === 0 ? seaIceCover[i]*Math.max(0, Math.min(1, 1-(t-T0[i])/3)) : 0;
        if (seaIceF > 0) {
          const f = 0.85*seaIceF;
          R += (ICE[0]-R)*f;
          G += (ICE[1]-G)*f;
          B += (ICE[2]-B)*f;
        }
        if (!floatMode && phi[i] > 0) {
          const f = MILK_MAX*Math.min(1, phi[i]/NAT_FULL);
          R += (MILK[0]-R)*f;
          G += (MILK[1]-G)*f;
          B += (MILK[2]-B)*f;
        }
      }
      else if (hot) {
        R = HOT[0];
        G = HOT[1];
        B = HOT[2];
      }
      else {
        const j = tempLutIndex(t), shadeF = shade[i];
        R = TLUT[j]*shadeF;
        G = TLUT[j+1]*shadeF;
        B = TLUT[j+2]*shadeF;
        const seaIceF = gridI === 0 ? seaIceCover[i]*Math.max(0, Math.min(1, 1-(t-T0[i])/3)) : 0; // seasonal sea ice, melting away where the water under it has warmed
        if (seaIceF > 0) {
          const f = 0.85*seaIceF;
          R += (ICE[0]-R)*f;
          G += (ICE[1]-G)*f;
          B += (ICE[2]-B)*f;
        }
      }
      if (iceK > 0) {
        R += (ICE9[0]-R)*iceK;
        G += (ICE9[1]-G)*iceK;
        B += (ICE9[2]-B)*iceK;
        if (lifeOn && bloom[i] > 0) { // drawn stronger than its albedo effect so a bloom can be seen
          const f = 0.6*bloom[i]*surfIce;
          R += (ALGAE[0]-R)*f;
          G += (ALGAE[1]-G)*f;
          B += (ALGAE[2]-B)*f;
        }
      }
    }
    if (showAirOn) { // air temperature on the same scale; land keeps a trace of its colour so the coastlines stay readable
      const j = tempLutIndex(airT[airCell[i]]), k = gridI === 1 || kindI === 2 ? 0.75 : 1;
      R += (TLUT[j]-R)*k;
      G += (TLUT[j+1]-G)*k;
      B += (TLUT[j+2]-B)*k;
    }
    let A = 255;
    if (showPhiOn && gridI !== 1 && kindI !== 3 && kindI !== 2) { // solid-fraction overlay: the whole column (mixed and deep layer when it floats); water the lattice has not reached keeps its colour
      const c = floatMode && capd[i] > 0 ? (phi[i]*cap[i]+phid[i]*capd[i])/(cap[i]+capd[i]) : phi[i];
      if (c > 0.001) {
        const j = Math.round(c*100)*3;
        R = PLUT[j];
        G = PLUT[j+1];
        B = PLUT[j+2];
      }
    }
    if (satOn) { // satellite mode: land, unconverted ice sheets, lakes and rivers show the imagery; the sea shows it through a temperature-and-ice veil
      if (gridI === 1 || kindI === 2) A = Math.round(255*Math.min(1, snowCover*1.5)); // the imagery, whitened as snow covers it
      else if (kindI === 3 || kindI === 1) A = Math.round(255*Math.min(1, surfIce*1.5));
      else {
        const a = naturalOn ? (floatMode ? 0 : Math.min(1, phi[i]/NAT_FULL)) : Math.max(0, Math.min(1, (T[i]-8)/(MELT-8)));
        A = Math.round(255*(0.45+0.55*Math.max(a, Math.min(1, iceK*1.5), hot && !naturalOn ? 1 : 0)));
      }
      nightMask[i] = solarOn && night[i] ? 1 : 0;
    } // night is applied as an overlay in satellite mode so the imagery darkens too
    else if (solarOn && night[i]) {
      R *= NIGHT[0];
      G *= NIGHT[1];
      B *= NIGHT[2];
    }
    gridPx[pix] = R;
    gridPx[pix+1] = G;
    gridPx[pix+2] = B;
    gridPx[pix+3] = A;
  }
  gridCtx.putImageData(gridImg, 0, 0);
  if (satOn) {
    const d = nightImg.data;
    for (let i = 0; i < grid.length; i++) {
      const pix = i*4;
      d[pix] = 10;
      d[pix+1] = 18;
      d[pix+2] = 40;
      d[pix+3] = nightMask[i] ? 120 : 0;
    }
    nightCtx.putImageData(nightImg, 0, 0);
  }
  drawRivers(dark);
  blit();
}
function legend(ld, dark) { // swatches come from the colour constants above, so the legend cannot drift from the map
  legendDark = dark;
  const set = (id, bg) => {const e = $(id); if (e) e.style.background = bg;};
  set('lg_temp', lutCss(TLUT, T_LO, T_HI, T_N, -2, 43.6, 8));
  set('lg_hot', css(HOT));
  set('lg_ice9', css(ICE9));
  set('lg_algae', css(ALGAE.map((v, k) => Math.round(ICE9[k]+(v-ICE9[k])*0.6))));
  set('lg_ice', css(ICE));
  set('lg_sea', css(SEA));
  set('lg_milk', css(MILK.map((v, k) => Math.round(SEA[k]+(v-SEA[k])*MILK_MAX))));
  set('lg_land', css(ld));
  const j = tempLutIndex(15);
  set('lg_night', css([TLUT[j]*NIGHT[0], TLUT[j+1]*NIGHT[1], TLUT[j+2]*NIGHT[2]].map(Math.round)));
  set('lg_phi', lutCss(PLUT, 0, 1, 101, 0, 1, 6));
  set('lg_air', lutCss(TLUT, T_LO, T_HI, T_N, -20, 50, 8));
}
const riverCanvas = document.createElement('canvas');
riverCanvas.width = BW;
riverCanvas.height = BH;
const riverCtx = riverCanvas.getContext('2d');
let riverImg = null;
function drawRivers(dark) {
  if (!riverImg) riverImg = riverCtx.createImageData(BW, BH);
  const out = riverImg.data;
  out.fill(0);
  const sub = BR/RES;
  const nightOn = solar.checked && !(satelliteCk.checked && satPixels);
  for (let k = 0; k < riverBaseCells.length; k++) {
    const cell = riverBaseCells[k], baseR = (cell/BW)|0, baseQ = cell-baseR*BW;
    const i = ((baseR/sub)|0)*W+((baseQ/sub)|0);
    const phiCell = phi[i] || 0;
    if (phiCell <= 0) continue;
    const pix = cell*4;
    const isNight = nightOn && night[i];
    out[pix] = isNight ? ICE9[0]*NIGHT[0] : ICE9[0];
    out[pix+1] = isNight ? ICE9[1]*NIGHT[1] : ICE9[1];
    out[pix+2] = isNight ? ICE9[2]*NIGHT[2] : ICE9[2];
    out[pix+3] = Math.round(230*Math.min(1, phiCell*3));
  } // rivers show only once ice-nine has reached them, and darken with the night side
  riverCtx.putImageData(riverImg, 0, 0);
}
// ===== readouts =====
// history sparklines: one sample per readout, thinned by pairwise merging once the buffer fills
const HIST_MAX = 480;
const hist = {t:[], pct:[], temp:[], air:[], hot:[], sheet:[]};
function histPush(t, v) {
  hist.t.push(t);
  hist.pct.push(v.pct);
  hist.temp.push(v.temp);
  hist.air.push(v.air);
  hist.hot.push(v.hot);
  hist.sheet.push(v.sheet);
  if (hist.t.length > HIST_MAX) {
    for (const k in hist) {
      const a = hist[k], b = [];
      for (let i = 0; i < a.length-1; i += 2) b.push((a[i]+a[i+1])/2);
      if (a.length%2) b.push(a[a.length-1]);
      hist[k] = b;
    }
  }
}
function histReset() {for (const k in hist) hist[k] = [];}
function cssVar(n) {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}
function spark(id, arr, opts) {
  const c = $(id);
  if (!c) return;
  const r = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w*r) || c.height !== Math.round(h*r)) {
    c.width = Math.round(w*r);
    c.height = Math.round(h*r);
  }
  const g = c.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  if (arr.length < 2) return;
  let lo = opts.min ?? Math.min(...arr), hi = opts.max ?? Math.max(...arr);
  if (opts.ref !== undefined) {
    lo = Math.min(lo, opts.ref);
    hi = Math.max(hi, opts.ref);
  }
  if (hi-lo < 1e-6) hi = lo+1;
  const pad = 2, X = i => pad+(w-2*pad)*i/(arr.length-1), Y = v => h-pad-(h-2*pad)*(v-lo)/(hi-lo);
  const line = cssVar(opts.color), grid = cssVar('--line');
  if (opts.ref !== undefined) {
    g.strokeStyle = grid;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(pad, Y(opts.ref));
    g.lineTo(w-pad, Y(opts.ref));
    g.stroke();
    g.setLineDash([]);
  }
  g.beginPath();
  g.moveTo(X(0), Y(arr[0]));
  for (let i = 1; i < arr.length; i++) g.lineTo(X(i), Y(arr[i]));
  g.lineTo(X(arr.length-1), h-pad);
  g.lineTo(X(0), h-pad);
  g.closePath();
  g.globalAlpha = 0.15;
  g.fillStyle = line;
  g.fill();
  g.globalAlpha = 1;
  g.beginPath();
  g.moveTo(X(0), Y(arr[0]));
  for (let i = 1; i < arr.length; i++) g.lineTo(X(i), Y(arr[i]));
  g.strokeStyle = line;
  g.lineWidth = 1.5;
  g.lineJoin = 'round';
  g.stroke();
  g.beginPath();
  g.arc(X(arr.length-1), Y(arr[arr.length-1]), 2.2, 0, Math.PI*2);
  g.fillStyle = line;
  g.fill();
}
function drawSparks() {
  spark('sp_pct', hist.pct, {color:'--accent', min:0, max:100});
  spark('sp_temp', hist.temp, {color:'--hot', ref:MELT, min:0});
  spark('sp_air', hist.air, {color:'--hot', ref:TA0});
  spark('sp_sheet', hist.sheet, {color:'--accent', min:0, max:100});
}
function stats() {
  const areaShare = frozen/waterCount, massShare = frozenMass/massTotal;
  $('pct').innerHTML = (massShare*100).toFixed(2)+'<small> %</small>';
  $('bar').style.width = (massShare*100)+'%';
  $('area').innerHTML = (areaShare*OCEAN_KM2/1e6).toFixed(1)+'<small> M km²</small>';
  $('inland').innerHTML = (inlandCount ? inlandFrozen/inlandCount*100 : 0).toFixed(1)+'<small> %</small>';
  $('landV').textContent = snowCk.checked && atmo.checked ? 'land white '+(landArea ? landWhite/landArea*100 : 0).toFixed(0)+'% · '+(snowVol/(OCEAN_KM2*1e6)*100).toFixed(1)+' cm of ocean on land · rain ×'+rainRatio.toFixed(1) : '';
  $('sheet').innerHTML = (sheetMass ? sheetFrozen/sheetMass*100 : 0).toFixed(1)+'<small> %</small>';
  let tSum = 0, wSum = 0, deepMass = 0, deepFrozen = 0, deepTSum = 0, deepWSum = 0, latSum = 0, solidSum = 0;
  const latK = thermo.checked ? +latentSlider.value : 100;
  const stride = Math.max(1, RES>>1);
  for (let r = 0; r < H; r += stride) for (let q = (r>>1)%stride; q < W; q += stride) {
    const i = r*W+q;
    if (grid[i] !== 1 && !kind[i]) {
      if (phi[i] < 1) {
        const wt = CAP(i)*AREA(i)*(1-phi[i]);
        tSum += T[i]*wt;
        wSum += wt;
      }
      const ws = CAP(i)*AREA(i)*phi[i]; // latent heat at the temperature it froze near (Kirchhoff)
      latSum += ws*Math.max(0, latK-0.5*(MELT-T[i]));
      solidSum += ws;
      if (floatMode && capd[i] > 0) {
        const wDeep = capd[i]*AREA(i);
        deepMass += wDeep;
        deepFrozen += phid[i]*wDeep;
        latSum += wDeep*phid[i]*Math.max(0, latK-0.5*(MELT-Td[i]));
        solidSum += wDeep*phid[i];
        if (phid[i] < 1) {
          const wt = wDeep*(1-phid[i]);
          deepTSum += Td[i]*wt;
          deepWSum += wt;
        }
      }
    }
  } // every st-th cell each way at 0.25° and finer; a display mean does not need all of them
  const seaT = wSum ? tSum/wSum : 0;
  const J = massShare*OCEAN_KG*(solidSum ? latSum/solidSum : latK)*CP*1e3;
  $('heat').innerHTML = (J/1e24).toFixed(2)+'<small> ×10²⁴ J</small>';
  $('temp').innerHTML = seaT.toFixed(1)+'<small> °C</small>';
  if (floatMode) $('deepV').textContent = 'surface '+(areaShare*100).toFixed(0)+'% · deep '+(deepMass ? deepFrozen/deepMass*100 : 0).toFixed(1)+'% · deep '+(deepWSum ? deepTSum/deepWSum : 0).toFixed(1)+' °C · overturning '+(deepMass ? overturnMass/(deepMass*stride*stride)*100 : 0).toFixed(0)+'%';
  if (frozen > 0 || hist.t.length) {
    const last = hist.t[hist.t.length-1];
    if (last === undefined || hours > last) histPush(hours, {
      pct:massShare*100, temp:seaT, air:airMean, hot:hotCount/waterCount*100, sheet:sheetMass ? sheetFrozen/sheetMass*100 : 0
      });
    drawSparks();
  }
  $('air').innerHTML = airMean.toFixed(1)+'<small> °C</small>';
  $('time').innerHTML = (hours < 2 ? Math.round(hours*60)+'<small> min</small>' : hours < 48 ? hours.toFixed(1)+'<small> h</small>' : hours < 24*365 ? (hours/24).toFixed(1)+'<small> days</small>' : (hours/8760).toFixed(2)+'<small> yr</small>');
}
function setStatus(t, c) {
  const s = $('status');
  s.textContent = t;
  s.className = 'pill '+c;
}
const hint = $('hint');
let hintTimer;
const HINT = () => globeCk.checked ? 'Tap water to seed · drag to rotate · pinch or scroll to zoom' : 'Tap water to seed · drag to pan · pinch or scroll to zoom';
function flash(t) {
  hint.textContent = t;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.textContent = HINT(), 1800);
}
function speedText() {
  const h = hoursPerFrame();
  return (h < 1 ? Math.round(h*60)+' min' : h < 10 ? h.toFixed(1)+' h' : Math.round(h)+' h')+' per frame';
}
function frontKmh() {return Math.pow(10, rateSlider.value/100*2.3);} // 1 … 200 km/h
function rateText() {
  const v = frontKmh();
  return (v < 10 ? v.toFixed(1) : Math.round(v))+' km/h';
}
$('rateV').textContent = rateText();
$('speedV').textContent = speedText();
rateSlider.addEventListener('input', () => $('rateV').textContent = rateText());
speedSlider.addEventListener('input', () => $('speedV').textContent = speedText());
latentSlider.addEventListener('input', () => {
  $('latV').textContent = Math.round(latentSlider.value*CP)+' kJ/kg';
  stats();
  });
const coolNames = ['', 'glacial', 'very slow', 'slow', 'medium', 'brisk', 'fast', 'faster', 'rapid', 'very rapid', 'instant'];
coolSlider.addEventListener('input', () => $('coolV').textContent = coolNames[coolSlider.value]);
const mixNames = ['still air', 'calm', 'light', 'gentle', 'medium', 'breezy', 'windy', 'gusty', 'stormy', 'gale', 'hurricane'];
mixSlider.addEventListener('input', () => $('mixV').textContent = mixNames[mixSlider.value]);
mixSlider.addEventListener('change', () => {if (grid) spinVapourToday();}); // today's vapour depends on the transport
// crystal sliders, log scales centred on the defaults: washout 1 day to 7 weeks, lofting 15 minutes to 100 days, threshold 1e-6 to 1e-2
function crystalParams() {
  const f = (el, span) => Math.pow(10, (el.value-50)/50*span);
  const wash = 7*f(washSlider, Math.log10(7)), loft = 24*f(loftSlider, 2);
  CRY_OUT = 1/(wash*24);
  CRY_UP = 1/loft;
  CRY_MIN = 1e-4*f(threshSlider, 2);
  $('washV').textContent = wash < 1.5 ? Math.round(wash*24)+' h' : wash.toFixed(wash < 10 ? 1 : 0)+' days';
  $('loftV').textContent = loft < 1 ? Math.round(loft*60)+' min' : loft < 48 ? loft.toFixed(loft < 10 ? 1 : 0)+' h' : (loft/24).toFixed(loft < 240 ? 1 : 0)+' days';
  $('threshV').textContent = CRY_MIN.toExponential(0)+' of seeded air';
}
crystalParams();
for (const el of [washSlider, loftSlider, threshSlider]) el.addEventListener('input', crystalParams);
function solidText() {
  const v = solidRate();
  return v.toFixed(v < 10 ? 1 : 0)+' m/h';
}
$('solidV').textContent = solidText();
function leadsText() {
  const v = LEAD_STEPS[leadsSlider.value];
  return v ? +(v*100).toFixed(1)+'% open' : 'sealed';
}
$('leadsV').textContent = leadsText();
leadsSlider.addEventListener('input', () => $('leadsV').textContent = leadsText());
solidSlider.addEventListener('input', () => $('solidV').textContent = solidText());
thermo.addEventListener('change', stats);
solar.addEventListener('change', draw);
showcur.addEventListener('change', blit);
showair.addEventListener('change', draw);
snowCk.addEventListener('change', () => {
  if (!snowCk.checked) snowClear();
  stats();
  draw();
});
showphi.addEventListener('change', draw);
naturalCk.addEventListener('change', draw);
depthOn.addEventListener('change', () => {
  buildWeights();
  frozenMass = 0;
  massTotal = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1 || kind[i]) continue;
    const ar = AREA(i), a = CAP(i)*ar;
    massTotal += a+capd[i]*ar;
    if (grid[i] === 2) frozenMass += phi[i]*a+phid[i]*capd[i]*ar;
  }
  stats();
  }); // ocean columns only, as in build and addPhi
function rebuild() {
  $('loading').hidden = false;
  setTimeout(() => {
    build(+resSel.value);
    fit();
    zoom = 1;
    panX = 0;
    panY = 0;
    reset();
    $('loading').hidden = true;
    }, 30);
}
resSel.addEventListener('change', rebuild);
function floatsUI() {
  depthOn.disabled = floatsCk.checked;
  leadsSlider.disabled = !floatsCk.checked;
  $('deepV').hidden = !floatsCk.checked;
}
floatsUI();
floatsCk.addEventListener('change', () => {
  floatsUI();
  rebuild();
  });
function ensureSeed() {
  if (frozen+inlandFrozen+sheetFrozen > 0) return;
  seed(Math.floor((180-73)*RES), Math.floor((90-18)*RES));
  flash('No seed yet, so one was dropped at San Lorenzo');
}
playBtn.addEventListener('click', () => {
  ensureSeed();
  running = !running;
  playBtn.textContent = running ? 'Pause' : 'Start';
  });
$('step').addEventListener('click', () => {
  ensureSeed();
  tick();
  draw();
  stats();
  });
$('reset').addEventListener('click', reset);
$('zin').addEventListener('click', () => setZoom(zoom*1.6));
$('zout').addEventListener('click', () => setZoom(zoom/1.6));
$('zreset').addEventListener('click', () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  lon0 = -60*Math.PI/180;
  lat0 = 20*Math.PI/180;
  blit();
  });
globeCk.addEventListener('change', () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  mapBox.classList.toggle('globe', globeCk.checked);
  fit();
  blit();
  $('hint').textContent = HINT();
  });
// ===== pointer input =====
const mapBox = $('mapbox'), pointers = new Map();
let drag = null, pinch = null, wheelAt = -1e9;
// the model holds while the map is dragged, pinched or wheel-zoomed, so the view follows the hand: a tick can take far longer than a frame on fine grids or long steps
function interacting() {return !!pinch || !!(drag && drag.moved) || performance.now()-wheelAt < 250;}
function toDevicePx(e) {
  const b = mapCanvas.getBoundingClientRect();
  return [(e.clientX-b.left)*dpr, (e.clientY-b.top)*dpr];
}
mapBox.addEventListener('pointerdown', e => {
  if (e.target.tagName === 'BUTTON' || e.target.closest('.viewsw')) return;
  mapBox.setPointerCapture(e.pointerId);
  const [x, y] = toDevicePx(e);
  pointers.set(e.pointerId, [x, y]);
  if (pointers.size === 1) drag = {x, y, px:panX, py:panY, lon0, lat0, moved:false};
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = {d:Math.hypot(a[0]-b[0], a[1]-b[1]), z:zoom};
    drag = null;
  }
  });
mapBox.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const [x, y] = toDevicePx(e);
  pointers.set(e.pointerId, [x, y]);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0]-b[0], a[1]-b[1]);
    setZoom(pinch.z*d/pinch.d, (a[0]+b[0])/2, (a[1]+b[1])/2);
  }
  else if (drag) {
    const dx = x-drag.x, dy = y-drag.y;
    if (Math.hypot(dx, dy) > 6*dpr) drag.moved = true;
    if (drag.moved) {
      if (globeCk.checked) {
        const R = globeRadius();
        lon0 = drag.lon0-dx/R/Math.max(0.3, Math.cos(lat0));
        lon0 -= 2*Math.PI*Math.round(lon0/(2*Math.PI));
        lat0 = Math.max(-1.5, Math.min(1.5, drag.lat0+dy/R));
        blit();
      } else {
        panX = drag.px+dx;
        panY = drag.py+dy;
        clampPan();
        blit();
      }
    }
  }
  });
function onPointerUp(e) {
  const was = drag;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (was && !was.moved && pointers.size === 0) {
    if (globeCk.checked) {
      const g = globeToCell(was.x, was.y);
      if (g) seed(g[0], g[1]);
    } else {
      const s = baseScale*zoom;
      const q = Math.floor((was.x-panX)/s), r = Math.floor((was.y-panY)/s);
      if (q >= 0 && q < W && r >= 0 && r < H) seed(q, r);
    }
  }
  if (pointers.size === 0) drag = null;
}
mapBox.addEventListener('pointerup', onPointerUp);
mapBox.addEventListener('pointercancel', onPointerUp);
mapBox.addEventListener('wheel', e => {
  if (!e.cancelable) return; // a scroll that began on the page and slid onto the map stays latched to the page: zooming too would do both
  e.preventDefault();
  wheelAt = performance.now();
  const [x, y] = toDevicePx(e);
  setZoom(zoom*(e.deltaY < 0 ? 1.15 : 1/1.15), x, y);
  }, {passive:false});
// ===== main loop and start-up =====
// repaint at most every 45 ms, and no more often than keeps repainting under about a fifth of the time: on fine grids or slow devices a
// repaint (per-cell colours, plus the globe) can cost a large share of a short tick, and the model should get the time
const DRAW_SHARE = 0.2;
let lastStatsAt = 0, lastDrawAt = 0, drawCost = 0;
function loop(ts) {
  if (running && !interacting()) {
    tick();
    const now = performance.now();
    if (now-lastDrawAt > Math.max(45, drawCost/DRAW_SHARE)) {
      draw();
      const done = performance.now();
      drawCost = drawCost ? 0.7*drawCost+0.3*(done-now) : done-now; // smoothed, so one slow frame does not stall the picture
      lastDrawAt = now;
    }
    if (ts-lastStatsAt > 250) {
      stats();
      lastStatsAt = ts;
    }
  }
  requestAnimationFrame(loop);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  draw();
  drawSparks();
  });
new MutationObserver(() => {
  draw();
  drawSparks();
  }).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']});
new ResizeObserver(() => {
  fit();
  blit();
  drawSparks();
  }).observe(mapCanvas);
if (!base) {
  $('loading').hidden = false;
  $('loading').textContent = typeof DecompressionStream === 'undefined' ? 'This browser cannot decompress the map data (no DecompressionStream).' : 'Map data could not be loaded. Serve this folder over HTTP (file:// blocks fetch).';
}
else {
  build(+resSel.value);
  fit();
  seaIceEdges();
  draw();
  stats();
  requestAnimationFrame(loop);
}
  })();
