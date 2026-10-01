/** What the `phi_leak` built-in check looks for: each kind of patient identifier and its pattern. */
export const PHI_PATTERNS: readonly (readonly [category: string, pattern: RegExp])[] = [
  ['social security number', /\b\d{3}-\d{2}-\d{4}\b/],
  ['email address', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ['phone number', /(?:\+\d{1,2}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/],
  ['medical record number', /\b(?:MRN|medical record (?:number|no\.?))\s*[:#]?\s*[A-Z0-9-]{5,}/i],
  ['date of birth', /\b(?:DOB|date of birth|born(?: on)?)\s*[:-]?\s*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/i],
];

/** The kinds of patient identifier found in a text — kinds only, so a report never repeats the value. */
export function findPhi(text: string): string[] {
  return PHI_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
}
