import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, freemem, loadavg, release } from 'node:os';

// Diagnosis only. No product state writes, watchdog changes, auto-resume, or
// acceptance skips. A completed experiment can contain paused/failed flights.
// The diagnostic owns per-cell trace retention. Collection categories match
// Verify; manual traces do not reproduce every runner expect/test-step event.
test.use({ trace: 'off' });

const REFS = {
  main: { sha: '36b0e3b8130acb7149a646845b46f72294a3798a', origin: 'http://127.0.0.1:4176' },
  pr5: { sha: 'e7d69dfc075b6908c162009828253fd9a312be37', origin: 'http://127.0.0.1:4177' },
  pr6: { sha: 'a8ca1a5d681648d1a620f94cc05e532f86c08255', origin: 'http://127.0.0.1:4178' },
} as const;
const SCENARIOS = [
  { name: 'easy-393x852', mode: 'easy', width: 393, height: 852, isMobile: true, hasTouch: true },
  { name: 'normal-1280x800', mode: 'normal', width: 1280, height: 800, isMobile: false, hasTouch: false },
] as const;
const PROFILES = ['light', 'full-object', 'dom-screenshot'] as const;
const WARMUP_MS = 500, WINDOW_MS = 3000, SAMPLE_MS = 500;
const OUTPUT = 'render-comparison-results';
type Profile = typeof PROFILES[number];

function experimentSchedule() {
  return SCENARIOS.flatMap(scenario => [
    ...PROFILES.flatMap(profile => (['main', 'pr5'] as const).map(ref => ({ scenario, profile, ref }))),
    ...[...PROFILES].reverse().flatMap(profile => (['pr5', 'main'] as const).map(ref => ({ scenario, profile, ref }))),
  ]);
}

function traceFactorSchedule() {
  return [true, false, false, true].map((traceEnabled, ordinal) => ({
    scenario: SCENARIOS[1], profile: 'light' as const, ref: 'main' as const,
    ordinal, traceEnabled, phase: 'trace-factor' as const,
  }));
}

function samplerFactorSchedule() {
  return [true, false, false, true].map((periodicSample, ordinal) => ({
    scenario: SCENARIOS[1], profile: 'light' as const, ref: 'main' as const,
    ordinal, periodicSample, phase: 'sampler-factor' as const, traceEnabled: false,
  }));
}

function matchedSourceSchedule() {
  return (['main', 'pr6', 'pr6', 'main'] as const).map((ref, ordinal) => ({
    scenario: SCENARIOS[1], profile: 'light' as const, ref, ordinal,
    phase: 'matched-source' as const, traceEnabled: false, periodicSample: false, apiTiming: true,
  }));
}

