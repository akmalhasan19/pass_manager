// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../../../src/renderer/components/ui/ConfirmDialog';

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

describe('ConfirmDialog', () => {
  it('should render the title and message', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Delete Item')).toBeDefined();
    expect(screen.getByText(/Are you sure you want to delete this item/)).toBeDefined();
  });

  it('should render default button labels', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Confirm"
        message="Proceed?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Both title and confirm button have "Confirm" text
    const confirmElements = screen.getAllByText('Confirm');
    expect(confirmElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('should render custom button labels', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Remove"
        message="Remove this folder?"
        confirmLabel="Yes, remove"
        cancelLabel="No, keep it"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Yes, remove')).toBeDefined();
    expect(screen.getByText('No, keep it')).toBeDefined();
  });

  it('should call onConfirm and onCancel when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test message"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        title="Test"
        message="Test message"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should not render when isOpen is false', () => {
    render(
      <ConfirmDialog
        isOpen={false}
        title="Hidden"
        message="Should not be visible"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByText('Hidden')).toBeNull();
    expect(screen.queryByText('Should not be visible')).toBeNull();
  });

  it('should apply danger variant styling', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Dangerous Action"
        message="This is irreversible"
        variant="danger"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('notion-button-danger');
  });

  it('should apply primary variant styling by default', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Normal Action"
        message="This is fine"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('notion-button-primary');
  });

  it('should have aria-label set to title for accessibility', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        title="Accessibility Test"
        message="Testing aria"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Accessibility Test');
  });
});
