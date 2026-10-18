// diagnostics for the paper: unfreezable and melted-back water, warming by latitude, land snow, rain, overturning
const E=globalThis.__ev, els=globalThis.__E2;const step=()=>{for(const f of globalThis.__L['step:click'])f();};
const W=E('W'),H=E('H'),RES=E('RES'),grid=E('grid'),kind=E('kind'),phi=E('phi'),T=E('T'),depth=E('depth'),cos=E('cosLat'),airT=E('airT'),clim=E('airTclim'),cell=E('airCell'),T0surf=E('T0surf'),mpo=E('meltPtOpen');
const out=[];
for(const d of [30,90,180,365,730,1460,2920]){while(E('hours/24')<d-1)step();
 let ocean=0,never=0,never_hot=0,melted=0,shelfMelt=0,shelf=0;const bands=[[60,90],[30,60],[0,30],[-30,0],[-60,-30],[-90,-60]],bw=bands.map(()=>[0,0,0,0]);
 for(let i=0;i<W*H;i++){if(grid[i]===1||kind[i])continue;const r=(i/W)|0,a=cos[r];ocean+=a;const lat=90-(r+.5)/RES;
  if(grid[i]===0){never+=a;if(T[i]>=mpo(i))never_hot+=a;}
  else if(phi[i]<0.01){melted+=a;if(depth[i]<=200)shelfMelt+=a;}
  if(depth[i]<=200)shelf+=a;
  const b=bands.findIndex(([lo,hi])=>lat>=lo&&lat<hi);if(b>=0){bw[b][0]+=a;bw[b][1]+=(T[i]-T0surf[i])*a;}}
 const AW=360;for(let ra=0;ra<180;ra++){const lat=89.5-ra,c=Math.cos(lat*Math.PI/180);const b=bands.findIndex(([lo,hi])=>lat>=lo&&lat<hi);for(let q=0;q<AW;q++){const a=ra*AW+q;bw[b][2]+=c;bw[b][3]+=(airT[a]-clim[a])*c;}}
 out.push({day:d, air:+E('airMean').toFixed(2), frozen:els.pct.innerHTML.replace(/<[^>]+>/g,''), unreached_pct:(100*never/ocean).toFixed(2), unreached_above_mp_pct:(100*never_hot/ocean).toFixed(2), melted_back_pct:(100*melted/ocean).toFixed(2), melted_back_shelf_pct_of_shelf:(100*shelfMelt/shelf).toFixed(1),
  sea_warming_by_band:bands.map((b,k)=>b.join('..')+':'+(bw[k][1]/bw[k][0]).toFixed(1)).join(' '), air_warming_by_band:bands.map((b,k)=>b.join('..')+':'+(bw[k][3]/bw[k][2]).toFixed(1)).join(' '),
  cloud:(()=>{const c=E('cloud');let s=0,w=0;for(let r=0;r<180;r++){const k=Math.cos((89.5-r)*Math.PI/180);for(let q=0;q<360;q++){s+=c[r*360+q]*k;w+=k;}}return (s/w).toFixed(3);})(), land:els.landV.textContent, deep:els.deepV.textContent});
 console.log(JSON.stringify(out[out.length-1]));}