function allowedOrigin(url: string, origin: string) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function installProbe(options: number | { intervalMs: number; apiTiming: boolean; gpuTimer?: boolean }) {
  const intervalMs = typeof options === 'number' ? options : options.intervalMs;
  const w = window as any;
  const samples: any[] = [], frames: any[] = [], longTasks: any[] = [];
  let previousFrame: number | null = null, raf = 0, stopped = false, stage = 'navigation';
  // Keep the passive observer outside the application callback wrapper. The
  // native request ID is always returned unchanged; cancellation is untouched.
  const nativeRaf = window.requestAnimationFrame;
  const apiTiming = typeof options !== 'number' && options.apiTiming ? (() => {
    const EVENT_LIMIT = 936, FENCE_LIMIT = 64, SLOW_MS = 10;
    const events: any[] = [], fences: any[] = [];
    const methods: Record<string, any> = {}, groups: Record<string, any> = {}, callbacks: Record<string, any> = {};
    const installationFailures: string[] = [], wrappedMethods: string[] = [];
    const contextIds = new WeakMap<object, number>(), fenceIds = new WeakMap<object, number>();
    const latestFence = new WeakMap<object, number>(), callbackIds = new WeakMap<Function, number>();
    let contextSequence = 0, fenceSequence = 0, callbackSequence = 0;
    let nextEvent = 0, overwrittenEvents = 0, unrecordedFences = 0, recordingErrors = 0;
    let currentCallback: any = null, callbackNameCount = 0, active = true;
    const aggregate = () => ({ count: 0, totalMs: 0, maxMs: 0, throws: 0 });
    const add = (stat: any, elapsed: number, threw: boolean) => {
      stat.count++; stat.totalMs += elapsed; stat.maxMs = Math.max(stat.maxMs, elapsed); if (threw) stat.throws++;
    };
    const remember = (event: any) => {
      if (events.length < EVENT_LIMIT) events.push(event);
      else { events[nextEvent] = event; nextEvent = (nextEvent + 1) % EVENT_LIMIT; overwrittenEvents++; }
    };
    const groupFor = (name: string) => /^(fenceSync|clientWaitSync|waitSync|flush|finish|deleteSync|isContextLost)$/.test(name) ? 'sync'
      : /^(draw|clear|blit)/.test(name) ? 'draw'
      : /^(bufferData|bufferSubData|copyBufferSubData|texImage|texSubImage|texStorage|compressedTex|copyTex|generateMipmap)/.test(name) ? 'upload'
      : /^(compileShader|linkProgram|createShader|createProgram|shaderSource|validateProgram)$/.test(name) ? 'shader'
      : /^(get|check|readPixels)/.test(name) ? 'query'
      : /^(bind|uniform|vertexAttrib|enable|disable|blend|depth|stencil|colorMask|cull|frontFace|pixelStore|polygon|scissor|viewport|useProgram)/.test(name) ? 'state'
      : 'other';
    const contextId = (context: object) => {
      let id = contextIds.get(context); if (!id) { id = ++contextSequence; contextIds.set(context, id); } return id;
    };
    const screenState = () => {
      const app = document.getElementById('app');
      return { screen: app?.dataset.screen ?? null, mode: app?.dataset.mode ?? null };
    };
    const noteFence = (name: string, context: object, args: IArguments, result: any, begin: number, end: number, callStage: string) => {
      if (name === 'fenceSync' && result && typeof result === 'object') {
        const id = ++fenceSequence; fenceIds.set(result, id); latestFence.set(context, id);
        if (id <= FENCE_LIMIT) fences.push({ id, contextId: contextId(context), stage: callStage,
          condition: args[0], flags: args[1], issuedState: screenState(), firstSignaledState: null,
          fenceEnterMs: begin, fenceExitMs: end, flushEnterMs: null, flushExitMs: null,
          pollCount: 0, timeoutCount: 0, signaledCount: 0, waitFailedCount: 0, unexpectedCount: 0,
          nonzeroFlagsOrTimeout: 0, firstPollMs: null, lastPollMs: null, maxPollGapMs: 0,
          totalPollMs: 0, maxPollMs: 0, firstPollFlags: null, firstPollTimeout: null, lastPollFlags: null, lastPollTimeout: null,
          firstPollStage: null, lastPollStage: null, firstSignaledMs: null, firstSignaledStage: null,
          firstSignaledAfterFenceMs: null, firstSignaledAfterFlushMs: null, lastResult: null, deleteMs: null });
        else unrecordedFences++;
      } else if (name === 'flush') {
        const id = latestFence.get(context), f = id ? fences[id - 1] : undefined;
        if (f && f.flushEnterMs === null) { f.flushEnterMs = begin; f.flushExitMs = end; }
      } else if (name === 'clientWaitSync' || name === 'deleteSync') {
        const sync = args[0], id = sync && typeof sync === 'object' ? fenceIds.get(sync) : undefined;
        const f = id ? fences[id - 1] : undefined; if (!f) return;
        if (name === 'deleteSync') { f.deleteMs = end; return; }
        f.pollCount++; f.totalPollMs += end - begin; f.maxPollMs = Math.max(f.maxPollMs, end - begin);
        if (f.firstPollMs === null) { f.firstPollMs = begin; f.firstPollFlags = args[1]; f.firstPollTimeout = args[2]; f.firstPollStage = callStage; }
        if (f.lastPollMs !== null) f.maxPollGapMs = Math.max(f.maxPollGapMs, begin - f.lastPollMs);
        f.lastPollMs = begin; f.lastResult = result; f.lastPollFlags = args[1]; f.lastPollTimeout = args[2]; f.lastPollStage = callStage;
        if (args[1] !== 0 || args[2] !== 0) f.nonzeroFlagsOrTimeout++;
        // Standard WebGL enum results, recorded without any additional GL query.
        if (result === 0x911B) f.timeoutCount++;
        else if (result === 0x911A || result === 0x911C) { f.signaledCount++; if (f.firstSignaledMs === null) {
          f.firstSignaledMs = end; f.firstSignaledStage = callStage; f.firstSignaledState = screenState(); f.firstSignaledAfterFenceMs = end - f.fenceEnterMs;
          f.firstSignaledAfterFlushMs = f.flushExitMs === null ? null : end - f.flushExitMs;
        } }
        else if (result === 0x911D) f.waitFailedCount++;
        else f.unexpectedCount++;
      }
    };
    // Opt-in sixth phase. Capture native functions before wrapping either GL
    // prototype: diagnostic query commands must not recursively count as app calls.
    const gpuTimer = options.gpuTimer ? (() => {
      const DRAW_LIMIT = 256, HASH_BUFFER_LIMIT = 512 * 1024, HASH_TOTAL_LIMIT = 16 * 1024 * 1024;
      const native: Record<string, Function> = {}, gl2Prototype = w.WebGL2RenderingContext?.prototype;
      for (let p = gl2Prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        for (const name of Object.getOwnPropertyNames(p)) {
          const value = Object.getOwnPropertyDescriptor(p, name)?.value;
          if (typeof value === 'function' && !Object.hasOwn(native, name)) native[name] = value;
        }
      }
      const draws: any[] = [], errors: any[] = [], states = new WeakMap<object, any>();
      const buffers = new WeakMap<object, any>(), vaos = new WeakMap<object, any>(), programs = new WeakMap<object, any>();
      const pending: { query: any; record: any }[] = [];
      let bufferSequence = 0, vaoSequence = 0, programSequence = 0, hashedBytes = 0;
      let frame: any = null, context: any = null, ext: any = null, closed = false, finished = false, failed = false;
      let overflowDraws = 0, errorCount = 0, trackingMs = 0, setupMs = 0, queryCommandsMs = 0, collectMs = 0;
      const capability: any = { extension: 'EXT_disjoint_timer_query_webgl2', status: 'not-observed',
        supportedExtensions: null, extensionPresent: null, elapsedCounterBits: null,
        disjointResetRead: false, disjointBefore: null, disjointAtFinish: null, finalReadPasses: 0 };
      const call = (name: string, gl: any, args: any[]) => {
        if (!native[name]) throw new Error(`Missing native ${name}`);
        return Reflect.apply(native[name], gl, args);
      };
      const error = (operation: string, value: unknown) => {
        failed = true; errorCount++;
        if (errors.length < 32) errors.push({ operation, message: String(value) });
      };
      const isGL2 = (gl: any) => !!gl2Prototype && gl2Prototype.isPrototypeOf(gl);
      const buffer = (value: any) => {
        if (!value) return null;
        let found = buffers.get(value);
        if (!found) { found = { id: ++bufferSequence, byteLength: null, fnv1a32: null, signatureStatus: 'no-upload-observed', uploads: 0 }; buffers.set(value, found); }
        return found;
      };
      const vao = (value: any) => {
        if (!value) return { id: 0, attributes: new Map(), elementBuffer: null };
        let found = vaos.get(value);
        if (!found) { found = { id: ++vaoSequence, attributes: new Map(), elementBuffer: null }; vaos.set(value, found); }
        return found;
      };
      const program = (value: any) => {
        if (!value) return null;
        let found = programs.get(value);
        if (!found) { found = { id: ++programSequence, attributes: new Map() }; programs.set(value, found); }
        return found;
      };
      const state = (gl: any) => {
        let found = states.get(gl);
        if (!found) {
          const defaultVao = vao(null);
          found = { bindings: new Map(), defaultVao, vao: defaultVao, program: null }; states.set(gl, found);
        }
        return found;
      };
      const boundBuffer = (s: any, target: number) => target === 0x8893 ? s.vao.elementBuffer : s.bindings.get(target);
      const snapshot = (value: any) => value ? { ...buffer(value) } : null;
      const invalidate = (value: any, reason: string) => {
        const b = buffer(value); if (b) { b.fnv1a32 = null; b.signatureStatus = reason; }
      };
      const upload = (value: any, args: IArguments) => {
        const b = buffer(value); if (!b) return;
        const input = args[1]; b.uploads++; b.fnv1a32 = null;
        if (typeof input === 'number') { b.byteLength = input; b.signatureStatus = 'size-only'; return; }
        if (!input || typeof input.byteLength !== 'number') { b.byteLength = null; b.signatureStatus = 'unknown-upload'; return; }
        const view = ArrayBuffer.isView(input), bytesPerElement = view ? ((input as any).BYTES_PER_ELEMENT ?? 1) : 1;
        const offset = view ? (args[3] ?? 0) * bytesPerElement : 0;
        const byteLength = view && args[4] ? args[4] * bytesPerElement : input.byteLength - offset;
        b.byteLength = byteLength;
        if (b.uploads !== 1) { b.signatureStatus = 'reuploaded-unhashed'; return; }
        if (byteLength > HASH_BUFFER_LIMIT || hashedBytes + byteLength > HASH_TOTAL_LIMIT) { b.signatureStatus = 'hash-byte-cap'; return; }
        const bytes = new Uint8Array(view ? input.buffer : input, (view ? input.byteOffset : 0) + offset, byteLength);
        let hash = 0x811c9dc5;
        for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
        b.fnv1a32 = hash.toString(16).padStart(8, '0'); b.signatureStatus = 'initial-upload'; hashedBytes += byteLength;
      };
      const trackedNames = new Set(['bindBuffer', 'bufferData', 'bufferSubData', 'copyBufferSubData', 'bindVertexArray',
        'vertexAttribPointer', 'vertexAttribIPointer', 'enableVertexAttribArray', 'disableVertexAttribArray', 'vertexAttribDivisor', 'useProgram', 'getAttribLocation']);
      const track = (name: string, gl: any, args: IArguments, result: any) => {
        if (!trackedNames.has(name) || closed || !isGL2(gl)) return;
        const start = performance.now();
        try {
          const s = state(gl);
          if (name === 'bindVertexArray') s.vao = args[0] ? vao(args[0]) : s.defaultVao;
          else if (name === 'bindBuffer') {
            if (args[0] === 0x8893) s.vao.elementBuffer = args[1]; else s.bindings.set(args[0], args[1]);
          } else if (name === 'bufferData') upload(boundBuffer(s, args[0]), args);
          else if (name === 'bufferSubData' || name === 'copyBufferSubData') invalidate(boundBuffer(s, args[name === 'copyBufferSubData' ? 1 : 0]), name);
          else if (name === 'useProgram') s.program = program(args[0]);
          else if (name === 'getAttribLocation') { if (result >= 0) program(args[0])?.attributes.set(args[1], result); }
          else {
            const a = s.vao.attributes.get(args[0]) ?? { enabled: false, divisor: 0 };
            if (name === 'vertexAttribPointer' || name === 'vertexAttribIPointer') {
              Object.assign(a, { buffer: s.bindings.get(0x8892), size: args[1], type: args[2], integer: name === 'vertexAttribIPointer',
                normalized: name === 'vertexAttribPointer' ? args[3] : false,
                stride: args[name === 'vertexAttribPointer' ? 4 : 3], offset: args[name === 'vertexAttribPointer' ? 5 : 4] });
            } else if (name === 'vertexAttribDivisor') a.divisor = args[1];
            else a.enabled = name === 'enableVertexAttribArray';
            s.vao.attributes.set(args[0], a);
          }
        } catch (e) { error(`track:${name}`, e); }
        finally { trackingMs += performance.now() - start; }
      };
      const prepare = (gl: any) => {
        const start = performance.now();
        try {
          capability.supportedExtensions = call('getSupportedExtensions', gl, []);
          ext = call('getExtension', gl, [capability.extension]); capability.extensionPresent = !!ext;
          if (!ext) { capability.status = 'unsupported-extension'; return; }
          capability.elapsedCounterBits = call('getQuery', gl, [ext.TIME_ELAPSED_EXT, ext.QUERY_COUNTER_BITS_EXT]);
          if (!(capability.elapsedCounterBits > 0)) { capability.status = 'unsupported-elapsed-counter'; return; }
          capability.disjointBefore = call('getParameter', gl, [ext.GPU_DISJOINT_EXT]); capability.disjointResetRead = true;
          capability.status = 'available';
        } catch (e) { capability.status = 'instrumentation-error'; error('capability', e); }
        finally { setupMs += performance.now() - start; }
      };
      const before = (name: string, gl: any, args: IArguments) => {
        if (closed || !/^draw(Arrays|Elements)(Instanced)?$|^drawRangeElements$/.test(name) || !isGL2(gl)) return null;
        if (!frame) {
          const issuedState = screenState();
          if (issuedState.screen !== 'playing' || issuedState.mode !== 'normal') return null;
          context = gl; frame = { contextId: contextId(gl), stage, issuedState, startMs: performance.now(),
            endMs: null, fenceId: null, endReason: null, observedDraws: 0 }; prepare(gl);
        }
        if (context !== gl) return null;
        frame.observedDraws++;
        if (draws.length >= DRAW_LIMIT) { overflowDraws++; return null; }
        const start = performance.now();
        let token: any = null;
        try {
          const s = state(gl), p = s.program, location = p?.attributes.get('position');
          const attribute = location === undefined ? null : s.vao.attributes.get(location);
          const indexed = name !== 'drawArrays' && name !== 'drawArraysInstanced', range = name === 'drawRangeElements';
          const record: any = { ordinal: draws.length, command: name, args: Array.from(args), mode: args[0],
            count: args[range ? 3 : indexed ? 1 : 2],
            indexType: indexed ? args[range ? 4 : 2] : null, indexOffset: indexed ? args[range ? 5 : 3] : null,
            first: indexed ? null : args[1], instanceCount: name.endsWith('Instanced') ? args[indexed ? 4 : 3] : 1,
            programId: p?.id ?? null, vaoId: s.vao.id,
            position: attribute ? { location, size: attribute.size, type: attribute.type, normalized: attribute.normalized,
              integer: attribute.integer, stride: attribute.stride, offset: attribute.offset, divisor: attribute.divisor,
              enabled: attribute.enabled, buffer: snapshot(attribute.buffer) } : null,
            indexBuffer: indexed ? snapshot(s.vao.elementBuffer) : null, nativeEnterMs: null, nativeExitMs: null, nativeThrew: false,
            status: capability.status === 'available' ? 'not-started' : capability.status, elapsedNs: null, elapsedMs: null };
          draws.push(record); token = { record, query: null, begun: false };
          if (capability.status !== 'available' || failed) { if (failed) record.status = 'instrumentation-error'; return token; }
          const q = call('createQuery', gl, []);
          if (!q) throw new Error('createQuery returned null');
          token.query = q; pending.push({ query: q, record });
          call('beginQuery', gl, [ext.TIME_ELAPSED_EXT, q]); token.begun = true; record.status = 'pending';
        } catch (e) { if (token) token.record.status = 'instrumentation-error'; error('begin-draw-query', e); }
        finally { queryCommandsMs += performance.now() - start; }
        return token;
      };
      const after = (name: string, gl: any, args: IArguments, result: any, threw: boolean, token: any, begin: number, end: number) => {
        if (token) {
          const start = performance.now();
          token.record.nativeEnterMs = begin; token.record.nativeExitMs = end; token.record.nativeThrew = threw;
          try { if (token.begun) call('endQuery', gl, [ext.TIME_ELAPSED_EXT]); }
          catch (e) { token.record.status = 'instrumentation-error'; error('end-draw-query', e); }
          finally { queryCommandsMs += performance.now() - start; }
        }
        if (!threw) track(name, gl, args, result);
        if (name === 'fenceSync' && frame && context === gl && !closed) {
          closed = true; frame.endMs = end; frame.endReason = 'existing-fenceSync'; frame.fenceId = result ? fenceIds.get(result) ?? null : null;
          if (threw || !result) error('frame-boundary', 'Existing fenceSync did not produce a fence');
        }
      };
      return {
        before(name: string, gl: any, args: IArguments) {
          try { return before(name, gl, args); } catch (e) { error('before-hook', e); return null; }
        },
        after(name: string, gl: any, args: IArguments, result: any, threw: boolean, token: any, begin: number, end: number) {
          try { after(name, gl, args, result, threw, token, begin, end); } catch (e) { error('after-hook', e); }
        },
        finish() {
          if (finished) throw new Error('GPU timer finish called twice');
          finished = true; const start = performance.now();
          if (frame && !closed) { frame.endReason = 'finish-before-existing-fence'; closed = true; }
          try {
            if (pending.length) {
              capability.finalReadPasses++;
              // One pass after the existing Playwright observation window returns
              // to the event loop. No wait, flush, finish, extra render or polling.
              for (const item of pending) {
                try { item.record.availableAtFinish = call('getQueryParameter', context, [item.query, 0x8867]); }
                catch (e) { item.record.status = 'instrumentation-error'; error('query-availability', e); }
              }
              capability.disjointAtFinish = call('getParameter', context, [ext.GPU_DISJOINT_EXT]);
              for (const item of pending) {
                if (item.record.status === 'instrumentation-error') continue;
                if (item.record.nativeThrew) { item.record.status = 'native-draw-error'; continue; }
                if (capability.disjointAtFinish) { item.record.status = 'disjoint'; continue; }
                if (!item.record.availableAtFinish) { item.record.status = 'pending'; continue; }
                try {
                  const ns = call('getQueryParameter', context, [item.query, 0x8866]);
                  if (typeof ns !== 'number' || !Number.isFinite(ns) || ns < 0) throw new Error(`Invalid timer result: ${String(ns)}`);
                  item.record.elapsedNs = ns; item.record.elapsedMs = ns / 1e6; item.record.status = 'valid';
                } catch (e) { item.record.status = 'instrumentation-error'; error('query-result', e); }
              }
            }
          } catch (e) {
            error('collect', e);
            for (const item of pending) { item.record.status = 'instrumentation-error'; item.record.elapsedNs = null; item.record.elapsedMs = null; }
          } finally {
            // Pending, disjoint and error results are also released without waiting.
            for (const item of pending) {
              try { call('deleteQuery', context, [item.query]); item.record.queryDeleted = true; }
              catch (e) { item.record.queryDeleted = false; error('delete-query', e); }
            }
            collectMs += performance.now() - start;
          }
          const valid = draws.filter(draw => draw.status === 'valid'), incompleteFrame = !frame || frame.endReason !== 'existing-fenceSync';
          const complete = !errorCount && !incompleteFrame && !overflowDraws && draws.length > 0 && valid.length === draws.length;
          return { enabled: true, capability, frame, drawLimit: DRAW_LIMIT, draws, overflowDraws, incompleteFrame,
            errorCount, errors, validDraws: valid.length, pendingDraws: draws.filter(draw => draw.status === 'pending').length,
            disjointDraws: draws.filter(draw => draw.status === 'disjoint').length,
            validDrawElapsedMs: valid.length ? valid.reduce((sum, draw) => sum + draw.elapsedMs, 0) : null,
            validDrawElapsedMsIsPartial: !complete,
            completeFrameDrawElapsedMs: complete ? valid.reduce((sum, draw) => sum + draw.elapsedMs, 0) : null,
            result: errorCount ? 'instrumentation-error' : capability.status !== 'available' ? capability.status : complete ? 'complete' : 'incomplete',
            overhead: { trackingMs, setupMs, queryCommandsMs, collectMs, scope: 'CPU-observed diagnostic wall time, not GPU time; queryCommandsMs includes per-draw metadata' },
            signatures: { algorithm: 'fnv1a32-byte-order', hashBufferLimit: HASH_BUFFER_LIMIT, hashTotalLimit: HASH_TOTAL_LIMIT, hashedBytes,
              limits: 'Only first bufferData input per buffer is hashed. Later writes invalidate it. position is resolved only by the observed getAttribLocation(program, position). No extra GL state reads; hashes require byteLength and draw arguments for source correspondence and are not collision-proof identities.' },
            interpretation: 'Only the first Normal-playing draw stream through the existing fenceSync is instrumented. Query commands perturb submission. Valid elapsed values describe instrumented draw GPU time; they exclude other GL work and do not establish compositor or notification time. Unsupported, pending, disjoint, capped or incomplete results cannot stand in for a GPU pass.' };
        },
      };
    })() : undefined;
    const visited = new Set<object>();
    for (const constructorName of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      let prototype = w[constructorName]?.prototype;
      while (prototype && prototype !== Object.prototype && !visited.has(prototype)) {
        visited.add(prototype);
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
          if (name === 'constructor' || !descriptor || typeof descriptor.value !== 'function') continue;
          const original = descriptor.value, key = `${constructorName}.${name}`, group = groupFor(name);
          const stat = methods[key] = aggregate(), groupStat = groups[group] ??= aggregate();
          try {
            Object.defineProperty(prototype, name, { ...descriptor, value: function(this: any) {
              if (!active) return Reflect.apply(original, this, arguments);
              const gpuToken = gpuTimer?.before(name, this, arguments);
              const begin = performance.now(), callStage = stage;
              let result: any, threw = false;
              try { result = Reflect.apply(original, this, arguments); return result; }
              catch (error) { threw = true; throw error; }
              finally {
                const end = performance.now();
                try {
                  const elapsed = end - begin; add(stat, elapsed, threw); add(groupStat, elapsed, threw);
                  if (currentCallback) {
                    currentCallback.glCalls++; currentCallback.glMs += elapsed;
                    const entry = currentCallback.groups[group] ??= aggregate(); add(entry, elapsed, threw);
                  }
                  if (elapsed >= SLOW_MS) remember({ kind: 'native-call', method: key, group, stage: callStage,
                    callbackId: currentCallback?.id ?? null, beginMs: begin, endMs: end, wallMs: elapsed, threw });
                  if (!threw) noteFence(name, this, arguments, result, begin, end, callStage);
                } catch { recordingErrors++; }
                gpuTimer?.after(name, this, arguments, result, threw, gpuToken, begin, end);
              }
            } });
            wrappedMethods.push(key);
          } catch { if (installationFailures.length < 32) installationFailures.push(key); }
        }
        prototype = Object.getPrototypeOf(prototype);
      }
    }
    let rafWrapped = false;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame');
      if (!descriptor || typeof descriptor.value !== 'function') throw new Error('Missing rAF data descriptor');
      Object.defineProperty(window, 'requestAnimationFrame', { ...descriptor, value: function(this: any, callback: FrameRequestCallback) {
        if (typeof callback !== 'function') return Reflect.apply(nativeRaf, this, arguments);
        // Let the native implementation validate its original receiver and
        // allocate the real cancellation handle, with no ID translation.
        return nativeRaf.call(this, function(this: any, timestamp: number) {
          if (!active) return callback.call(this, timestamp);
          const begin = performance.now(), previous = currentCallback;
          let id = callbackIds.get(callback); if (!id) { id = ++callbackSequence; callbackIds.set(callback, id); }
          const name = callback.name || '(anonymous)';
          const record = { kind: 'raf-callback', id, name, stage, timestamp,
            beginMs: begin, endMs: 0, wallMs: 0, outsideWebGLMs: 0, glCalls: 0, glMs: 0, groups: {} as Record<string, any>, threw: false };
          currentCallback = record;
          try { return callback.call(this, timestamp); }
          catch (error) { record.threw = true; throw error; }
          finally {
            const end = performance.now(); currentCallback = previous;
            try {
              record.endMs = end; record.wallMs = end - begin; record.outsideWebGLMs = Math.max(0, record.wallMs - record.glMs);
              const aggregateName = Object.hasOwn(callbacks, name) || callbackNameCount < 32 ? name : '(other callbacks)';
              if (!Object.hasOwn(callbacks, aggregateName)) { callbacks[aggregateName] = { ...aggregate(), glMs: 0, glCalls: 0 }; callbackNameCount++; }
              add(callbacks[aggregateName], record.wallMs, record.threw); callbacks[aggregateName].glMs += record.glMs; callbacks[aggregateName].glCalls += record.glCalls;
              remember(record);
            } catch { recordingErrors++; }
          }
        });
      } });
      rafWrapped = true;
    } catch { installationFailures.push('requestAnimationFrame'); }
    return {
      finish() {
        active = false;
        const gpuTimerResult = gpuTimer?.finish();
        return { enabled: true, ...(gpuTimerResult ? { gpuTimer: gpuTimerResult } : {}), slowCallThresholdMs: SLOW_MS, eventLimit: EVENT_LIMIT, fenceLimit: FENCE_LIMIT,
          events: overwrittenEvents ? [...events.slice(nextEvent), ...events.slice(0, nextEvent)] : events,
          fences, methods, groups, callbacks, wrappedMethods, rafWrapped, installationFailures, recordingErrors,
          overwrittenEvents, unrecordedFences, fenceCount: fenceSequence,
          interpretation: gpuTimerResult ? 'Elapsed call/callback wall time includes possible descheduling. outsideWebGLMs includes JavaScript, DOM, other APIs and probe overhead. Extension-object methods are not wrapped. API wall times are not CPU/GPU execution times. When gpuTimer is enabled, its added native query commands and overhead are reported separately; otherwise no GL calls are added.' : 'Elapsed call/callback wall time includes possible descheduling. outsideWebGLMs includes JavaScript, DOM, other APIs and probe overhead. Extension-object methods are not wrapped. No added GL calls, timers or CPU/GPU time claims.' };
      },
    };
  })() : undefined;
  const project = (s: any) => s ? ({
    phase: s.phase, screen: s.screen, mode: s.mode, tick: s.tick, activeTicks: s.activeTicks,
    graphicsReady: s.graphicsReady, pauseReasons: s.pauseReasons, fatalLogicError: s.fatalLogicError,
    lastFrameGap: s.lastFrameGap, renderStatus: s.renderStatus,
    performanceInterrupted: s.performanceInterrupted, lastInterruption: s.lastInterruption,
    render: s.render,
  }) : null;
  const take = (label: string) => {
    const begin = performance.now();
    const state = typeof w.__fantasiaReadState === 'function' ? w.__fantasiaReadState(false) : null;
    const afterRead = performance.now();
    const sample = { atMs: begin, epochMs: performance.timeOrigin + begin, label, stage,
      readMs: afterRead - begin, state: project(state) };
    if (samples.length < 240) samples.push(sample);
    return sample;
  };
  const frame = () => {
    const now = performance.now();
    if (frames.length < 8000) frames.push({ atMs: now, stage, gapMs: previousFrame === null ? null : now - previousFrame });
    previousFrame = now;
    if (!stopped) raf = nativeRaf.call(window, frame);
  };
  raf = nativeRaf.call(window, frame);
  const timer = intervalMs > 0 ? setInterval(() => take('periodic'), intervalMs) : undefined;
  let observer: PerformanceObserver | undefined;
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (longTasks.length < 1000)
        longTasks.push({ atMs: entry.startTime, durationMs: entry.duration });
    });
    observer.observe({ type: 'longtask', buffered: true });
  }
  w.__renderComparisonProbe = {
    take, project,
    stage(value: string) { stage = value; },
    finish() {
      take('final'); stopped = true; if (timer !== undefined) clearInterval(timer); cancelAnimationFrame(raf); observer?.disconnect();
      return { timeOrigin: performance.timeOrigin, samples, frames, longTasks, apiTiming: apiTiming?.finish(),
        limitsReached: { samples: samples.length >= 240, frames: frames.length >= 8000, longTasks: longTasks.length >= 1000 } };
    },
  };
}

