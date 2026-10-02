/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Resolve an opencv.js module once its WASM runtime is ready. Emscripten's module is a thenable whose
 * `then` hands back the module itself, so awaiting it directly loops forever; strip `then` first.
 */
export function cvReady(mod: any): Promise<any> {
  return new Promise((resolve) => {
    if (mod?.Mat) return resolve(mod);
    if (typeof mod?.then === "function") {
      mod.then((m: any) => {
        delete m.then;
        resolve(m);
      });
      return;
    }
    mod.onRuntimeInitialized = () => resolve(mod);
  });
}
