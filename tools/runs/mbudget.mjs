const E=globalThis.__ev;const step=()=>{for(const f of globalThis.__L['step:click'])f();};
const m=()=>E(`(()=>{let salt=0,ocean=0;for(let i=0;i<W*H;i++){if(grid[i]===1||kind[i])continue;const c=cosLat[(i/W)|0];salt+=sal[i]*cap[i]*c+sald[i]*capd[i]*c;ocean+=(cap[i]+capd[i])*c;}
 let sw=0;for(const i of landList)sw+=snow[i]*cosLat[(i/W)|0];const cellM2=(111.2e3/RES)**2;return {salt,ocean,snowM3:sw*cellM2,oceanM3:ocean*3700*cellM2};})()`);
const a=m();
for(const d of [90,365,1095]){while(E('hours/24')<d-0.01)step();const b=m();
 console.log(`day ${d}: salt change ${((b.salt-a.salt)/a.salt).toExponential(2)} (relative) | snow water ${(b.snowM3/1e9).toFixed(0)} km³ = ${(b.snowM3/b.oceanM3*100).toFixed(4)}% of ocean volume (${(b.snowM3/361.9e12).toFixed(2)} m of ocean depth), not removed from the ocean`);}
