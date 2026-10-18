// Depth-band table for the paper (sinking, 0.5 deg): solid fraction, temperature and share frozen through by depth. usage: node depth.mjs <appDir>
import fs from 'node:fs'; import path from 'node:path';
const [,, appDir] = process.argv; const els={}; const listeners={};
const ctx2d={createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),drawImage(){},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},arc(){},setLineDash(){}};
const mk=id=>els[id]??={id,checked:true,value:'50',textContent:'',innerHTML:'',hidden:false,style:{},className:'',tagName:'DIV',width:0,height:0,clientWidth:200,clientHeight:40,classList:{toggle(){}},getContext:()=>ctx2d,getBoundingClientRect:()=>({left:0,top:0,width:1440,height:720}),setPointerCapture(){},closest:()=>null,addEventListener:(t,f)=>{(listeners[id+':'+t]??=[]).push(f);}};
mk('res').options=[];
for(const [k,v] of Object.entries({speed:'100',rate:'51',lat:'93',cool:'4',solid:'0',mix:'4',leads:'0',res:'2',globe:false,satellite:false,showcur:false,showair:false,solar:false,floats:false,life:false})){const e=mk(k);if(typeof v==='boolean')e.checked=v;else e.value=v;}
globalThis.document={getElementById:mk,createElement:()=>({...mk('c'+Math.random()),getContext:()=>ctx2d}),documentElement:{dataset:{}},querySelector:()=>mk('sub')};
globalThis.matchMedia=()=>({matches:false,addEventListener(){}});globalThis.MutationObserver=class{observe(){}};globalThis.ResizeObserver=class{observe(){}};
globalThis.requestAnimationFrame=()=>{};globalThis.devicePixelRatio=1;globalThis.getComputedStyle=()=>({getPropertyValue:()=>'#000'});globalThis.Image=class{set src(v){}};
globalThis.fetch=async u=>new Response(fs.readFileSync(path.join(appDir,u)));
await (0,eval)(fs.readFileSync(path.join(appDir,'app.js'),'utf8').replace(/^\(async function\(\) ?\{/,'globalThis.__app=(async function(){'));await globalThis.__app;
const bins=[[0,100],[100,200],[200,500],[500,1500],[1500,3000],[3000,4500],[4500,20000]];
let k=0;for(const st of [30,600,1500]){for(;k<st;k++)for(const f of listeners['step:click'])f();const d=__dbg();
 console.log(`== frame ${st}, ${(d.hours/24/365).toFixed(2)} yr   depth band: cells, mean solid fraction, mean T, share fully locked, share unseeded`);
 for(const [a,b] of bins){let n=0,sp=0,st_=0,full=0,un=0;for(let i=0;i<d.grid.length;i++){if(d.grid[i]===1||d.kind[i])continue;const z=d.depth[i];if(z<a||z>=b)continue;const w=d.cosLat[(i/d.W)|0];n+=w;sp+=d.phi[i]*w;st_+=d.T[i]*w;if(d.phi[i]>=0.999)full+=w;if(d.grid[i]===0)un+=w;}
  console.log(`  ${String(a).padStart(5)}-${String(b).padEnd(5)} m: ${(n).toFixed(0).padStart(7)}  phi ${(sp/n).toFixed(3)}  T ${(st_/n).toFixed(1)} C  locked ${(100*full/n).toFixed(1)}%  unseeded ${(100*un/n).toFixed(1)}%`);}}
