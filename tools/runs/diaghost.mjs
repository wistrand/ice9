// Diagnostics at fixed days (JSON lines): frozen, unreached and melted-back water, sea and air warming by latitude band, clouds, land snow, deep layer. usage: node diaghost.mjs <appDir> <floats 0|1> x 0
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const [,, appDir, fl, outPrefix, ...stops] = process.argv; const els={}; const listeners={};
const ctx2d={createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),drawImage(){},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},arc(){},setLineDash(){}};
const mk=id=>els[id]??={id,checked:true,value:'50',textContent:'',innerHTML:'',hidden:false,style:{},className:'',tagName:'DIV',width:0,height:0,clientWidth:200,clientHeight:40,classList:{toggle(){}},getContext:()=>ctx2d,getBoundingClientRect:()=>({left:0,top:0,width:1440,height:720}),setPointerCapture(){},closest:()=>null,addEventListener:(t,f)=>{(listeners[id+':'+t]??=[]).push(f);}};
mk('res').options=[];
for(const [k,v] of Object.entries({speed:'100',rate:'51',lat:'93',cool:'4',solid:'0',mix:'4',res:'2',globe:false,satellite:false,showcur:false,showair:false,solar:true,floats:fl==='1',life:false,currents:process.env.CURRENTS!=='0',showphi:process.env.SHOWPHI==='1'})){const e=mk(k);if(typeof v==='boolean')e.checked=v;else e.value=v;}
globalThis.document={getElementById:mk,createElement:()=>({...mk('c'+Math.random()),getContext:()=>ctx2d}),documentElement:{dataset:{}},querySelector:()=>mk('sub')};
globalThis.matchMedia=()=>({matches:false,addEventListener(){}});globalThis.MutationObserver=class{observe(){}};globalThis.ResizeObserver=class{observe(){}};
globalThis.requestAnimationFrame=()=>{};globalThis.devicePixelRatio=1;globalThis.getComputedStyle=()=>({getPropertyValue:()=>'#000'});globalThis.Image=class{set src(v){}};
globalThis.fetch=async u=>new Response(fs.readFileSync(path.join(appDir,u)));
await (0,eval)(fs.readFileSync(path.join(appDir,'app.js'),'utf8').replace(/^\(async function\(\) ?\{/,'globalThis.__app=(async function(){'));await globalThis.__app;
function png(file,w,h,rgba){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const s=(y*w+x)*4,d=y*(w*3+1)+1+x*3;raw[d]=rgba[s];raw[d+1]=rgba[s+1];raw[d+2]=rgba[s+2];}}
 const crc=b=>{let c=~0;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (~c)>>>0;};
 const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]));}
globalThis.__L=listeners;globalThis.__E2=els;await import("./diag.mjs");
