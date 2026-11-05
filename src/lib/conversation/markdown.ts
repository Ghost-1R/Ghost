export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] };

export type Block =
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "heading"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { type: "code"; language: string | null; value: string };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^`\s]*)\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const LANGUAGE = /^[A-Za-z0-9_+-]{1,24}$/;
const ESCAPABLE = /[\\`*_~#\-+.!()[\]]/;

function isWordChar(char: string | undefined): boolean {
  return Boolean(char && /[\p{L}\p{N}]/u.test(char));
}

function codeSpanEnd(source: string, index: number): number {
  const run = /^`+/.exec(source.slice(index))?.[0] ?? "`";
  const close = source.indexOf(run, index + run.length);
  return close < 0 ? -1 : close + run.length;
}

function findClose(source: string, marker: string, from: number): number {
  let index = from;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      const end = codeSpanEnd(source, index);
      index = end < 0 ? index + 1 : end;
      continue;
    }
    if (source.startsWith(marker, index)) {
      let close = index;
      while (source[close + marker.length] === marker[0]) {
        close += 1;
      }
      const before = source[close - 1];
      const after = source[close + marker.length];
      const doubledSingle = marker.length === 1 && source[index + 1] === marker;
      const intraword = marker[0] === "_" && isWordChar(after);
      if (close > from && before && !/\s/.test(before) && !doubledSingle && !intraword) {
        return close;
      }
      index = close + marker.length;
      continue;
    }
    index += 1;
  }
  return -1;
}

export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      nodes.push({ type: "text", value: text });
      text = "";
    }
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\" && ESCAPABLE.test(source[index + 1] ?? "")) {
      text += source[index + 1];
      index += 2;
      continue;
    }
    if (char === "`") {
      const run = /^`+/.exec(source.slice(index))?.[0] ?? "`";
      const end = codeSpanEnd(source, index);
      if (end > 0) {
        flush();
        const inner = source.slice(index + run.length, end - run.length);
        nodes.push({ type: "code", value: /^ .* $/.test(inner) && inner.trim() ? inner.slice(1, -1) : inner });
        index = end;
        continue;
      }
      text += run;
      index += run.length;
      continue;
    }
    if (char === "*" || char === "_") {
      const double = source[index + 1] === char;
      const marker = double ? char + char : char;
      const next = source[index + marker.length];
      const opens = next !== undefined && !/\s/.test(next) && !(char === "_" && isWordChar(source[index - 1]));
      if (opens) {
        const close = findClose(source, marker, index + marker.length);
        if (close > 0) {
          flush();
          const children = parseInline(source.slice(index + marker.length, close));
          nodes.push(double ? { type: "strong", children } : { type: "em", children });
          index = close + marker.length;
          continue;
        }
      }
      text += marker;
      index += marker.length;
      continue;
    }
    text += char;
    index += 1;
  }
  flush();
  return nodes;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const open: { paragraph: string[]; list: { ordered: boolean; start: number; items: string[] } | null } = { paragraph: [], list: null };

  const closeParagraph = () => {
    if (open.paragraph.length > 0) {
      blocks.push({ type: "paragraph", lines: open.paragraph.map((line) => parseInline(line.trim())) });
      open.paragraph = [];
    }
  };
  const closeList = () => {
    if (open.list) {
      blocks.push({ type: "list", ordered: open.list.ordered, start: open.list.start, items: open.list.items.map((item) => parseInline(item.trim())) });
      open.list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE.exec(line);
    if (fence) {
      closeParagraph();
      closeList();
      const marker = fence[1];
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index].trim().startsWith(marker[0].repeat(marker.length)) && lines[index].trim().replace(/[`~]/g, "") === "")) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", language: LANGUAGE.test(fence[2]) ? fence[2] : null, value: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      blocks.push({ type: "heading", children: parseInline(heading[1]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      closeParagraph();
      const ordered = Boolean(numbered);
      if (open.list && open.list.ordered !== ordered) {
        closeList();
      }
      const target = open.list ?? { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      open.list = target;
      target.items.push(bullet ? bullet[1] : (numbered?.[2] ?? ""));
      continue;
    }
    if (open.list && /^\s+\S/.test(line)) {
      open.list.items[open.list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    closeList();
    open.paragraph.push(line);
  }
  closeParagraph();
  closeList();
  return blocks;
}
