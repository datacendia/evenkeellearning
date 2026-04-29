"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/JsonViewer.tsx
//
// Pretty-prints JSON with syntactic colouring. Renders using React elements
// only — no `dangerouslySetInnerHTML`, no string-built HTML — so values like
// `"</script>"` cannot escape into the DOM. Safe to use with untrusted JSON.
//
// The SOC 2 CC6.6 / ISO 27001 A.8.27 audit checks specifically grep for
// `dangerouslySetInnerHTML`; this file must remain free of it.
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment, type ReactNode } from "react";

interface Props {
  value: unknown;
  maxHeight?: number;
}

type Token =
  | { kind: "key"; text: string }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "boolean"; text: string }
  | { kind: "null"; text: string }
  | { kind: "punct"; text: string };

const TOKEN_RE =
  /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)|([{}\[\],])/g;

function tokenize(json: string): Array<Token | { kind: "raw"; text: string }> {
  const out: Array<Token | { kind: "raw"; text: string }> = [];
  let last = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(json))) {
    if (match.index > last) {
      out.push({ kind: "raw", text: json.slice(last, match.index) });
    }
    const [, strWithMaybeColon, colon, bool, nul, num, punct] = match;
    if (strWithMaybeColon) {
      if (colon) {
        const name = strWithMaybeColon.slice(0, strWithMaybeColon.length - colon.length);
        out.push({ kind: "key", text: name });
        out.push({ kind: "raw", text: colon });
      } else {
        out.push({ kind: "string", text: strWithMaybeColon });
      }
    } else if (bool) {
      out.push({ kind: "boolean", text: bool });
    } else if (nul) {
      out.push({ kind: "null", text: nul });
    } else if (num) {
      out.push({ kind: "number", text: num });
    } else if (punct) {
      out.push({ kind: "punct", text: punct });
    }
    last = match.index + match[0].length;
  }
  if (last < json.length) out.push({ kind: "raw", text: json.slice(last) });
  return out;
}

function render(token: Token | { kind: "raw"; text: string }, i: number): ReactNode {
  switch (token.kind) {
    case "key":
      return <span key={i} className="json-key">{token.text}</span>;
    case "string":
      return <span key={i} className="json-string">{token.text}</span>;
    case "number":
      return <span key={i} className="json-number">{token.text}</span>;
    case "boolean":
    case "null":
      return <span key={i} className="json-boolean">{token.text}</span>;
    case "punct":
    case "raw":
    default:
      return <Fragment key={i}>{token.text}</Fragment>;
  }
}

export default function JsonViewer({ value, maxHeight = 320 }: Props) {
  const json = JSON.stringify(value, null, 2) ?? "";
  const tokens = tokenize(json);
  return (
    <pre
      className="font-mono rounded-md p-4 overflow-auto"
      style={{
        background: "var(--bg-deep)",
        border: "1px solid var(--border)",
        fontSize: 11,
        lineHeight: 1.55,
        color: "var(--fg)",
        maxHeight,
      }}
    >
      {tokens.map(render)}
    </pre>
  );
}
