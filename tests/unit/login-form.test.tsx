import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginForm } from '@/components/auth/LoginForm';

/**
 * The login screen switches between password, SSO and SSO-only without
 * rendering a password form that the API would reject.
 */

function render(overrides: Partial<Parameters<typeof LoginForm>[0]> = {}): string {
  return renderToStaticMarkup(
    <LoginForm
      ssoEnabled
      ssoProviderName="PocketID"
      passwordLoginEnabled
      errorCode={null}
      {...overrides}
    />,
  );
}

describe('LoginForm SSO states', () => {
  it('renders the PocketID link next to the password form when both are on', () => {
    const html = render();
    expect(html).toContain('Continue with PocketID');
    expect(html).toContain('id="login-username"');
    expect(html).toContain('id="login-password"');
    expect(html).toContain('href="/api/auth/pocketid/start"');
  });

  it('renders only the PocketID link when password login is disabled', () => {
    const html = render({ passwordLoginEnabled: false });
    expect(html).toContain('Continue with PocketID');
    expect(html).not.toContain('id="login-password"');
    expect(html).not.toContain('id="login-username"');
  });

  it('does not render an SSO link when OIDC is not configured', () => {
    const html = render({ ssoEnabled: false });
    expect(html).not.toContain('Continue with PocketID');
    expect(html).toContain('id="login-password"');
  });

  it('maps a callback error code to a translated message', () => {
    const html = render({ errorCode: 'email_ambiguous' });
    expect(html).toContain(
      'More than one account uses this email. Contact an application Admin.',
    );
  });
});
