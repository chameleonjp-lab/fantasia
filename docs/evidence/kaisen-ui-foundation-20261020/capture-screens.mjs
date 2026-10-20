import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const out='/workspace/fantasia-work/parity-screens';await mkdir(out,{recursive:true});
const projects=[['kaisen','/workspace/kaisen-reference',4180],['main','/workspace/fantasia-main-reference',4181],['candidate','/workspace/fantasia-kaisen-ui',4184]];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function drain(p){
 const f=await p.evaluateHandle(()=>{const gl=document.querySelector('#flight').getContext('webgl2');if(!gl||gl.isContextLost())throw Error('No actual WebGL2');const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();return{gl,sync};});
 try{let done=false;for(let n=0;n<500;n++){done=await f.evaluate(({gl,sync})=>{const r=gl.clientWaitSync(sync,0,0);if(r===gl.WAIT_FAILED)throw Error('Native fence failed');return r===gl.ALREADY_SIGNALED||r===gl.CONDITION_SATISFIED;});if(done)break;await new Promise(r=>setTimeout(r,20));}if(!done)throw Error('Native fence exceeded 10s');}finally{await f.evaluate(({gl,sync})=>gl.deleteSync(sync));await f.dispose();}
}
async function step(p,ms=16){await drain(p);await p.clock.runFor(ms);}
async function read(p){return p.evaluate(()=>{const s=(window.__fantasiaReadState||window.__kaisenReadState)(false);return{phase:s.phase,screen:s.screen,mode:s.mode,tick:s.tick,activeTicks:s.activeTicks,status:s.status,player:s.player,controlsInput:s.controlsInput,pauseReasons:s.pauseReasons,result:s.result??s.campaign?.resultSnapshot,render:s.render};});}
async function click(p,s){const l=p.locator(s);await l.scrollIntoViewIfNeeded();const r=await l.boundingBox();if(!r)throw Error('Missing '+s);const hit=await l.evaluate(n=>{const r=n.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n===h||n.contains(h);});if(!hit)throw Error('Covered native target '+s);await p.mouse.click(r.x+r.width/2,r.y+r.height/2);}
for(const[name,dir,port]of projects){
 const p=await browser.newPage({viewport:{width:393,height:852},hasTouch:true,deviceScaleFactor:1}),errors=[];p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(String(e)));
 const source={commit:execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),trackedDiffSha256:createHash('sha256').update(execFileSync('git',['-C',dir,'diff','--binary'])).digest('hex')};
 const capture=async(screen)=>{const before=await read(p),png=await p.screenshot(),after=await read(p);const id=`${name}-393x852-${screen}-100`;await writeFile(`${out}/${id}.png`,png);await writeFile(`${out}/${id}.json`,JSON.stringify({id,source,capturedAt:new Date().toISOString(),browser:browser.version(),viewport:{width:393,height:852},textScale:1,dpr:1,method:'actual WebGL2, native UI input, controlled animation, no state injection',errors:[...errors],before,after,stationary:before.tick===after.tick,image:{file:id+'.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')}},null,2));console.log(id,before.phase,before.tick);};
 const start=async(mode)=>{await click(p,`label:has(input[value="${mode}"])`);await click(p,'#start');for(let n=0;n<80;n++){if((await read(p)).phase==='playing')return;await step(p);}throw Error('Did not reach playing');};
 try{
 await p.clock.install({time:'2026-01-01T00:00:00Z'});await p.clock.pauseAt('2026-01-01T00:00:01Z');await p.goto(`http://127.0.0.1:${port}`);for(let n=0;n<80&&!await p.locator('#start').isEnabled();n++){await p.clock.runFor(16);await new Promise(r=>setTimeout(r,40));}if(!await p.locator('#start').isEnabled())throw Error('Renderer not ready');
 if(process.argv.includes('--fonts-only')){
  await start('normal');await step(p);const cdp=await p.context().newCDPSession(p);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument');const fonts=[];
  for(const selector of ['#timer','#health','#altitude','#loop > span','#loop > b','#bomb-ammo']){
   const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
   fonts.push({selector,computed:await p.locator(selector).evaluate(n=>{const s=getComputedStyle(n);return{family:s.fontFamily,size:s.fontSize,lineHeight:s.lineHeight,text:n.textContent};}),...await cdp.send('CSS.getPlatformFontsForNode',{nodeId})});
  }
  await writeFile(`${out}/${name}-platform-fonts.json`,JSON.stringify({source,browser:browser.version(),viewport:{width:393,height:852},fonts},null,2));await cdp.detach();console.log(name,'platform-fonts-recorded');continue;
 }
 if(process.argv.includes('--pause-only')){
  await start('normal');await step(p);await click(p,'#pause');
  for(let n=0;n<8;n++){await step(p);if(await p.locator('#resume').isEnabled())break;}
  if(!await p.locator('#resume').isEnabled())throw Error('Actual paused renderer did not acknowledge');
  await capture('pause');continue;
 }
 if(process.argv.includes('--poses')){
  for(const[label,key,frames]of [['level',null,0],['bank-left','ArrowLeft',24],['climb','ArrowUp',24],['loop','l',18]]){
   await start('normal');if(key)await p.keyboard.down(key);for(let n=0;n<frames;n++)await step(p);if(key)await p.keyboard.up(key);await step(p);
   const s=await read(p);if(s.phase!=='playing'||label==='bank-left'&&Math.abs(s.player.bank)<.05||label==='climb'&&s.player.pitch<.05||label==='loop'&&s.player.loopProgress<=0)throw Error('Requested pose did not occur: '+label);
   await capture('pose-'+label);await click(p,'#pause');await step(p);await click(p,'#pause-home');
  }
  continue;
 }
 await capture('home');await click(p,'#home-rules');await capture('rules');await click(p,'#rules-close');
 await click(p,'#home-controls');await click(p,'#control-editor-touch');await capture('touch-settings');await click(p,'#control-editor-keyboard');await capture('keyboard-settings');await click(p,'#control-close');
 await start('normal');await step(p);await capture('normal');
 await click(p,'#pause');await step(p);await capture('pause');await click(p,'#pause-home');
 await start('easy');await step(p);await capture('easy');
 await p.keyboard.down('ArrowDown');const deadline=Date.now()+240000;let steps=0;
 while((await read(p)).phase!=='ended'&&Date.now()<deadline){const s=await read(p);if(s.phase==='paused')throw Error('Actual run paused '+s.pauseReasons);if(s.phase==='respawning'){await p.keyboard.up('ArrowDown');await step(p,48);}else{await p.keyboard.down('ArrowDown');await step(p,48);}if(++steps%100===0)console.log(name,'natural-result-progress',steps,(await read(p)).phase,(await read(p)).tick);}
 await p.keyboard.up('ArrowDown');if((await read(p)).phase!=='ended')throw Error('Natural result exceeded four minute bound');await capture('result');
 }catch(e){const id=name+'-blocked';console.log(id,String(e));await p.screenshot({path:`${out}/${id}.png`}).catch(()=>{});await writeFile(`${out}/${id}.json`,JSON.stringify({source,failure:String(e),errors,state:await read(p).catch(()=>null)},null,2));}finally{await p.close();}
}
await browser.close();