async function compact(page: Page, label: string) {
  const start = performance.now();
  const encoded = await page.evaluate(label => JSON.stringify((window as any).__renderComparisonProbe.take(label)), label);
  return { runnerStartMs: start, wallMs: performance.now() - start, result: JSON.parse(encoded) };
}

async function fullObject(page: Page) {
  const start = performance.now();
  // Matches the original spec's object return path. readMs includes the hook's
  // own full-state JSON clone; wallMs additionally includes queue/transport and
  // Playwright object serialization. Their difference is NOT pure CPU time.
  const result = await page.evaluate(() => {
    const begin = performance.now();
    const state = (window as any).__fantasiaReadState(false);
    return { atMs: begin, readMs: performance.now() - begin, state };
  });
  const wallMs = performance.now() - start;
  const encodeStart = performance.now();
  const payloadBytes = Buffer.byteLength(JSON.stringify(result));
  return { runnerStartMs: start, wallMs, atMs: result.atMs, readMs: result.readMs, payloadBytes,
    runnerEncodeMs: performance.now() - encodeStart,
    phase: result.state.phase, tick: result.state.tick, pauseReasons: result.state.pauseReasons,
    renderStatus: result.state.renderStatus, queue: result.state.render?.queue };
}

function safetyProblems(s: any) {
  if (!s) return ['missing observation'];
  const problems: string[] = [];
  if (s.phase !== 'playing') problems.push(`phase:${s.phase}`);
  if (!Array.isArray(s.pauseReasons) || s.pauseReasons.length) problems.push('pause reasons');
  if (s.fatalLogicError !== null) problems.push('logic safety');
  if (!['ready', 'pending'].includes(s.renderStatus)) problems.push(`render:${s.renderStatus}`);
  if (!['ready', 'pending'].includes(s.render?.queue?.status)) problems.push(`queue:${s.render?.queue?.status}`);
  return problems;
}

