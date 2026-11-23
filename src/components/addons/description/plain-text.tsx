'use client';

import { useId } from 'react';
import { Field, Textarea } from '@/components/ui';
import { PLAINTEXT_DESCRIPTION_FORMAT } from '@/lib/description';
import type { DescriptionProviderClient } from './types';

function PlainTextEditor({
  label,
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const textareaId = `description-plain-${id.replace(/:/g, '')}`;
  return (
    <Field label={label} htmlFor={textareaId}>
      <Textarea
        id={textareaId}
        value={value}
        rows={8}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  );
}

/**
 * Core plain-text fallback used when no description provider is active.
 * It is not a registered add-on; it keeps the description editable as text.
 */
export const plainTextDescriptionProviderClient: DescriptionProviderClient = {
  identifier: 'plain-text',
  defaultFormat: PLAINTEXT_DESCRIPTION_FORMAT,
  Editor: PlainTextEditor,
  Renderer: ({ value }) => <p>{value}</p>,
  serialize: (body) => ({
    body,
    format: PLAINTEXT_DESCRIPTION_FORMAT,
    plaintext: body,
  }),
};
