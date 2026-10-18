// Pixel hash of the globe over 5 views x satellite x natural colour x night x currents, plus blitGlobe timing. usage: node globetest.mjs <dir with data/> <app.js> <sat.rgba from prepare.sh>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const [,, appDir, file, satRaw] = process.argv;
let seed = 12345; Math.random = () => { seed = (seed*1664525+1013904223)>>>0; return seed/4294967296; };
const els = {}, listeners = {};
const ctx2d = {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),drawImage(){},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},arc(){},setLineDash(){}};
const mk = id => els[id] ??= {id,checked:true,value:'50',textContent:'',innerHTML:'',hidden:false,disabled:false,style:{},className:'',tagName:'DIV',width:0,height:0,clientWidth:200,clientHeight:40,classList:{toggle(){}},getContext:()=>ctx2d,getBoundingClientRect:()=>({left:0,top:0,width:900,height:900}),setPointerCapture(){},closest:()=>null,addEventListener:(t,f)=>{(listeners[id+':'+t]??=[]).push(f);}};
mk('res').options = [];
for (const [k,v] of Object.entries({speed:'100',rate:'51',lat:'93',cool:'4',solid:'0',mix:'4',leads:'0',res:'2',globe:true,satellite:false,showcur:false,showair:false,showphi:false,natural:false,life:false,floats:false})) {const e = mk(k); if (typeof v === 'boolean') e.checked = v; else e.value = v;}
globalThis.document = {getElementById:mk,createElement:()=>({...mk('c'+Math.random()),getContext:()=>ctx2d}),documentElement:{dataset:{}},querySelector:()=>mk('sub')};
globalThis.matchMedia = () => ({matches:false,addEventListener(){}}); globalThis.MutationObserver = class{observe(){}}; globalThis.ResizeObserver = class{observe(){}};
globalThis.requestAnimationFrame = () => {}; globalThis.devicePixelRatio = 1; globalThis.getComputedStyle = () => ({getPropertyValue:()=>'#000'}); globalThis.Image = class{set src(v){}};
globalThis.fetch = async u => new Response(fs.readFileSync(path.join(appDir, u)));
await (0,eval)(fs.readFileSync(file,'utf8').replace(/^\(async function\(\) ?\{/, 'globalThis.__app=(async function(){globalThis.__ev=s=>eval(s);')); await globalThis.__app;
const E = s => globalThis.__ev(s);
globalThis.__sat = new Uint8ClampedArray(fs.readFileSync(satRaw).buffer.slice(0));
for (let k = 0; k < 12; k++) for (const f of listeners['step:click']) f();
E('fit()');
const views = [[-60, 20, 1], [-165, 5, 1], [20, 72, 1], [100, -40, 2.5], [0, 0, 0.6]];
const h = crypto.createHash('sha256');
for (const sat of [false, true]) for (const nat of [false, true]) for (const solar of [true, false]) for (const cur of [false, true]) {
  els.showcur.checked = cur;
  els.satellite.checked = sat; els.natural.checked = nat; els.solar.checked = solar;
  E(sat ? 'satPixels = globalThis.__sat' : 'satPixels = null');
  for (const [lo, la, z] of views) {
    E(`lon0 = ${lo}*Math.PI/180; lat0 = ${la}*Math.PI/180; zoom = ${z}`);
    E('draw()');
    h.update(Buffer.from(E('globeImg').data.buffer));
  }
}
let n = 20, s = performance.now();
for (let k = 0; k < n; k++) E('blitGlobe()');
const same = (performance.now()-s)/n;
s = performance.now();
for (let k = 0; k < n; k++) { E(`lon0 += 0.01`); E('blitGlobe()'); }
const rot = (performance.now()-s)/n;
console.log(h.digest('hex').slice(0, 16), 'blitGlobe same view %s ms, rotating %s ms'.replace('%s', same.toFixed(1)).replace('%s', rot.toFixed(1)));
