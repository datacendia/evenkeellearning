// scripts/md-to-pdf.mjs
//
// Tiny one-shot helper: render a single markdown file to a styled PDF
// using Playwright's bundled Chromium. Intended for one-off proposal /
// release-note PDFs, not for the build pipeline.
//
// Usage:
//   node scripts/md-to-pdf.mjs <input.md> <output.pdf>

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { chromium } from "playwright";

// Minimal CommonMark-ish renderer. We deliberately avoid a markdown
// dependency: this script is one-off and the input is hand-authored.
// If a future caller needs full CommonMark, swap to `marked` or
// `markdown-it`.
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inList = false;
  let inCode = false;
  let inPara = false;

  const closePara = () => {
    if (inPara) { out.push("</p>"); inPara = false; }
  };
  const closeList = () => {
    if (inList) { out.push("</ul>"); inList = false; }
  };

  function inline(s) {
    // escape
    s = s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // code spans
    s = s.replace(/`([^`]+)`/g, (_, t) => `<code>${t}</code>`);
    // bold
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // italic
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    // em-dash already in source as plain unicode; pass through.
    return s;
  }

  for (const raw of lines) {
    const line = raw;

    if (/^```/.test(line)) {
      closePara(); closeList();
      if (!inCode) { out.push('<pre><code>'); inCode = true; }
      else { out.push('</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(line.replace(/&/g, "&amp;").replace(/</g, "&lt;")); continue; }

    if (/^---\s*$/.test(line)) { closePara(); closeList(); out.push("<hr/>"); continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closePara(); closeList();
      const level = m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      continue;
    }
    if ((m = line.match(/^[-*]\s+(.*)$/))) {
      closePara();
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (line.trim() === "") {
      closePara(); closeList();
      continue;
    }
    closeList();
    if (!inPara) { out.push("<p>"); inPara = true; }
    else { out.push(" "); }
    out.push(inline(line));
  }
  closePara(); closeList();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

const css = `
  @page { size: A4; margin: 18mm 18mm 20mm 18mm; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Georgia", "Iowan Old Style", "Palatino Linotype", serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #1d1f23;
  }
  h1 {
    font-family: "Helvetica Neue", "Inter", "Segoe UI", sans-serif;
    font-size: 22pt;
    margin: 0 0 4pt 0;
    color: #0b3d2e;
    letter-spacing: -0.01em;
  }
  h2 {
    font-family: "Helvetica Neue", "Inter", "Segoe UI", sans-serif;
    font-size: 13pt;
    margin: 14pt 0 4pt 0;
    color: #0b3d2e;
    border-bottom: 0.5pt solid #c9a84c;
    padding-bottom: 2pt;
  }
  h3 {
    font-family: "Helvetica Neue", "Inter", "Segoe UI", sans-serif;
    font-size: 11pt;
    margin: 10pt 0 2pt 0;
    color: #2a2a2a;
  }
  p { margin: 4pt 0; text-align: justify; hyphens: auto; }
  ul { margin: 4pt 0 6pt 16pt; padding: 0; }
  li { margin: 2pt 0; }
  hr {
    border: 0;
    border-top: 0.4pt solid #c9a84c;
    margin: 10pt 0;
  }
  strong { color: #0b3d2e; }
  em { color: #1d1f23; }
  code {
    font-family: "Consolas", "Monaco", monospace;
    font-size: 9.5pt;
    background: #f5f0e1;
    padding: 0 2pt;
    border-radius: 2pt;
  }
  pre {
    background: #f5f0e1;
    padding: 8pt 10pt;
    border-left: 2pt solid #c9a84c;
    page-break-inside: avoid;
    font-size: 9pt;
  }
  pre code { background: transparent; padding: 0; }
  a { color: #0b3d2e; text-decoration: none; border-bottom: 0.4pt dotted #0b3d2e; }
  /* Footer-ish closing italic block */
  p:last-of-type em { color: #5a5a5a; }
`;

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/md-to-pdf.mjs <input.md> <output.pdf>");
    process.exit(1);
  }
  const md = readFileSync(resolve(inputPath), "utf8");
  const body = renderMarkdown(md);
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${basename(inputPath)}</title><style>${css}</style></head><body>${body}</body></html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", right: "18mm", bottom: "20mm", left: "18mm" },
    });
    writeFileSync(resolve(outputPath), buf);
    console.log(`Wrote ${outputPath} (${buf.length} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
