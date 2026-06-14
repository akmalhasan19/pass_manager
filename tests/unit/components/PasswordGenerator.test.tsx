// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordGenerator from '../../../src/renderer/components/widgets/PasswordGenerator';

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { initial, animate, exit, transition, variants, layout, ...rest } = props;
      return <div ref={ref} {...rest} />;
    }),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock crypto.getRandomValues
const originalCrypto = globalThis.crypto;

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      getRandomValues: (arr: Uint32Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 0xffffffff);
        }
        return arr;
      },
      randomUUID: originalCrypto?.randomUUID?.bind(originalCrypto),
    },
    configurable: true,
    writable: true,
  });
});

describe('PasswordGenerator', () => {
  it('should render the generator title', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Password Generator')).toBeDefined();
  });

  it('should generate a password on mount', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    // The generated password should be displayed (it's select-all styled)
    const passwordEls = document.querySelectorAll('.select-all');
    expect(passwordEls.length).toBeGreaterThan(0);
    const passwordText = passwordEls[0].textContent;
    expect(passwordText).toBeTruthy();
    expect(passwordText!.length).toBe(20); // default length
  });

  it('should regenerate password when regenerate button is clicked', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Regenerate'));

    const newPassword = document.querySelectorAll('.select-all')[0].textContent;
    // With cryptographically random generation, it's very unlikely to be the same
    // But since we use Math.random() in tests, it will almost always be different
    expect(newPassword).toBeTruthy();
  });

  it('should render length slider with default value 20', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    const slider = screen.getByRole('slider');
    expect(slider).toBeDefined();
    expect(slider.getAttribute('min')).toBe('4');
    expect(slider.getAttribute('max')).toBe('128');
  });

  it('should render all toggle options', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('A-Z (Uppercase)')).toBeDefined();
    expect(screen.getByText('a-z (Lowercase)')).toBeDefined();
    expect(screen.getByText('0-9 (Numbers)')).toBeDefined();
    expect(screen.getByText('!@#$% (Symbols)')).toBeDefined();
    expect(screen.getByText('Exclude ambiguous (0, O, l, 1)')).toBeDefined();
  });

  it('should render Cancel and Use password buttons', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Cancel')).toBeDefined();
    expect(screen.getByText('Use password')).toBeDefined();
  });

  it('should call onClose when Cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onUsePassword and onClose when Use password is clicked', () => {
    const onUsePassword = vi.fn();
    const onClose = vi.fn();

    render(<PasswordGenerator onUsePassword={onUsePassword} onClose={onClose} />);

    fireEvent.click(screen.getByText('Use password'));
    expect(onUsePassword).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    // It should pass the generated password to onUsePassword
    const passedPassword = onUsePassword.mock.calls[0][0];
    expect(passedPassword).toBeTruthy();
    expect(typeof passedPassword).toBe('string');
    expect(passedPassword.length).toBe(20);
  });

  it('should change password length when slider is moved', async () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '32' } });

    // Check that the displayed length text updated
    expect(screen.getByText('32')).toBeDefined();

    // Regenerate to get new password of new length
    fireEvent.click(screen.getByLabelText('Regenerate'));

    const passwordText = document.querySelectorAll('.select-all')[0].textContent;
    expect(passwordText!.length).toBe(32);
  });

  it('should display strength indicator', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    // The progress bar should be present
    const progressBars = document.querySelectorAll('.notion-progress-bar');
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it('should show History section after multiple generations', () => {
    render(<PasswordGenerator onUsePassword={vi.fn()} onClose={vi.fn()} />);

    // Click regenerate multiple times to build history
    const regenerateBtn = screen.getByLabelText('Regenerate');
    fireEvent.click(regenerateBtn);
    fireEvent.click(regenerateBtn);

    // History should now show
    expect(screen.getByText(/History/)).toBeDefined();
  });
});
