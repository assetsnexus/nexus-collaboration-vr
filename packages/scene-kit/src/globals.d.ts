/**
 * `structuredClone` is a global in Node 17+ and every modern browser, but this
 * package intentionally types itself with `lib: ["ES2022"]` only (no DOM, no
 * `@types/node`) so it stays headless/isomorphic. Declare the one global we use.
 */
declare function structuredClone<T>(value: T): T
