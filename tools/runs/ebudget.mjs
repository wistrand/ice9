// energy budget: stores from state against the boundary fluxes accumulated by the app; units: ocean-column cap*K, area-weighted
const E=globalThis.__ev;const step=()=>{for(const f of globalThis.__L['step:click'])f();};
const stores=()=>E(`(()=>{const l=latentK(),N=W*H;let sea=0,deep=0,sheet=0,inland=0,air=0,sn=0,lat=0,sT=0,sP=0;
 for(let i=0;i<N;i++){const r=(i/W)|0,c=cosLat[r],k=kind[i];if(grid[i]===1&&k!==2)continue;
  if(k===3){sheet+=cap[i]*c*T[i]-2*Math.max(0,l-80)*cap[i]*c*phi[i];continue;}
  const ci=useDepth()?cap[i]:1,li=l?latentPerPhi(i):0,h=ci*c*((1-0.5*phi[i])*T[i]-(l?phi[i]*(li-0.5*MELT):0));
  if(k)inland+=h;else{sea+=h;sT+=ci*c*(1-0.5*phi[i])*T[i];sP+=ci*c*phi[i];} lat+=ci*c*phi[i]*li;
  if(floatMode&&capd[i]>0){deep+=capd[i]*c*((1-0.5*phid[i])*Td[i]-(l?phid[i]*(l-0.5*MELT):0));lat+=capd[i]*c*phid[i]*l;}}
 for(let r=0;r<AH;r++){const w=AIR_C*RES*RES*cosLat[(r*RES)|0],wl=3600/CAP_J*RES*RES*cosLat[(r*RES)|0];for(let q=0;q<AW;q++){air+=airT[r*AW+q]*w;air+=(typeof latentAir!=='undefined'?latentAir[r*AW+q]:0)*wl;}}
 {const lj=latentK()*4180*1000/CAP_J;for(const i of landList)sn-=snow[i]*lj*cosLat[(i/W)|0];}
 return {sea,deep,sheet,inland,air,snow:sn,lat,sT,sP,flux:budget.sea+budget.air+budget.vent-budget.season,b:{...budget}};})()`);
const s0=stores();const tot=o=>o.sea+o.deep+o.sheet+o.inland+o.air+o.snow;
const days=(process.env.DAYS||'30,90,365').split(',').map(Number);
for(const d of days){while(E('hours/24')<d-0.01)step();const s=stores();const dE=tot(s)-tot(s0),res=dE+s.flux;
 const part=k=>(s[k]-s0[k]).toExponential(2);
 console.log(`day ${d}: dE ${dE.toExponential(3)} + out ${s.flux.toExponential(3)} = residual ${res.toExponential(3)} | residual/latent ${(res/s.lat*100).toFixed(3)}% | d sea ${part('sea')} deep ${part('deep')} sheet ${part('sheet')} inland ${part('inland')} air ${part('air')} snow ${part('snow')} | seaT ${part('sT')} seaPhi ${part('sP')} | out sea ${s.b.sea.toExponential(2)} air ${s.b.air.toExponential(2)} vent ${s.b.vent.toExponential(2)} season ${s.b.season.toExponential(2)}`);}
