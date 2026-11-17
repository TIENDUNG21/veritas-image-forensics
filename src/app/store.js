/**
 * Application state. One object, replaced by shallow patches; listeners re-render the parts
 * they own. Small enough that a framework would add more than it saves.
 *
 * @typedef {import('../pipeline/analyze.js').AnalysisResult} AnalysisResult
 * @typedef {import('../render/layers.js').LayerId} LayerId
 * @typedef {{
 *   id: string, file: string, title: string, description: string, layer: LayerId,
 *   bytes: number, edited: unknown
 * }} Sample
 * @typedef {{
 *   phase: 'empty' | 'loading' | 'ready' | 'error',
 *   fileName: string,
 *   progress: import('../pipeline/analyze.js').Progress | null,
 *   error: string | null,
 *   result: AnalysisResult | null,
 *   sample: Sample | null,
 *   layer: LayerId,
 *   opacity: number,
 *   loupe: boolean,
 *   tab: 'summary' | 'jpeg' | 'metadata',
 *   elaQuality: number | null
 * }} State
 */

/** @type {State} */
export const INITIAL = {
  phase: 'empty',
  fileName: '',
  progress: null,
  error: null,
  result: null,
  sample: null,
  layer: 'original',
  opacity: 0.75,
  loupe: false,
  tab: 'summary',
  elaQuality: null,
};

/**
 * @param {State} initial
 */
export function createStore(initial) {
  let state = initial;
  /** @type {Set<(state: State, previous: State) => void>} */
  const listeners = new Set();
  return {
    get: () => state,
    /** @param {Partial<State>} patch */
    set(patch) {
      const previous = state;
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state, previous);
    },
    /** @param {(state: State, previous: State) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */
