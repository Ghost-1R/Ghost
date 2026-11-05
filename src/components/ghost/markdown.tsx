import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/conversation/markdown";

function renderInline(nodes: Inline[], prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}.${index}`;
    if (node.type === "text") {
      return <Fragment key={key}>{node.value}</Fragment>;
    }
    if (node.type === "code") {
      return <code key={key}>{node.value}</code>;
    }
    if (node.type === "strong") {
      return <strong key={key}>{renderInline(node.children, key)}</strong>;
    }
    return <em key={key}>{renderInline(node.children, key)}</em>;
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        if (block.type === "code") {
          return (
            <pre key={key} data-language={block.language ?? undefined}>
              <code>{block.value}</code>
            </pre>
          );
        }
        if (block.type === "heading") {
          return (
            <p key={key} className="markdown-heading">
              <strong>{renderInline(block.children, key)}</strong>
            </p>
          );
        }
        if (block.type === "list") {
          const items = block.items.map((item, itemIndex) => <li key={`${key}.${itemIndex}`}>{renderInline(item, `${key}.${itemIndex}`)}</li>);
          return block.ordered ? (
            <ol key={key} start={block.start === 1 ? undefined : block.start}>
              {items}
            </ol>
          ) : (
            <ul key={key}>{items}</ul>
          );
        }
        return (
          <p key={key}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`${key}.${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, `${key}.${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
