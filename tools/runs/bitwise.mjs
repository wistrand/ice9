// Bitwise check: run an app.js with seeded Math.random and given settings, press Step N times, print SHA-256 of every state array.
// usage: node bitwise.mjs <dir with data/> <app.js> <config: sinks floats nodepth nosnow life changes fine long_s long_f startup>
// e.g. keep a copy of the old app.js, run both on each config, and compare the printed hashes
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const [,, appDir, file, cfgName] = process.argv;
const CFG = {
  sinks:   {set: {floats: false}, steps: 40},
  floats:  {set: {floats: true}, steps: 40},
  nodepth: {set: {floats: false, depthOn: false}, steps: 30},
  nosnow:  {set: {floats: false, snowfall: false}, steps: 30},
  life:    {set: {floats: true, life: true}, steps: 40},
  changes: {set: {floats: true}, steps: 30, at: 12, change: {speed: '70', mix: '6', lat: '120'}},
  fine:    {set: {floats: false, speed: '49'}, steps: 60},
  long_s:  {set: {floats: false}, steps: 150},
  long_f:  {set: {floats: true}, steps: 150},
  startup: {set: {floats: false}, steps: 0},
};
const cfg = CFG[cfgName];
let seed = 12345; Math.random = () => { seed = (seed*1664525+1013904223)>>>0; return seed/4294967296; };
const els = {}, listeners = {};
const ctx2d = {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),drawImage(){},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},arc(){},setLineDash(){}};
const mk = id => els[id] ??= {id,checked:true,value:'50',textContent:'',innerHTML:'',hidden:false,disabled:false,style:{},className:'',tagName:'DIV',width:0,height:0,clientWidth:200,clientHeight:40,classList:{toggle(){}},getContext:()=>ctx2d,getBoundingClientRect:()=>({left:0,top:0,width:1440,height:720}),setPointerCapture(){},closest:()=>null,addEventListener:(t,f)=>{(listeners[id+':'+t]??=[]).push(f);}};
mk('res').options = [];
const base = {speed:'100',rate:'51',lat:'93',cool:'4',solid:'0',mix:'4',res:'2',globe:false,satellite:false,showcur:false,showair:false,showphi:false,natural:false,life:false};
for (const [k,v] of Object.entries({...base, ...cfg.set})) {const e = mk(k); if (typeof v === 'boolean') e.checked = v; else e.value = v;}
globalThis.document = {getElementById:mk,createElement:()=>({...mk('c'+Math.random()),getContext:()=>ctx2d}),documentElement:{dataset:{}},querySelector:()=>mk('sub')};
globalThis.matchMedia = () => ({matches:false,addEventListener(){}}); globalThis.MutationObserver = class{observe(){}}; globalThis.ResizeObserver = class{observe(){}};
globalThis.requestAnimationFrame = () => {}; globalThis.devicePixelRatio = 1; globalThis.getComputedStyle = () => ({getPropertyValue:()=>'#000'}); globalThis.Image = class{set src(v){}};
globalThis.fetch = async u => new Response(fs.readFileSync(path.join(appDir, u)));
await (0,eval)(fs.readFileSync(file,'utf8').replace(/^\(async function\(\) ?\{/, 'globalThis.__app=(async function(){globalThis.__ev=s=>eval(s);')); await globalThis.__app;
const E = s => globalThis.__ev(s);
const fire = (id, t) => { for (const f of listeners[id+':'+t] || []) f(); };
for (let k = 0; k < cfg.steps; k++) {
  if (cfg.at === k) for (const [id, v] of Object.entries(cfg.change)) { els[id].value = v; fire(id, 'input'); fire(id, 'change'); }
  fire('step', 'click');
}
const names = ['T','phi','Td','phid','sal','sald','grid','airT','vapour','latentAir','crystals','snow','bloom','airIn','evapAnom'];
const h = crypto.createHash('sha256'); const parts = [];
for (const n of names) {
  const a = E(`typeof ${n} === 'undefined' || !${n} ? null : ${n}`);
  if (!a) { parts.push(n+':-'); continue; }
  const b = Buffer.from(a.buffer, a.byteOffset, a.byteLength); h.update(n); h.update(b);
  parts.push(n+':'+crypto.createHash('sha256').update(b).digest('hex').slice(0, 8));
}
const sc = E('JSON.stringify([frozen, frozenMass, inlandFrozen, sheetFrozen, hours, airMean, seaWhite, budget, overturnMass])');
h.update(sc);
console.log(cfgName, h.digest('hex').slice(0, 16), parts.join(' '));
