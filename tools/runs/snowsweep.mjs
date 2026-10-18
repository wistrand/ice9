// Snow deposition sensitivity: patches crystal lofting, freezing threshold, washout and land rain in app.js, runs the sinking case at 1°
// for a year, and prints land snow cover overall, in deserts (<250 mm/yr today) and in interiors (>~1000 km from the sea).
// env: APP (app dir), LOFT, THRESH, WASH (multipliers), RB (today's land rain factor), RX (extra-rain factor), OUT (json file)
import fs from 'node:fs'; import path from 'node:path';
const appDir = process.env.APP; // the prepared app copy (prepare.sh)
let sd = 7; Math.random = () => { sd = (sd*1664525+1013904223)>>>0; return sd/4294967296; };
const E_ = (k, d) => +(process.env[k] ?? d);
const LOFT = E_('LOFT', 1), THRESH = E_('THRESH', 1), WASH = E_('WASH', 1), RB = E_('RB', 1), RX = E_('RX', 1);
const els = {}, listeners = {};
const ctx2d = {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),drawImage(){},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},arc(){},setLineDash(){}};
const mk = id => els[id] ??= {id,checked:true,value:'50',textContent:'',innerHTML:'',hidden:false,disabled:false,style:{},className:'',tagName:'DIV',width:0,height:0,clientWidth:200,clientHeight:40,classList:{toggle(){}},getContext:()=>ctx2d,getBoundingClientRect:()=>({left:0,top:0,width:1440,height:720}),setPointerCapture(){},closest:()=>null,addEventListener:(t,f)=>{(listeners[id+':'+t]??=[]).push(f);}};
mk('res').options = [];
for (const [k,v] of Object.entries({speed:'100',rate:'51',lat:'93',cool:'4',solid:'0',mix:'4',leads:'0',res:'1',globe:false,satellite:false,showcur:false,showair:false,showphi:false,floats:false,life:false,snowfall:true,
  wash:String(50-50*Math.log10(WASH)/Math.log10(7)), loft:String(50+50*Math.log10(1/LOFT)/2), thresh:String(50+50*Math.log10(THRESH)/2)})) {const e = mk(k); if (typeof v === 'boolean') e.checked = v; else e.value = v;}
globalThis.document = {getElementById:mk,createElement:()=>({...mk('c'+Math.random()),getContext:()=>ctx2d}),documentElement:{dataset:{}},querySelector:()=>mk('sub')};
globalThis.matchMedia = () => ({matches:false,addEventListener(){}}); globalThis.MutationObserver = class{observe(){}}; globalThis.ResizeObserver = class{observe(){}};
globalThis.requestAnimationFrame = () => {}; globalThis.devicePixelRatio = 1; globalThis.getComputedStyle = () => ({getPropertyValue:()=>'#000'}); globalThis.Image = class{set src(v){}};
globalThis.fetch = async u => new Response(fs.readFileSync(path.join(appDir, u)));
let src = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
const sub = (a, b) => { if (!src.includes(a)) throw new Error('patch target missing: '+a); src = src.replace(a, b); };
sub('landRain[a] = excess >= 0 ? landPrecip[a]+excess*rainPerVapour : landPrecip[a]*vapRatio;', `landRain[a] = excess >= 0 ? ${RB}*landPrecip[a]+${RX}*excess*rainPerVapour : ${RB}*landPrecip[a]*vapRatio;`);
await (0,eval)(src.replace(/^\(async function\(\) ?\{/, 'globalThis.__app=(async function(){globalThis.__ev=s=>eval(s);')); await globalThis.__app;
const E = s => globalThis.__ev(s);
const step = () => {for (const f of listeners['step:click']) f();};
// classes: desert by today's rain, interior by distance (in 1° air cells, about 111 km each) from the nearest sea air cell
const cls = E(`(()=>{const sea=new Uint8Array(AN);for(let i=0;i<W*H;i++)if(grid[i]!==1&&kind[i]===0)sea[airCell[i]]=1;
 const dist=new Int16Array(AN).fill(-1),qu=[];for(let a=0;a<AN;a++)if(sea[a]){dist[a]=0;qu.push(a);}
 for(let h=0;h<qu.length;h++){const a=qu[h],r=(a/AW)|0,q=a%AW;for(const [dr,dq] of [[1,0],[-1,0],[0,1],[0,-1]]){const r2=r+dr;if(r2<0||r2>=AH)continue;const b=r2*AW+(q+dq+AW)%AW;if(dist[b]<0){dist[b]=dist[a]+1;qu.push(b);}}}
 return {desert:Array.from(landList,i=>landPrecip[airCell[i]]*8760<0.25?1:0),interior:Array.from(landList,i=>dist[airCell[i]]>=9?1:0)};})()`);
const measure = () => E(`(()=>{let w=[0,0,0],n=[0,0,0];const cls=globalThis.__cls;for(let k=0;k<landList.length;k++){const i=landList[k],c=cosLat[(i/W)|0],v=Math.min(1,snow[i]/SNOW_MASK)*c;w[0]+=v;n[0]+=c;if(cls.desert[k]){w[1]+=v;n[1]+=c;}if(cls.interior[k]){w[2]+=v;n[2]+=c;}}return w.map((x,j)=>+(100*x/n[j]).toFixed(1));})()`);
globalThis.__cls = cls;
const out = {LOFT, THRESH, WASH, RB, RX}; let summerMin = [101, 101, 101];
for (let k = 0; E('hours/24') < 365; k++) {
  step(); const d = E('hours/24');
  if (d > 200 && d < 365) { const m = measure(); summerMin = summerMin.map((x, j) => Math.min(x, m[j])); }
  for (const t of [30, 90]) if (!out['d'+t] && d >= t) out['d'+t] = measure();
}
out.d365 = measure(); out.summerMin = summerMin;
fs.writeFileSync(process.env.OUT, JSON.stringify(out)); console.log(JSON.stringify(out));
