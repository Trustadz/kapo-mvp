import type { ComponentType } from 'react';

export interface CommentEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

export interface CommentRendererProps {
  value: string;
}

export interface CommentProviderClient {
  identifier: string;
  defaultFormat: string;
  Editor: ComponentType<CommentEditorProps>;
  Renderer: ComponentType<CommentRendererProps>;
  serialize: (body: string) => {
    body: string;
    format: string;
    plaintext: string;
  };
}
