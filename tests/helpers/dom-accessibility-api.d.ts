// dom-accessibility-api 0.5.16 ships declarations in dist/index.d.ts but its package.json `exports`
// map has no "types" condition, so "moduleResolution: bundler" cannot resolve them (TS7016). This
// ambient declaration supplies just the one function this repo uses, for the O2 regression test.
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(
    element: Element,
    options?: { computedStyleSupportsPseudoElements?: boolean },
  ): string;
}