async function runCell(browser: Browser, scenario: typeof SCENARIOS[number], profile: Profile,
  ref: keyof typeof REFS, ordinal: number,
  options: { phase: 'trace-factor' | 'sampler-factor' | 'api-timing' | 'matched-source' | 'gpu-timer'; traceEnabled: boolean; periodicSample?: boolean; apiTiming?: boolean; gpuTimer?: boolean } | undefined = undefined) {
  const phase = options?.phase ?? 'source-load-comparison';
  const traceEnabled = options?.traceEnabled ?? true;
  const periodicSample = options?.periodicSample ?? true;
  const id = options ? `${scenario.name}-${phase}-${profile}-${ordinal}-${ref}-trace-${traceEnabled ? 'on' : 'off'}${phase === 'sampler-factor' ? `-sample-${periodicSample ? 'on' : 'off'}` : ''}`
    : `${scenario.name}-${profile}-${ordinal}-${ref}`;
  const origin = REFS[ref].origin, websocketOrigin = origin.replace('http:', 'ws:');
  const blocked: string[] = [], errors: string[] = [], actions: any[] = [];
  const report: any = { id, phase, ref: REFS[ref], order: ordinal, scenario, profile,
    gameAcceptance: 'NOT EVALUATED: diagnostic collection is not a game acceptance pass',
    hostBefore: { epochMs: Date.now(), loadavg: loadavg(), freeMemory: freemem() },
    requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS, commonSampleMs: periodicSample ? SAMPLE_MS : null,
    textScale: '100%; this is not the existing 200% reachability test', actions, blocked, errors };
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height },
    isMobile: scenario.isMobile, hasTouch: scenario.hasTouch, deviceScaleFactor: 1, serviceWorkers: 'block' });
  // Route before navigation. Never permit ranking, production, or third-party
  // requests. WebSockets need their own route; normal request routing omits them.
  await context.route('**/*', async route => {
    if (allowedOrigin(route.request().url(), origin)) await route.continue();
    else { blocked.push(route.request().url()); await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', route => {
    if (allowedOrigin(route.url(), websocketOrigin)) route.connectToServer();
    else { blocked.push(route.url()); route.close(); }
  });
  // Match the original config's trace collection work; retain all traces as
  // diagnosis evidence rather than deleting successful-cell traces.
  if (traceEnabled) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  report.trace = { enabled: traceEnabled, screenshots: traceEnabled, snapshots: traceEnabled, sources: traceEnabled,
    retained: traceEnabled ? 'every enabled diagnostic cell' : 'intentionally not collected; no trace start or stop call' };
  await context.addInitScript(installProbe, options?.apiTiming ? { intervalMs: 0, apiTiming: true, gpuTimer: options.gpuTimer === true } : periodicSample ? SAMPLE_MS : 0);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(String(error)));
  try {
    const navigate = performance.now();
    await page.goto(origin, { waitUntil: 'load', timeout: 25000 });
    report.navigationMs = performance.now() - navigate;
    const prepare = performance.now();
    await expect(page.locator('#start')).toBeEnabled({ timeout: 25000 });
    report.preparationMs = performance.now() - prepare;
    report.environment = await page.evaluate(apiTimingEnabled => {
      const canvas = document.querySelector<HTMLCanvasElement>('#flight');
      const gl = canvas?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { timeOrigin: performance.timeOrigin, userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio, visibility: document.visibilityState,
        renderer: gl && debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        vendor: gl && debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        ...(apiTimingEnabled ? { viewportWidth: innerWidth, viewportHeight: innerHeight, version: gl ? gl.getParameter(gl.VERSION) : null,
          drawingBufferWidth: gl?.drawingBufferWidth ?? null, drawingBufferHeight: gl?.drawingBufferHeight ?? null } : {}),
        savedSettings: Object.fromEntries(['fantasia-controls-v1', 'fantasia-controls-easy-v1', 'fantasia-keyboard-v1']
          .map(key => [key, localStorage.getItem(key)])) };
    }, options?.apiTiming === true);
    await page.evaluate(() => (window as any).__renderComparisonProbe.stage('home-warmup'));
    const warmup = performance.now(); await page.waitForTimeout(WARMUP_MS);
    report.actualWarmupMs = performance.now() - warmup;
    const mode = page.locator(`input[name="game-mode"][value="${scenario.mode}"]`);
    if (!(await mode.isChecked())) await mode.check();
    await page.evaluate(() => (window as any).__renderComparisonProbe.stage('start'));
    const start = performance.now(); await page.locator('#start').click();
    actions.push({ name: 'start-click', startMs: start, endMs: performance.now() });
    report.seed = await page.evaluate(() => {
      const audit = (window as any).__fantasiaReadState('audit');
      return { seed: audit.seed, mode: audit.mode, rulesVersion: audit.rulesVersion,
        mapVersion: audit.mapVersion, startHeading: audit.startHeading };
    });
    report.before = await compact(page, 'before-profile');
    await page.evaluate(profile => (window as any).__renderComparisonProbe.stage(profile), profile);
    const begin = performance.now();
    if (profile === 'full-object') {
      // Bounded original-style polling, never concurrent and never catch-up.
      for (let n = 0; n < 12 && performance.now() - begin < WINDOW_MS; n++) {
        actions.push({ name: 'full-object-read', ...await fullObject(page) });
        await page.waitForTimeout(100);
      }
    } else if (profile === 'dom-screenshot') {
      report.beforeDom = await compact(page, 'before-dom');
      const domStart = performance.now();
      const geometry = await page.evaluate(() => {
        const start = performance.now();
        (window as any).__renderComparisonProbe.stage('dom-measure');
        const box = (e: Element) => { const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const sites = Array.from(document.querySelectorAll('#campaign-sites .campaign-site[data-site]')).map(e => ({
          id: (e as HTMLElement).dataset.site, box: box(e),
          owner: e.querySelector('.campaign-site-owner')?.textContent,
          force: e.querySelector('.campaign-site-force')?.textContent,
          wave: e.querySelector('.campaign-site-wave')?.textContent,
        }));
        const geometry = { sites, header: box(document.querySelector('#hud .hud-top')!),
          strip: box(document.querySelector('#campaign-sites')!), width: innerWidth,
          documentWidth: document.documentElement.scrollWidth };
        return { startMs: start, endMs: performance.now(), ...geometry };
      });
      actions.push({ name: 'dom-measure', runnerStartMs: domStart, wallMs: performance.now() - domStart, geometry });
      report.afterDom = await compact(page, 'after-dom');
      await page.evaluate(() => (window as any).__renderComparisonProbe.stage('screenshot'));
      report.beforeScreenshot = await compact(page, 'before-screenshot');
      const shotStart = performance.now();
      try { await page.screenshot({ path: `${OUTPUT}/${id}.png`, timeout: 10000 }); }
      catch (error) { report.experimentError = `screenshot: ${String(error)}`; }
      finally { actions.push({ name: 'screenshot', runnerStartMs: shotStart, endMs: performance.now() }); }
      report.afterScreenshot = await compact(page, 'after-screenshot');
      await page.evaluate(() => (window as any).__renderComparisonProbe.stage('post-screenshot-full-read'));
      actions.push({ name: 'original-post-screenshot-full-read', ...await fullObject(page) });
    }
    await page.evaluate(profile => (window as any).__renderComparisonProbe.stage(`${profile}-tail`), profile);
    const remaining = WINDOW_MS - (performance.now() - begin);
    if (remaining > 0) await page.waitForTimeout(remaining);
    report.actualWindowMs = performance.now() - begin;
    report.after = await compact(page, 'after-profile');
  } catch (error) { report.experimentError = String(error); }
  finally {
    try {
      report.timeline = JSON.parse(await page.evaluate(() => JSON.stringify((window as any).__renderComparisonProbe.finish())));
      const flightSamples = report.timeline.samples.filter((s: any) => s.stage !== 'navigation' && s.stage !== 'home-warmup' && s.stage !== 'start');
      const final = report.timeline.samples.at(-1)?.state;
      report.finalSafetyProblems = safetyProblems(final);
      report.flightSafety = { startedLive: safetyProblems(report.before?.result?.state).length === 0,
        allObservedLive: flightSamples.length > 0 && flightSamples.every((s: any) => safetyProblems(s.state).length === 0),
        observedSampleCount: flightSamples.length, playingSampleCount: flightSamples.filter((s: any) => s.state?.phase === 'playing').length,
        pausedSampleCount: flightSamples.filter((s: any) => s.state?.phase === 'paused').length, finalLive: safetyProblems(final).length === 0,
        firstUnsafe: flightSamples.find((s: any) => safetyProblems(s.state).length > 0) ?? null };
    } catch (error) { report.finalObservationError = String(error); }
    report.hostAfter = { epochMs: Date.now(), loadavg: loadavg(), freeMemory: freemem() };
    if (traceEnabled) {
      try { await context.tracing.stop({ path: `${OUTPUT}/${id}-trace.zip` }); }
      catch (error) { report.traceError = String(error); }
    }
    await writeFile(`${OUTPUT}/${id}.json`, JSON.stringify(report, null, 2));
    await context.close();
  }
  return { id, phase, periodicSample, periodicSampleCount: report.timeline?.samples.filter((sample: any) => sample.label === 'periodic').length ?? null, traceEnabled, traceExpected: traceEnabled, ref, profile, scenario: scenario.name, experimentError: report.experimentError ?? null,
    apiTiming: report.timeline?.apiTiming ? { enabled: true, rafWrapped: report.timeline.apiTiming.rafWrapped,
      wrappedMethodCount: report.timeline.apiTiming.wrappedMethods.length, installationFailures: report.timeline.apiTiming.installationFailures,
      recordingErrors: report.timeline.apiTiming.recordingErrors, overwrittenEvents: report.timeline.apiTiming.overwrittenEvents,
      unrecordedFences: report.timeline.apiTiming.unrecordedFences, fenceCount: report.timeline.apiTiming.fenceCount } : null,
    ...(options?.gpuTimer ? { gpuTimer: report.timeline?.apiTiming?.gpuTimer ?? null } : {}),
    actualSetup: report.environment ?? null, pageErrorCount: errors.length,
    renderObservations: [report.before?.result, report.after?.result, report.timeline?.samples.at(-1)]
      .map(sample => sample ? { label: sample.label, atMs: sample.atMs, phase: sample.state?.phase,
        tick: sample.state?.tick, render: sample.state?.render } : null),
    finalObservationError: report.finalObservationError ?? null, traceError: report.traceError ?? null, blockedRequests: blocked.length,
    safety: report.flightSafety ?? null, seed: report.seed ?? null };
}

