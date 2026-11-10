export interface Request { valid: boolean; kind: string }
export function process(req: Request): string {
  if (!req.valid) return "invalid";
  const r = callApi(req);
  if (r.ok) { save(r.value); return "ok"; }
  return "api_error";
}
function callApi(req: Request): { ok: boolean; value: string } {
  try { return { ok: true, value: req.kind }; }
  catch (e) { return { ok: false, value: String(e) }; }
}
function save(v: string): void { if (v) console.log(v); }
export function main(): void { console.log(process({ valid: true, kind: "a" })); }
