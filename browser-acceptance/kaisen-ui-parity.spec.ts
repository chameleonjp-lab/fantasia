import {test,expect} from '@playwright/test';
import {RealRendererDriver} from './real-driver';
import {neutral} from './acceptance-helpers';

for(const mode of ['normal','easy'] as const) for(const viewport of [{width:320,height:568},{width:568,height:320}]) {
  test(`${mode} saved Kaisen control centres and sizes survive enlarged text at ${viewport.width}x${viewport.height}`,async({page},info)=>{
    await page.setViewportSize(viewport);
    const d=new RealRendererDriver(page),evidence:any[]=[];
    try {
      await d.boot();await d.click(`label:has(input[value="${mode}"])`);
      await d.click('#home-controls');await d.click('#control-editor-touch');
      await page.locator('#control-mode').selectOption(mode);
      await page.locator('#control-target').selectOption('loop');
      for(const [id,key,count] of [['control-x','ArrowLeft',6],['control-y','ArrowLeft',4],['control-size','ArrowRight',3]] as const){
        await page.locator('#'+id).focus();for(let n=0;n<count;n++)await page.keyboard.press(key);
      }
      await d.click('#control-save');await d.step();
      const stored=await page.evaluate(mode=>localStorage.getItem(mode==='normal'?'fantasia-controls-v2':'fantasia-controls-easy-v2'),mode);
      expect(stored).toBeTruthy();await d.start(mode);
      const inspect=async(scale:number)=>{
        const boxes=await page.evaluate(()=>[...document.querySelectorAll<HTMLElement>('#hud [data-flight-control]')].filter(n=>!n.closest('[hidden]')&&n.getClientRects().length).map(n=>{
          const r=n.getBoundingClientRect(),s=getComputedStyle(n),read=(name:string)=>parseFloat(s.getPropertyValue(name));
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-flight-control]');
          return {id:n.id,hit:hit?.id??null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},expected:{x:read('--control-x')/100*innerWidth,y:read('--control-y')/100*innerHeight,width:read('--control-size'),height:read(n.id==='throttle'?'--control-height':'--control-size')},offset:{x:s.getPropertyValue('--campaign-hud-x'),y:s.getPropertyValue('--campaign-hud-y')}};
        }));evidence.push({scale,boxes,state:await d.read()});
        expect(boxes.map(b=>b.id).sort()).toEqual(mode==='normal'?['bomb','fire','loop','throttle']:['bomb','loop']);
        for(const b of boxes){
          expect(b.hit,b.id+' native centre hit target').toBe(b.id);
          expect(Math.abs(b.rect.x+b.rect.width/2-b.expected.x),b.id+' horizontal centre').toBeLessThanOrEqual(.03);
          expect(Math.abs(b.rect.y+b.rect.height/2-b.expected.y),b.id+' vertical centre').toBeLessThanOrEqual(.03);
          expect(b.rect.width,b.id+' saved width').toBeCloseTo(b.expected.width,1);
          expect(b.rect.height,b.id+' saved height').toBeCloseTo(b.expected.height,1);
        }
      };
      await inspect(1);
      await page.evaluate(()=>{const nodes=[...document.querySelectorAll<HTMLElement>('#app *')].filter(n=>!['CANVAS','SCRIPT','STYLE'].includes(n.tagName));const sizes=nodes.map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize)}));for(const{node,size}of sizes)node.style.setProperty('font-size',`${size*2}px`,'important');});
      await d.nextTick();await inspect(2);await neutral(d);
      expect(await page.evaluate(mode=>localStorage.getItem(mode==='normal'?'fantasia-controls-v2':'fantasia-controls-easy-v2'),mode)).toBe(stored);
    } finally {
      await info.attach('kaisen-control-geometry',{body:Buffer.from(JSON.stringify({viewport,mode,evidence,pageErrors:d.pageErrors})),contentType:'application/json'});
      await info.attach('kaisen-control-screen',{body:await page.screenshot(),contentType:'image/png'});
    }
  });
}
