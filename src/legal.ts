import legal from "../mobile/content/legal.json";

type Doc = { title: string; updated: string; sections: [string, string][] };

const DOCS: Record<string, Doc> = {
  terms: legal.terms as Doc,
  privacy: legal.privacy as Doc,
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Public HTML copies of the in-app legal documents (app-store listings need public URLs). */
export function legalHtml(doc: string): string | null {
  const d = DOCS[doc];
  if (!d) return null;
  const body = d.sections
    .map(([h, p]) => `<h2>${esc(h)}</h2><p>${esc(p)}</p>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)} — College Lacrosse News</title><style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#0b1320}h1{color:#14365c}h2{font-size:17px;margin-top:28px;color:#14365c}small{color:#6b7280}</style></head><body><h1>${esc(d.title)}</h1><small>CLN Lacrosse · College Lacrosse News · Last updated ${esc(d.updated)}</small>${body}</body></html>`;
}