test('PR5 matched rendering diagnosis only, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(15 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const [i, { scenario, profile, ref }] of experimentSchedule().entries()) {
    cells.push(await runCell(browser, scenario, profile, ref, i));
    // Incremental durable results survive a later harness timeout.
    await writeFile(`${OUTPUT}/summary.json`, JSON.stringify({ environment, cells,
      gameAcceptance: 'NOT EVALUATED', expectedCells: 24,
      interpretation: [
        'Product, original tests, lock and Verify workflow must be identical before execution.',
        'Each profile uses a fresh flight and AB/BA order; no manual or automatic resume.',
        'A stopped start cannot identify a later observation effect; compare only equally live profile starts.',
        'All profiles use the same manual screenshot/snapshot/source trace collection categories as Verify.',
        'Trace ownership/retention and runner expect/test-step events differ from original Verify.',
        'The common 500ms sampler itself clones full state; light is not a zero-observation control.',
        'Fence times are CPU-observed completion latency, not GPU timer queries.',
        'Full-object wall minus read time includes browser queue, transport and serialization, not only CPU work.',
        'A profile/order effect is a hypothesis from two observations per ref, not causal or device-wide proof.',
        'Paused flights are diagnostic findings. A green diagnostic job is not game acceptance or a release gate.',
      ] }, null, 2));
  }
  // Only completeness/security gates. Runtime safety is reported without
  // changing the original acceptance spec or treating an interruption as pass.
  expect(cells).toHaveLength(24);
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests)).toEqual([]);
});


