import { Fragment } from 'react';
import { cn } from '@/lib/cn';
import { parseMarkdown, type MarkdownInline } from '@/lib/markdown';
import styles from './Markdown.module.css';

export interface MarkdownProps {
  value: string;
  className?: string;
}

function InlineNodes({ nodes }: { nodes: MarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={index}>{node.value}</Fragment>;
          case 'strong':
            return (
              <strong key={index}>
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <InlineNodes nodes={node.children} />
              </em>
            );
          case 'code':
            return <code key={index}>{node.value}</code>;
          case 'link':
            return (
              <a
                key={index}
                href={node.href}
                rel="nofollow noopener noreferrer"
                target="_blank"
              >
                <InlineNodes nodes={node.children} />
              </a>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

/**
 * Safe renderer for the simple Markdown subset in `@/lib/markdown`.
 *
 * It renders React nodes (never `dangerouslySetInnerHTML`), so user text is
 * escaped by React and raw HTML stays visible as text. Only http(s) links
 * survive parsing.
 */
export function Markdown({ value, className }: MarkdownProps) {
  const blocks = parseMarkdown(value);
  if (blocks.length === 0) return null;
  return (
    <div className={cn(styles.markdown, className)}>
      {blocks.map((block, index) =>
        block.type === 'paragraph' ? (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                <InlineNodes nodes={line} />
              </Fragment>
            ))}
          </p>
        ) : block.ordered ? (
          <ol key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineNodes nodes={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineNodes nodes={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
