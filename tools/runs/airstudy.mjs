// Run the instrumented app with Step clicks and log per-step series to JSON for analysis.
import fs from 'node:fs'; import path from 'node:path';
const [,, appDir, steps, res, speed, solarOn, out] = process.argv;
if (process.env.SEED) { let sd = +process.env.SEED; Math.random = () => { sd = (sd*1664525+1013904223)>>>0; return sd/4294967296; }; }
const els = {}; const listeners = {};
const ctx2d = { createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
  drawImage(){}, setTransform(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, closePath(){}, arc(){}, setLineDash(){} };
const mk = id => els[id] ??= { id, checked: true, value: '50', textContent:'', innerHTML:'', hidden:false, style:{}, className:'', tagName:'DIV', width:0, height:0, clientWidth:200, clientHeight:40,
  classList:{toggle(){}}, getContext:()=>ctx2d, getBoundingClientRect:()=>({left:0,top:0,width:1440,height:720}), setPointerCapture(){}, closest:()=>null,
  addEventListener:(t,f)=>{(listeners[id+':'+t] ??= []).push(f);} };
mk('res').options=['1','2','4','8'].map(v=>({value:v,remove(){}}));
const E=(k,d)=>process.env[k]??d, B=(k,d)=>(process.env[k]??d)==='1';
const defaults = { speed, rate:E('RATE','51'), lat:E('LAT','93'), cool:E('COOL','4'), solid:E('SOLID','0'), mix:E('MIX','4'), leads:E('LEADS','0'), res, globe:false, satellite:false, showcur:false, showair:false, showphi:false,
  solar: solarOn==='1', floats:B('FLOATS','0'), thermo:B('THERMO','1'), atmo:B('ATMO','1'), currents:B('CURRENTS','1'), airborne:B('AIRBORNE','1'), depthOn:B('DEPTH','1'), snowfall:B('SNOW','1'), greenhouse:B('GH','1'), clouds:B('CLOUDS','1'), life:B('LIFE','0') };
for (const [k,v] of Object.entries(defaults)) { const e = mk(k); if (typeof v === 'boolean') e.checked = v; else e.value = v; }
globalThis.document = { getElementById: mk, createElement: () => ({ ...mk('c'+Math.random()), getContext:()=>ctx2d }), documentElement:{dataset:{}}, querySelector:()=>mk('sub') };
globalThis.matchMedia = () => ({ matches:false, addEventListener(){} });
globalThis.MutationObserver = class { observe(){} }; globalThis.ResizeObserver = class { observe(){} };
globalThis.requestAnimationFrame = () => {}; globalThis.devicePixelRatio = 1;
globalThis.getComputedStyle = () => ({ getPropertyValue:()=>'#000' });
globalThis.Image = class { set src(v){} };
globalThis.fetch = async u => new Response(fs.readFileSync(path.join(appDir, u)));
await (0, eval)(fs.readFileSync(path.join(appDir, 'app.js'), 'utf8').replace(/^\(async function\(\) ?\{/, 'globalThis.__app=(async function(){'));
await globalThis.__app;
const rows = [];
for (let k = 0; k < +steps; k++) {
  for (const f of listeners['step:click']) f();
  const s = __s();
  // where the heat entering the air comes from: total, and how concentrated it is in longitude (1 = one meridian, 0 = spread evenly)
  let tot = 0, cx = 0, cy = 0;
  for (let r = 0; r < s.AH; r++) for (let q = 0; q < s.AW; q++) { const v = s.airIn[r*s.AW+q]; if (v <= 0) continue; const lam = (q+.5)/s.AW*2*Math.PI; tot += v; cx += v*Math.cos(lam); cy += v*Math.sin(lam); }
  const src={...__src};for(const k in __src)__src[k]=0;rows.push({ ...src, h: s.hours, status: els.status.textContent, f: s.frozen/s.waterCount, fm: s.frozenMass/s.massTotal, Ta: s.Ta, lw: s.landArea ? s.landWhite/s.landArea : 0, rain: s.rainRatio, heatIn: tot, conc: tot ? Math.hypot(cx, cy)/tot : 0 });
}
fs.writeFileSync(out, JSON.stringify(rows));
console.log('done', rows.length, 'steps,', rows.at(-1).h.toFixed(0), 'h');
