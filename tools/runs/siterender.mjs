// Website renders: flat map and globe views (satellite base) at chosen days. usage: node siterender.mjs <appDir> <floats 0|1> <outPrefix> <satRaw>
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const [,, appDir, fl, outPrefix, satRaw] = process.argv;
let sd = 1; Math.random = () => { sd = (sd*1664525+1013904223)>>>0; return sd/4294967296; };
const els = {}, listeners = {};
const ctx2d = {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),drawImage(){},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},arc(){},setLineDash(){}};
const mk = id => els[id] ??= {id,checked:true,value:'50',textContent:'',innerHTML:'',hidden:false,disabled:false,style:{},className:'',tagName:'DIV',width:0,height:0,clientWidth:200,clientHeight:40,classList:{toggle(){}},getContext:()=>ctx2d,getBoundingClientRect:()=>({left:0,top:0,width:1440,height:720}),setPointerCapture(){},closest:()=>null,addEventListener:(t,f)=>{(listeners[id+':'+t]??=[]).push(f);}};
mk('res').options = [];
for (const [k,v] of Object.entries({speed:process.env.SPEED||'100',rate:'51',lat:'93',cool:'4',solid:'0',mix:'4',res:'2',globe:false,satellite:false,showcur:false,showair:false,showphi:false,floats:fl==='1',life:false})) {const e = mk(k); if (typeof v === 'boolean') e.checked = v; else e.value = v;}
globalThis.document = {getElementById:mk,createElement:()=>({...mk('c'+Math.random()),getContext:()=>ctx2d}),documentElement:{dataset:{}},querySelector:()=>mk('sub')};
globalThis.matchMedia = () => ({matches:false,addEventListener(){}}); globalThis.MutationObserver = class{observe(){}}; globalThis.ResizeObserver = class{observe(){}};
globalThis.requestAnimationFrame = () => {}; globalThis.devicePixelRatio = 1; globalThis.getComputedStyle = () => ({getPropertyValue:()=>'#000'}); globalThis.Image = class{set src(v){}};
globalThis.fetch = async u => new Response(fs.readFileSync(path.join(appDir, u)));
const src = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
await (0,eval)(src.replace(/^\(async function\(\) ?\{/, 'globalThis.__app=(async function(){globalThis.__ev=s=>eval(s);')); await globalThis.__app;
const E = s => globalThis.__ev(s);
globalThis.__sat = new Uint8ClampedArray(fs.readFileSync(satRaw).buffer.slice(0));
function png(file, w, h, rgba, alpha) {
  const ch = alpha ? 4 : 3, raw = Buffer.alloc((w*ch+1)*h);
  for (let y = 0; y < h; y++) { raw[y*(w*ch+1)] = 0; for (let x = 0; x < w; x++) { const s = (y*w+x)*4, d = y*(w*ch+1)+1+x*ch; for (let k = 0; k < ch; k++) raw[d+k] = rgba[s+k]; } }
  const crc = b => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c>>>1)^(0xEDB88320&-(c&1)); } return (~c)>>>0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = alpha ? 6 : 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]));
}
const step = () => { for (const f of listeners['step:click']) f(); };
const VIEWS = [['atlantic', -35, 22], ['pacific', -165, 5], ['arctic', 20, 72]];
const STOPS = process.env.DAILY ? Array.from({length: +process.env.DAILY}, (_, k) => [(k+1)*24, 'day'+String(k+1).padStart(2, '0')]) : [[12*48, 'd24'], [40*48, 'd80'], [183*48, 'y1'], [1500*48, 'y8']];
const ONLY = process.env.VIEWS ? process.env.VIEWS.split(',') : null;
for (const [stopH, tag] of STOPS) {
  while (E('hours') < stopH-1) step();
  els.solar.checked = false; // render without the night side; restored before the model steps again
  els.globe.checked = false; els.satellite.checked = false; E('draw()');
  { const W = E('W'), H = E('H'); png(`${outPrefix}_${tag}_flat.png`, W, H, E('gridPx'), false); }
  els.satellite.checked = true; E('satPixels = globalThis.__sat'); E('draw()');
  els.globe.checked = true; els.map.getBoundingClientRect = () => ({left:0, top:0, width:900, height:900}); E('fit()');
  for (const [name, lon, lat] of VIEWS.filter(v => !ONLY || ONLY.includes(v[0]))) {
    E(`lon0 = ${lon}*Math.PI/180; lat0 = ${lat}*Math.PI/180; zoom = 1; blit()`);
    const g = E('globeImg'); png(`${outPrefix}_${tag}_globe_${name}.png`, g.width, g.height, g.data, true);
  }
  els.map.getBoundingClientRect = () => ({left:0, top:0, width:1440, height:720});
  els.solar.checked = true; els.globe.checked = false; els.satellite.checked = false;
  console.log(tag, E('(hours/24).toFixed(0)'), 'days done');
}
