export interface CaptureEvent { type:string; pointerId:number; isTrusted:boolean; targetId:string }
/** Validate a real pending->active->lost sequence before any pointerup can fire. */
export function assertCaptureCancelled(events:CaptureEvent[], pointerId:number, targetId:string, heldBeforeUp:unknown[]) {
  if(!Number.isInteger(pointerId)||pointerId<0) throw new Error('Missing native pointer identity');
  const expected=['pointerdown','gotpointercapture','lostpointercapture'];
  if(events.length!==expected.length) throw new Error('Incomplete or extra capture events before release');
  for(let i=0;i<expected.length;i++) {
    const event=events[i];
    if(event.type!==expected[i]) throw new Error('Capture event order is invalid');
    if(event.pointerId!==pointerId||event.targetId!==targetId) throw new Error('Capture event identity mismatch');
    if(event.isTrusted!==true) throw new Error('Capture event was not native/trusted');
  }
  if(heldBeforeUp.length!==0) throw new Error('Lost capture did not clear the application hold before pointerup');
}