// Second phase: a single changed factor on one fixed executable revision.
// Keep the original 24-cell definition above reproducible; CI explicitly greps
// this separate test so it cannot accidentally execute both experiments.
test('PR5 trace factor diagnosis only, four flights, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const cell of traceFactorSchedule()) {
    cells.push(await runCell(browser, cell.scenario, cell.profile, cell.ref, cell.ordinal,
      { phase: cell.phase, traceEnabled: cell.traceEnabled }));
    await writeFile(`${OUTPUT}/summary-trace-factor.json`, JSON.stringify({
      phase: 'trace-factor', environment, cells, expectedCells: 4, gameAcceptance: 'NOT EVALUATED',
      fixedSource: REFS.main, onlyChangedFactor: 'manual trace enabled', order: ['on', 'off', 'off', 'on'],
      fixedInputs: { viewport: SCENARIOS[1], textScale: '100%', profile: 'light',
        commonSampleMs: SAMPLE_MS, requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS },
      interpretation: [
        'Only main at the already verified shared runtime is tested; PR6 is not included.',
        'Each cell has a fresh context/flight, the same seed and no resume or retry.',
        'Trace-off means no trace start/stop calls and no trace artifact is expected for those cells.',
        'Trace-on uses the same manual screenshots/snapshots/sources categories as the prior phase.',
        'The common full-clone sampler and other diagnostic reads are unchanged; this does not isolate their overhead.',
        'Both off cells surviving while both on cells stop supports a trace contribution in this scene/runner only.',
        'Both groups stopping leaves shared observer, renderer and environment unresolved; mixed results are inconclusive.',
        'All metrics include the final observation. Collection success is not game acceptance or release approval.',
      ],
    }, null, 2));
  }
  expect(cells).toHaveLength(4);
  expect(cells.map(cell => cell.traceEnabled)).toEqual([true, false, false, true]);
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests)).toEqual([]);
});


