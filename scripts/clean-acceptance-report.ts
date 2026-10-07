import { assertCaptureCancelled } from '../browser-acceptance/capture-contract';
import { detailAccessIssues, consumedDetailInputIssues, activeFixedStatusIds } from '../browser-acceptance/detail-scroll-contract';
import { detailGeometrySnapshot, textGeometryIssues } from '../browser-acceptance/text-geometry';
import { CASES, titleFor } from '../browser-acceptance/acceptance-cases';

type Json = Record<string, any>;
export async function buildAcceptanceReport(raw: unknown, readAttachment: (path: string) => Promise<string>) {
  const issues: string[] = [], cases: Json[] = [];
  const expected = new Map(CASES.map(row => [titleFor(String(row[0])), row]));
  const seen = new Set<string>();
  const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(raw) || !Array.isArray(raw.suites)) issues.push('Missing/malformed Playwright suites');
  async function visit(suite: Json) {
    if (!isObject(suite)) { issues.push('Malformed suite'); return; }
    if (suite.specs !== undefined && !Array.isArray(suite.specs)) issues.push('Malformed specs');
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (!isObject(spec) || !Array.isArray(spec.tests)) { issues.push('Malformed spec tests'); continue; }
      for (const result of spec.tests) {
        const errors: string[] = [], row = expected.get(spec.title), id = row?.[0];
        if (!row) errors.push('Unexpected title');
        if (seen.has(spec.title)) errors.push('Duplicate case'); seen.add(spec.title);
        if (!isObject(result)) { issues.push('Malformed test result'); continue; }
        if (result.projectName !== 'clean-browser-acceptance') errors.push('Unexpected project');
        if (result.expectedStatus !== 'passed') errors.push('Expected status must be explicitly passed');
        if (result.status !== 'expected') errors.push('Case not cleanly expected');
        if (!Array.isArray(result.results) || result.results.length !== 1) errors.push('Exactly one attempt required');
        const attempts = Array.isArray(result.results) ? result.results : [];
        if (attempts.some((a: any) => !isObject(a) || a.status !== 'passed' || a.error || (Array.isArray(a.errors) ? a.errors.length > 0 : a.errors !== undefined))) errors.push('Failed/skipped/error attempt');
        const attempt = attempts[0]; let evidence: Json | undefined;
        const attachments = isObject(attempt) && Array.isArray(attempt.attachments) ? attempt.attachments : [];
        const matching = attachments.filter((a: any) => isObject(a) && a.name === 'clean-acceptance-evidence');
        if (matching.length !== 1) errors.push('Exactly one evidence attachment required');
        else {
          const attachment = matching[0];
          try {
            if (attachment.contentType !== 'application/json') throw new Error('Wrong evidence content type');
            const body = typeof attachment.body === 'string' ? Buffer.from(attachment.body, 'base64').toString('utf8')
              : typeof attachment.path === 'string' ? await readAttachment(attachment.path) : '';
            const value = JSON.parse(body); if (!isObject(value)) throw new Error('Evidence is not an object'); evidence=value;
          } catch(error) { errors.push(`Unavailable/malformed evidence: ${String(error)}`); }
        }
        if (evidence && row) {
          const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
          if (evidence.schemaVersion!==1 || evidence.id!==id || evidence.category!==row[1] || evidence.outcome!=='passed') errors.push('Evidence identity/outcome mismatch');
          if (evidence.runtimeMocked!==false || evidence.rendererMocked!==false || evidence.applicationQueueModified!==false) errors.push('Real renderer contract missing');
          if (evidence.releaseReady!==false || evidence.performanceAcceptance!=='not-measured' || evidence.physicalDeviceAcceptance!=='unverified') errors.push('Unsupported release/performance/device claim');
          if (!isObject(evidence.backend) || evidence.backend.webgl2!==true || typeof evidence.backend.version!=='string' || typeof evidence.backend.unmaskedRenderer!=='string') errors.push('Native backend evidence missing');
          if (!Array.isArray(evidence.pageErrors) || evidence.pageErrors.length!==0) errors.push('Page errors or missing error evidence');
          if (!Array.isArray(evidence.observations) || evidence.observations.length<2) errors.push('Observations missing');
          if (id==='native-capability') {
            if(evidence.classification!=='ordinary-wall-clock-capability' || evidence.clockInstalled!==false) errors.push('Native clock contract violated');
            if(!['startup-and-bounded-frame-completion','startup-frame-completion-and-one-explicit-safety-recovery'].includes(evidence.capabilityOutcome)) errors.push('Unspecified native outcome');
            const labels=observations.map((o:any)=>o?.label);
            if(!labels.includes('native-startup') || !labels.includes('native-start-completed') || !labels.includes('native-receipt-or-safety')) errors.push('Native evidence stages absent');
            if(evidence.capabilityOutcome==='startup-frame-completion-and-one-explicit-safety-recovery' && !labels.includes('native-deliberate-recovery')) errors.push('Safety recovery evidence absent');
            const stage=(label:string)=>observations.find((o:any)=>o?.label===label);
            const startup=stage('native-startup'),start=stage('native-start-completed'),observed=stage('native-receipt-or-safety');
            if(startup?.phase!=='ready'||startup?.tick!==0||!(startup?.queue?.completedCount>0)) errors.push('Native startup receipt invalid');
            if(!(start?.render?.calls>0)||!(start?.render?.triangles>0)||!Number.isInteger(start?.queue?.completedCount)) errors.push('Native start render evidence invalid');
            if(evidence.capabilityOutcome==='startup-and-bounded-frame-completion') {
              if(observed?.phase!=='playing'||!(observed?.queue?.completedCount>start?.queue?.completedCount)||observed?.pauseReasons?.length!==0) errors.push('Native completed receipt absent');
            } else if(evidence.capabilityOutcome==='startup-frame-completion-and-one-explicit-safety-recovery') {
              const stable=stage('native-paused-stable'),recovered=stage('native-deliberate-recovery');
              if(observed?.phase!=='paused'||observed?.pauseReasons?.length!==1||!['frame','render'].includes(observed.pauseReasons[0])||observed.performanceInterrupted!==true) errors.push('Unspecified native safety stop');
              if(stable?.phase!=='paused'||stable?.tick!==observed?.tick||recovered?.phase!=='playing'||!(recovered?.tick>stable?.tick)||!(recovered?.queue?.completedCount>stable?.queue?.completedCount)||recovered?.pauseReasons?.length!==0) errors.push('Native recovery receipt absent');
            }

          } else {
            if(evidence.classification!=='controlled-clock-functional') errors.push('Functional classification mismatch');
            if(!Number.isInteger(evidence.steps)||evidence.steps<1||evidence.steps>120) errors.push('Invalid controlled step count');
            if(!Number.isInteger(evidence.ownedFencesCreated)||evidence.ownedFencesCreated<1||evidence.ownedFencesCreated!==evidence.ownedFencesReleased) errors.push('Unbalanced/missing owned fences');
            const expectedFault = id==='render-fault' ? 'Canvas2D.clearRect throws once' : id==='frame-gap' ? 'Playwright clock fastForward(400)' : ['storage-failure','storage-session','storage-future-rollback'].includes(String(id)) ? 'Storage.setItem throws' : null;
            if(evidence.faultInjection!==expectedFault) errors.push('Fault injection label mismatch');
            if(!observations.some((o:any)=>o?.label==='case-assertions-completed'&&o.id===id)) errors.push('Case completion evidence missing');
            if(String(id).startsWith('edges-')) for(const control of ['bomb','loop']) {
              const capture=observations.find((o:any)=>o?.label==='native-capture-cancelled-before-up'&&o.control===control);
              try {if(!capture||!Array.isArray(capture.events)||!Array.isArray(capture.heldBeforeUp)) throw new Error('missing capture evidence');
                assertCaptureCancelled(capture.events,capture.pointerId,control,capture.heldBeforeUp);
              } catch {errors.push(`Native ${control} capture cancellation proof absent/invalid`);}
            }
            if(row[1]===8||row[1]===9) {
              const text=observations.find((o:any)=>o?.label==='full-text-geometry-before-assertions');
              try {
                if(!text||!Array.isArray(text.reservations)||!Array.isArray(text.issues)||text.issues.length!==0)throw new Error('missing text');
                const compact=observations.some((o:any)=>o?.label==='actual-live-dom-geometry'&&o.dom?.compact===true);
                const snapshot=compact?detailGeometrySnapshot(text.textGeometry):null;
                if(textGeometryIssues(snapshot?.projected??text.textGeometry,text.reservations).length||snapshot?.completenessIssues.length)throw new Error('clipped text');
                if(compact){
                  const proof=observations.filter((o:any)=>o?.label==='authorized-detail-scroll-proof');
                  if(proof.length!==1||detailAccessIssues(proof[0]).length)throw new Error('missing detail access proof');
                  const samples=observations.filter((o:any)=>o?.label==='detail-scroll-snapshot');
                  if(samples.length!==proof[0].samples.length)throw new Error('missing detail snapshots');
                  for(const [i,sample]of samples.entries()){
                    const checked=detailGeometrySnapshot(sample.geometry);
                    if(!sample.statusEvidence||activeFixedStatusIds(sample.statusEvidence).some(id=>!sample.persistentIds?.includes(id)))throw new Error('active fixed status hidden/missing');
                    if(checked.completenessIssues.length||textGeometryIssues(checked.projected,sample.reservations??text.reservations).length)throw new Error('invalid reached text');
                    const recorded=proof[0].samples[i];
                    if(JSON.stringify(checked.expected)!==JSON.stringify(proof[0].expectedFragments)||JSON.stringify(checked.visible)!==JSON.stringify(recorded.fullyVisibleFragments)||sample.method!==recorded.method||sample.scrollTop!==recorded.scrollTop)throw new Error('detail coverage differs from raw geometry');
                  }
                  const native=observations.find((o:any)=>o?.label==='detail-scroll-native-events')?.events;
                  if(!Array.isArray(native)||native.some((e:any)=>!e.isTrusted)||!['keydown','keyup','pointerdown','touchstart','touchend'].every(type=>native.some((e:any)=>e.type===type))||!native.some((e:any)=>e.key==='ArrowDown')||!native.some((e:any)=>e.pointerType==='touch'))throw new Error('missing trusted scroll input');
                  if(consumedDetailInputIssues(observations.filter((o:any)=>o?.label==='detail-scroll-consumed-neutral-input')).length)throw new Error('missing/non-neutral consumed input');
                }
              }
              catch {errors.push('Complete unclipped nonoverlapping text evidence absent/invalid');}
            }
            if(row[1]===8 && !observations.some((o:any)=>o?.label==='actual-live-dom-geometry'&&o.dom?.sites?.length===7&&o.layout?.status==='placed')) errors.push('Live seven-site geometry absent');
            if(row[1]===9 && !observations.some((o:any)=>o?.label==='actual-200-percent-text'&&o.afterMeasurements>o.beforeMeasurements&&o.enlargement?.length>20)) errors.push('Fresh enlarged-text evidence absent');
          }
        }
        if(errors.length) issues.push(`${id??spec.title}: ${errors.join('; ')}`);
        cases.push({id,category:row?.[1],title:spec.title,project:result.projectName,status:result.status,attempts,validated:errors.length===0,errors,evidence});
      }
    }
    if(suite.suites!==undefined&&!Array.isArray(suite.suites)) issues.push('Malformed child suites');
    for(const child of Array.isArray(suite.suites)?suite.suites:[]) await visit(child);
  }
  if(isObject(raw)) {
    if(Array.isArray(raw.errors)&&raw.errors.length) issues.push('Top-level Playwright errors');
    if(raw.errors!==undefined&&!Array.isArray(raw.errors)) issues.push('Malformed top-level errors');
    for(const suite of Array.isArray(raw.suites)?raw.suites:[]) await visit(suite);
  }
  for(const title of expected.keys()) if(!seen.has(title)) issues.push(`Missing case: ${title}`);
  if(cases.length!==CASES.length) issues.push(`Expected ${CASES.length} results; received ${cases.length}`);
  const categories=Array.from({length:10},(_,n)=>({category:n+1,expected:CASES.filter(row=>row[1]===n+1).length,
    validated:cases.filter(row=>row.category===n+1&&row.validated).length}));
  const passed=issues.length===0;
  return {schemaVersion:1,classification:'clean-sheet-browser-functional-and-capability',suiteImplementationComplete:true,
    productContractBlocks:[
      {gate:'F-03',status:'blocked',reason:'Normal throttle lever integration, ownership and accessibility required by THROTTLE_LEVER_ADAPTER are absent; old acceleration/brake controls are current-runtime coverage only'},
      {gate:'F-04',status:'blocked',reason:'Required v1-preserving v2 layout saves/migration and lever settings are absent; current v1 settings tests are not the v2 contract'},
      {gate:'F-07',status:'blocked',reason:'Declared responsive functional checks require native execution and cannot replace the missing lever or complete product acceptance'},
      {gate:'F-18',status:'not-covered',reason:'Named-device performance, maximum load, soak and restart/leak acceptance are not measured'},
      {gate:'F-19',status:'not-covered',reason:'Actual-input Normal/Easy full victory, defeat/restart and final-candidate independent acceptance remain outside this bounded suite'},
    ],
    browserAcceptance:passed?'passed':'not-passed',counts:{expected:CASES.length,received:cases.length,validated:cases.filter(c=>c.validated).length},
    categories,issues,cases,physicalDeviceAcceptance:'unverified',performanceAcceptance:'not-measured',releaseReady:false,
    note:'suiteImplementationComplete describes the declared bounded suite only, not full F-01–F-20 product acceptance. Controlled-clock functional evidence and ordinary-wall-clock capability are distinct. No FPS, named-device, uninterrupted load, soak, victory, visual-reference or release certification is implied.'};
}
