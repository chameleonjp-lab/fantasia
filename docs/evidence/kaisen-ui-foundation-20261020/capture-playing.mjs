import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='/workspace/fantasia-work/parity-p0';await mkdir(root,{recursive:true});
const projects=process.argv.includes('--candidate')?[['candidate','/workspace/fantasia-kaisen-ui',4184]]:[['kaisen','/workspace/kaisen-reference',4180],['main','/workspace/fantasia-main-reference',4181],['pr20','/workspace/fantasia-pr20-reference',4182],['pr21','/workspace/fantasia-pr21-reference',4183]];
const profiles=process.argv.includes('--remaining')?[[852,393,1],[320,568,1],[568,320,1],[393,852,2],[852,393,2]]:process.argv.includes('--full')?[[393,852,1],[852,393,1],[320,568,1],[568,320,1],[393,852,2],[852,393,2],[320,568,2],[568,320,2]]:[[320,568,2],[568,320,2],[393,852,1]];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const tick=async p=>{
 const fence=await p.evaluateHandle(()=>{const gl=document.querySelector('#flight').getContext('webgl2');if(!gl||gl.isContextLost())throw Error('Missing actual WebGL2');const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();return {gl,sync};});
 try{let ready=false;for(let n=0;n<500;n++){ready=await fence.evaluate(o=>{const r=o.gl.clientWaitSync(o.sync,0,0);if(r===o.gl.WAIT_FAILED)throw Error('Native GPU wait failed');return r===o.gl.ALREADY_SIGNALED||r===o.gl.CONDITION_SATISFIED;});if(ready)break;await new Promise(r=>setTimeout(r,20));}if(!ready)throw Error('Native GPU wait exceeded 10s');}finally{await fence.evaluate(o=>o.gl.deleteSync(o.sync));await fence.dispose();}
 await p.clock.runFor(16);
};
const click=async(p,s)=>{const n=p.locator(s);const r=await n.boundingBox();if(!r)throw Error('Missing control '+s);await p.mouse.click(r.x+r.width/2,r.y+r.height/2);};
for(const[name,dir,port]of projects)for(const[w,h,scale]of profiles)for(const mode of ['normal','easy']){
 if(process.argv.includes('--case')&&`${name}-${w}x${h}-${mode}-${scale*100}`!==process.argv[process.argv.indexOf('--case')+1])continue;
 const id=`${name}-${w}x${h}-${mode}-${scale*100}`;const p=await browser.newPage({viewport:{width:w,height:h},hasTouch:true,deviceScaleFactor:1});p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(String(e)));
 const meta={id,capturedAt:new Date().toISOString(),source:execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),browser:browser.version(),viewport:{width:w,height:h},dpr:1,textScale:scale,mode,clock:'controlled animation, actual WebGL2, native UI input, no state injection',errors};
 try{
 await p.clock.install({time:'2026-01-01T00:00:00Z'});await p.clock.pauseAt('2026-01-01T00:00:01Z');await p.goto(`http://127.0.0.1:${port}`);
 for(let f=0;f<80&&!await p.locator('#start').isEnabled();f++){await p.clock.runFor(16);await new Promise(r=>setTimeout(r,40));}
 if(!await p.locator('#start').isEnabled())throw Error('Renderer did not prepare');
 await click(p,`label:has(input[value="${mode}"])`);await click(p,'#start');
 for(let f=0;f<80;f++){const phase=await p.evaluate(()=>(window.__fantasiaReadState||window.__kaisenReadState)(false).phase);if(phase==='playing')break;await tick(p);}
 if(scale===2)await p.evaluate(()=>{const nodes=[...document.querySelectorAll('#app *')].filter(n=>!['CANVAS','SCRIPT','STYLE'].includes(n.tagName));const fonts=nodes.map(n=>[n,parseFloat(getComputedStyle(n).fontSize)]);for(const[n,size]of fonts)n.style.setProperty('font-size',size*2+'px','important');});
 await tick(p);await tick(p);
 const read=()=>p.evaluate(()=>{const s=(window.__fantasiaReadState||window.__kaisenReadState)(false);return{phase:s.phase,screen:s.screen,mode:s.mode,tick:s.tick,player:s.player,controlsInput:s.controlsInput,render:s.render,seed:s.seed};});
 meta.before=await read();if(meta.before.phase!=='playing')throw Error('Actual app is '+meta.before.phase);
 meta.fonts=await p.evaluate(()=>Object.fromEntries(['#timer','#health','#altitude','#speed','#fire','#loop','#bomb','#throttle'].map(s=>{const n=document.querySelector(s);return[s,n?{font:getComputedStyle(n).fontSize,rect:n.getBoundingClientRect().toJSON(),inline:n.getAttribute('style')}:null];})));
 const png=await p.screenshot();meta.after=await read();meta.stationary=meta.before.tick===meta.after.tick;meta.image={file:id+'.png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')};await writeFile(`${root}/${id}.png`,png);console.log(id,meta.before.phase,meta.before.render?.hudLayout?.status??'K reference');
 }catch(e){meta.failure=String(e);await p.screenshot({path:`${root}/${id}-blocked.png`}).catch(()=>{});console.log(id,'BLOCKED',String(e));}
 await writeFile(`${root}/${id}.json`,JSON.stringify(meta,null,2));await p.close();
}await browser.close();