// Third phase: remove only recurring full-state clones. Initial, final and
// boundary reads remain identical, as do passive rAF and long-task observation.
test('PR5 sampler factor diagnosis only, four flights, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const cell of samplerFactorSchedule()) {
    cells.push(await runCell(browser, cell.scenario, cell.profile, cell.ref, cell.ordinal,
      { phase: cell.phase, traceEnabled: false, periodicSample: cell.periodicSample }));
    await writeFile(`${OUTPUT}/summary-sampler-factor.json`, JSON.stringify({
      phase: 'sampler-factor', environment, cells, expectedCells: 4, gameAcceptance: 'NOT EVALUATED',
      fixedSource: REFS.main, onlyChangedFactor: 'recurring full-state sampler enabled', order: ['on', 'off', 'off', 'on'],
      fixedInputs: { viewport: SCENARIOS[1], textScale: '100%', profile: 'light', traceEnabled: false,
        requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS },
      interpretation: [
        'Trace is disabled in every cell; periodic sampling alone changes, including preparation.',
        'Each cell uses the same source, seed and fresh context without resume or retry.',
        'Sampler-off still has identical initial, boundary and final state reads and passive rAF/longtask observation.',
        'Sampler-off has fewer state samples; its allObservedLive does not prove continuous safety.',
        'Final phase, retained interruption, pause reasons and frame/fence timing are primary outcomes.',
        'If both sampler-off cells stop, recurring full-state clones are not necessary for those stops.',
        'Both off cells surviving with both on cells stopping supports sampler contribution in this runner/scene only; mixed results are inconclusive.',
        'Collection success is not game acceptance or release approval.',
      ],
    }, null, 2));
  }
  expect(cells).toHaveLength(4);
  expect(cells.map(cell => cell.periodicSample)).toEqual([true, false, false, true]);
  expect(cells.every(cell => cell.traceEnabled === false)).toBe(true);
  expect(cells.every(cell => cell.periodicSample ? cell.periodicSampleCount > 0 : cell.periodicSampleCount === 0)).toBe(true);
  expect(cells.every(cell => JSON.stringify(cell.seed) === JSON.stringify(cells[0].seed))).toBe(true);
  expect(cells[0].seed?.seed).toBe(20261005);
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests)).toEqual([]);
});


// Fourth phase: two repeated instrumented observations, not a treatment/control
// comparison. Runtime, quality, safety checks, source and observer boundaries stay fixed.
test('PR5 API timing diagnosis only, two flights, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const ordinal of [0, 1]) {
    cells.push(await runCell(browser, SCENARIOS[1], 'light', 'main', ordinal,
      { phase: 'api-timing', traceEnabled: false, periodicSample: false, apiTiming: true }));
    await writeFile(`${OUTPUT}/summary-api-timing.json`, JSON.stringify({
      phase: 'api-timing', environment, cells, expectedCells: 2, gameAcceptance: 'NOT EVALUATED',
      fixedSource: REFS.main, instrumentedObservationsOnly: true,
      fixedInputs: { viewport: SCENARIOS[1], textScale: '100%', profile: 'light', traceEnabled: false,
        periodicSample: false, requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS },
      interpretation: [
        'Both fresh flights have identical instrumentation; there is no unwrapped control and no causal claim.',
        'No source/runtime/safety/quality change, resume, retry, new flight/probe GL call or recurring sample timer is introduced. One setup VERSION query supplements existing environment metadata.',
        'All existing callable WebGL prototype methods are wrapped; extension-object methods and other browser APIs are outside coverage.',
        'Slow call records are >=10ms. Per-method/group totals cover fast calls too. Detail storage is at most 936 ring events plus 64 fences.',
        'App rAF callbacks retain the original callback timestamp/receiver/error and native cancellation ID; passive probe rAF is excluded.',
        'Long native API elapsed time localizes where the main thread stayed, but cannot separate execution, IPC/backpressure or descheduling.',
        'Short callbacks and fast repeated zero-timeout TIMEOUT_EXPIRED polls after flush support pending asynchronous render completion, not its underlying cause.',
        'Callback wall minus GL time includes JavaScript, DOM, unwrapped APIs, scheduling and instrumentation overhead; it is not pure JavaScript CPU.',
        'Existing initial/boundary/final clone readMs remains; no periodic full-state sampler runs.',
        'Fence completion is observed latency, not a GPU timer query. Installation/recording/drop counters determine coverage limits.',
        'Collection success is not game acceptance, renderer qualification or release approval.',
      ],
    }, null, 2));
  }
  expect(cells).toHaveLength(2);
  expect(cells.every(cell => cell.traceEnabled === false && cell.periodicSample === false && cell.periodicSampleCount === 0)).toBe(true);
  expect(cells.every(cell => cell.apiTiming?.enabled && cell.apiTiming.rafWrapped && cell.apiTiming.wrappedMethodCount > 0)).toBe(true);
  expect(cells.every(cell => cell.apiTiming.installationFailures.length === 0 && cell.apiTiming.recordingErrors === 0 && cell.apiTiming.unrecordedFences === 0)).toBe(true);
  expect(cells.every(cell => JSON.stringify(cell.seed) === JSON.stringify(cells[0].seed))).toBe(true);
  expect(cells[0].seed?.seed).toBe(20261005);
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests)).toEqual([]);
});


