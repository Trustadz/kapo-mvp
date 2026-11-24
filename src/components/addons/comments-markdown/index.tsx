'use client';

import { Fragment } from 'react';
import { Textarea } from '@/components/ui';
import {
  parseCommentMarkdown,
  stripCommentMarkdown,
  type CommentInline,
} from '@/lib/comment-markdown';
import type { CommentProviderClient } from '../comments/types';

function InlineNodes({ nodes }: { nodes: CommentInline[] }) {
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
          case 'underline':
            return (
              <u key={index}>
                <InlineNodes nodes={node.children} />
              </u>
            );
          case 'strike':
            return (
              <del key={index}>
                <InlineNodes nodes={node.children} />
              </del>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function CommentRenderer({ value }: { value: string }) {
  const paragraphs = parseCommentMarkdown(value);
  if (paragraphs.length === 0) return null;
  return (
    <div>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph.lines.map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              <InlineNodes nodes={line} />
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

export const commentMarkdownProviderClient: CommentProviderClient = {
  identifier: 'comments-markdown',
  defaultFormat: 'comment-md@1',
  Editor: ({ value, onChange, disabled, placeholder, ariaLabel }) => (
    <Textarea
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.currentTarget.value)}
      rows={3}
      disabled={disabled}
      placeholder={placeholder}
    />
  ),
  Renderer: ({ value }) => <CommentRenderer value={value} />,
  serialize: (body) => ({
    body,
    format: 'comment-md@1',
    plaintext: stripCommentMarkdown(body),
  }),
};
