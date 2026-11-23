import type { ComponentType } from 'react';

/** Props the core description region passes to a provider editor. */
export interface DescriptionEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export interface DescriptionRendererProps {
  value: string;
}

/**
 * Client half of a compiled-in description provider. The server definition
 * declares capabilities/formats; this supplies the editing experience and the
 * plaintext projection.
 */
export interface DescriptionProviderClient {
  identifier: string;
  defaultFormat: string;
  Editor: ComponentType<DescriptionEditorProps>;
  Renderer: ComponentType<DescriptionRendererProps>;
  serialize: (body: string) => {
    body: string;
    format: string;
    plaintext: string;
  };
}
