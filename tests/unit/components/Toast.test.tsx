// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Toast from '../../../src/renderer/components/ui/Toast';

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { initial, animate, exit, transition, layout, ...rest } = props;
      return <div ref={ref} {...rest} />;
    }),
  },
}));

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render the message text', () => {
    render(
      <Toast
        id="toast-1"
        message="Item saved successfully"
        type="success"
        durationMs={3000}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Item saved successfully')).toBeDefined();
  });

  it('should have role="status" for accessibility', () => {
    render(
      <Toast
        id="toast-1"
        message="Notification"
        type="info"
        durationMs={3000}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toBeDefined();
  });

  it('should have aria-live="polite"', () => {
    render(
      <Toast
        id="toast-1"
        message="Notification"
        type="info"
        durationMs={3000}
        onDismiss={vi.fn()}
      />,
    );

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('should render dismiss button with accessible label', () => {
    render(
      <Toast id="toast-1" message="Dismiss me" type="info" durationMs={3000} onDismiss={vi.fn()} />,
    );

    const dismissBtn = screen.getByLabelText('Dismiss notification');
    expect(dismissBtn).toBeDefined();
  });

  it('should call onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        id="toast-xyz"
        message="Click dismiss"
        type="info"
        durationMs={3000}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(onDismiss).toHaveBeenCalledWith('toast-xyz');
  });

  it('should auto-dismiss after the specified duration', () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        id="auto-dismiss"
        message="Auto dismiss"
        type="success"
        durationMs={5000}
        onDismiss={onDismiss}
      />,
    );

    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onDismiss).toHaveBeenCalledWith('auto-dismiss');
  });

  it('should not auto-dismiss before the duration elapses', () => {
    const onDismiss = vi.fn();
    render(
      <Toast id="early" message="Not yet" type="success" durationMs={5000} onDismiss={onDismiss} />,
    );

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should clear timeout on unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <Toast
        id="unmount-test"
        message="Will unmount"
        type="info"
        durationMs={5000}
        onDismiss={onDismiss}
      />,
    );

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('should render success toast with correct styling', () => {
    render(
      <Toast id="s1" message="Success!" type="success" durationMs={3000} onDismiss={vi.fn()} />,
    );

    const status = screen.getByRole('status');
    expect(status.className).toContain('bg-success-500');
  });

  it('should render error toast with correct styling', () => {
    render(<Toast id="e1" message="Error!" type="error" durationMs={3000} onDismiss={vi.fn()} />);

    const status = screen.getByRole('status');
    expect(status.className).toContain('bg-danger-500');
  });

  it('should render info toast with correct styling', () => {
    render(<Toast id="i1" message="Info" type="info" durationMs={3000} onDismiss={vi.fn()} />);

    const status = screen.getByRole('status');
    expect(status.className).toContain('bg-surface-800');
  });

  it('should call onDismiss with the correct id on button click', () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        id="specific-id-123"
        message="Test"
        type="info"
        durationMs={3000}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('specific-id-123');
  });
});