// Fifth phase: only the pinned source changes. Retain all four earlier test
// definitions; the workflow explicitly selects this fresh-context ABBA phase.
test('PR6 matched source diagnosis only, four flights, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const cell of matchedSourceSchedule()) {
    cells.push(await runCell(browser, cell.scenario, cell.profile, cell.ref, cell.ordinal,
      { phase: cell.phase, traceEnabled: false, periodicSample: false, apiTiming: true }));
    await writeFile(`${OUTPUT}/summary-matched-source.json`, JSON.stringify({
      phase: 'matched-source', environment, cells, expectedCells: 4, gameAcceptance: 'NOT EVALUATED',
      sources: { main: REFS.main, pr6: REFS.pr6 }, onlyChangedFactor: 'pinned source revision',
      order: ['main', 'pr6', 'pr6', 'main'],
      fixedInputs: { viewport: SCENARIOS[1], textScale: '100%', profile: 'light', traceEnabled: false,
        periodicSample: false, apiTiming: true, seed: 20261005,
        requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS },
      interpretation: [
        'Main and current PR6 run sequentially on the same runner/browser with identical native API/rAF instrumentation and fresh contexts.',
        'The exact main/PR5 shared-runtime check remains; PR6 differs from main only in the seven inventoried files. No product changes are introduced here.',
        'Trace and periodic full-state sampling are off in all four cells; initial/boundary/final reads and passive observers remain identical.',
        'No resume or retry, watchdog/quality change, acceptance skip or added flight GL query is introduced.',
        'Compare reported rendered triangles/draw calls, native API/rAF elapsed time, fence latency/poll gaps and safety outcomes at matched observation boundaries.',
        'Triangles/draw calls describe submitted rendering work, not measured unique vertex-shader invocations or GPU execution time.',
        'Fast zero-timeout polls with long post-flush completion latency describe pending asynchronous work/scheduling, not a synchronous one-second GL block.',
        'The whole existing PR6 source difference is the treatment; this cannot attribute effects to one individual change.',
        'Two observations per source on one runner support a bounded comparison, not device-wide qualification. Order and runner scheduling can still matter.',
        'Collection success is separate from gameplay safety and is not game acceptance or release approval.',
      ],
    }, null, 2));
  }
  expect(cells).toHaveLength(4);
  expect(cells.map(cell => cell.ref)).toEqual(['main', 'pr6', 'pr6', 'main']);
  expect(cells.every(cell => cell.traceEnabled === false && cell.periodicSample === false && cell.periodicSampleCount === 0)).toBe(true);
  expect(cells.every(cell => cell.apiTiming?.enabled && cell.apiTiming.rafWrapped && cell.apiTiming.wrappedMethodCount > 0)).toBe(true);
  expect(cells.every(cell => cell.apiTiming.installationFailures.length === 0 && cell.apiTiming.recordingErrors === 0 && cell.apiTiming.unrecordedFences === 0)).toBe(true);
  expect(cells.every(cell => cell.apiTiming.wrappedMethodCount === cells[0].apiTiming.wrappedMethodCount)).toBe(true);
  expect(cells.every(cell => cell.actualSetup?.viewportWidth === 1280 && cell.actualSetup?.viewportHeight === 800
    && cell.actualSetup?.drawingBufferWidth === 1280 && cell.actualSetup?.drawingBufferHeight === 800
    && cell.actualSetup?.devicePixelRatio === 1 && cell.actualSetup?.visibility === 'visible')).toBe(true);
  expect(cells.every(cell => cell.actualSetup?.renderer && cell.actualSetup.renderer === cells[0].actualSetup.renderer
    && cell.actualSetup.version && cell.actualSetup.version === cells[0].actualSetup.version)).toBe(true);
  expect(cells.every(cell => Object.values(cell.actualSetup?.savedSettings ?? {}).length === 3
    && Object.values(cell.actualSetup.savedSettings).every(value => value === null))).toBe(true);
  expect(cells.every(cell => JSON.stringify(cell.seed) === JSON.stringify(cells[0].seed))).toBe(true);
  expect(cells[0].seed?.seed).toBe(20261005);
  expect(cells[0].seed?.mode).toBe('normal');
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests || cell.pageErrorCount)).toEqual([]);
});


// Sixth phase: two fresh flights on the fixed PR6 runtime. Timer support and
// result validity are evidence, never substituted with CPU or triangle counts.
test('PR6 first-frame GPU timer diagnosis only, two flights, not game acceptance', async ({ browser }, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  await mkdir(OUTPUT, { recursive: true });
  const environment = { browserVersion: browser.version(), node: process.version, platform: process.platform,
    runnerTimeOrigin: performance.timeOrigin, osRelease: release(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))], cpuCount: cpus().length,
    project: testInfo.project.name, launchOptions: testInfo.project.use.launchOptions,
    workerIndex: testInfo.workerIndex, startedAt: new Date().toISOString() };
  const cells: any[] = [];
  for (const ordinal of [0, 1]) {
    cells.push(await runCell(browser, SCENARIOS[1], 'light', 'pr6', ordinal,
      { phase: 'gpu-timer', traceEnabled: false, periodicSample: false, apiTiming: true, gpuTimer: true }));
    await writeFile(`${OUTPUT}/summary-gpu-timer.json`, JSON.stringify({
      phase: 'gpu-timer', environment, cells, expectedCells: 2, gameAcceptance: 'NOT EVALUATED',
      fixedSource: REFS.pr6, instrumentedObservationsOnly: true,
      fixedInputs: { viewport: SCENARIOS[1], textScale: '100%', profile: 'light', traceEnabled: false,
        periodicSample: false, apiTiming: true, gpuTimer: true, seed: 20261005,
        requestedWarmupMs: WARMUP_MS, requestedWindowMs: WINDOW_MS },
      capabilityBlockers: cells.filter(cell => cell.gpuTimer?.capability.status?.startsWith('unsupported'))
        .map(cell => ({ id: cell.id, capability: cell.gpuTimer.capability })),
      interpretation: [
        'Only the fixed PR6 source a8ca1a5d681648d1a620f94cc05e532f86c08255 runs in two fresh 1280x800 Normal/light contexts. No runtime, watchdog, quality, shader, render-state or acceptance changes.',
        'Trace/periodic sampling remain off; initial, boundary, final reads, passive observers and API/rAF hooks are the same as the matched-source phase.',
        'At most 256 original draw calls in the first Normal-playing frame are bracketed by native elapsed queries; its existing fenceSync closes capture. Every original draw is executed exactly once with its original receiver and arguments.',
        'The only added GL commands are timer capability/query commands. There is no added render, flush, finish, fence, readPixels, recurring timer or wait loop.',
        'Results are checked once at final finish after the existing observation window. Unavailable capability, disjoint values, pending results, missing frame boundaries, overflow and instrumentation errors are explicit; none produces fabricated GPU times.',
        'Native query calls bypass the API wrappers. Their CPU-observed overhead and upload hashing overhead are reported separately; instrumentation may still perturb execution and submission.',
        'Position-buffer FNV-1a signatures, byte lengths, program IDs and draw arguments aid source correspondence. Hash caps, reuploads and later writes may prevent mapping; a 32-bit signature alone is not proof of identity.',
        'Compare valid per-draw elapsed times and their coverage with the same frame fence completion/poll gaps. Draw elapsed excludes clears, uploads and other work and is not a complete frame/compositor/notification measurement.',
        'Only two instrumented flights on one renderer are observed. Sum GPU draw times only for complete valid uncapped captures; partial valid sums are labelled partial coverage.',
        'A successful diagnostic collection, including a capability blocker, is not game acceptance, a GPU performance pass, or release approval.',
      ],
    }, null, 2));
  }
  expect(cells).toHaveLength(2);
  expect(cells.every(cell => cell.ref === 'pr6' && cell.traceEnabled === false && cell.periodicSample === false && cell.periodicSampleCount === 0)).toBe(true);
  expect(cells.every(cell => cell.apiTiming?.enabled && cell.apiTiming.rafWrapped && cell.apiTiming.wrappedMethodCount > 0)).toBe(true);
  expect(cells.every(cell => cell.apiTiming.installationFailures.length === 0 && cell.apiTiming.recordingErrors === 0 && cell.apiTiming.unrecordedFences === 0)).toBe(true);
  expect(cells.every(cell => cell.gpuTimer?.enabled && cell.gpuTimer.errorCount === 0 && cell.gpuTimer.frame?.observedDraws > 0)).toBe(true);
  expect(cells.every(cell => cell.gpuTimer.draws.length <= 256 && cell.gpuTimer.capability.finalReadPasses <= 1)).toBe(true);
  expect(cells.every(cell => cell.actualSetup?.viewportWidth === 1280 && cell.actualSetup?.viewportHeight === 800
    && cell.actualSetup?.drawingBufferWidth === 1280 && cell.actualSetup?.drawingBufferHeight === 800
    && cell.actualSetup?.devicePixelRatio === 1 && cell.actualSetup?.visibility === 'visible')).toBe(true);
  expect(cells.every(cell => cell.actualSetup?.renderer && cell.actualSetup.renderer === cells[0].actualSetup.renderer
    && cell.actualSetup.version && cell.actualSetup.version === cells[0].actualSetup.version)).toBe(true);
  expect(cells.every(cell => Object.values(cell.actualSetup?.savedSettings ?? {}).length === 3
    && Object.values(cell.actualSetup.savedSettings).every(value => value === null))).toBe(true);
  expect(cells.every(cell => JSON.stringify(cell.seed) === JSON.stringify(cells[0].seed))).toBe(true);
  expect(cells[0].seed?.seed).toBe(20261005);
  expect(cells[0].seed?.mode).toBe('normal');
  expect(cells.filter(cell => cell.experimentError || cell.finalObservationError || cell.traceError || cell.blockedRequests || cell.pageErrorCount)).toEqual([]);
});
