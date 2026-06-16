import React, { useId } from 'react';
import { useTranslation } from '../../i18n/useTranslation';

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  showCharCount?: boolean;
  charCount?: { current: number; max: number };
  containerClassName?: string;
  labelClassName?: string;
  inputWrapperClassName?: string;
  errorClassName?: string;
  charCountClassName?: string;
}

export function FormField({
  label,
  error,
  showCharCount = false,
  charCount,
  containerClassName = '',
  labelClassName = '',
  inputWrapperClassName = '',
  errorClassName = '',
  charCountClassName = '',
  className: inputClassName = '',
  id: propId,
  ...inputProps
}: FormFieldProps): React.ReactElement {
  const autoId = useId();
  const id = propId ?? autoId;
  const errorId = `${id}-error`;
  const charCountId = `${id}-charcount`;
  const { t } = useTranslation();

  const hasError = Boolean(error);
  const isNearLimit = showCharCount && charCount ? charCount.current >= charCount.max * 0.8 : false;
  const isAtLimit = showCharCount && charCount ? charCount.current >= charCount.max : false;

  const describedBy = [
    hasError ? errorId : null,
    showCharCount && charCount ? charCountId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`space-y-1 ${containerClassName}`}>
      {label && (
        <label
          htmlFor={id}
          className={`text-xs font-bold uppercase tracking-wider text-surface-400 ${labelClassName}`}
        >
          {label}
        </label>
      )}
      <div className={`relative ${inputWrapperClassName}`}>
        <input
          id={id}
          className={`w-full border-0 bg-transparent p-0 text-base text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0 dark:text-surface-200 ${
            hasError ? 'border-b-2 border-danger-400' : ''
          } ${inputClassName}`}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          {...inputProps}
        />
      </div>

      <div className="flex items-center justify-between min-h-[1.25rem]">
        <div className="flex-1">
          {hasError && (
            <p
              id={errorId}
              role="alert"
              className={`text-xs text-danger-500 ${errorClassName}`}
            >
              {error}
            </p>
          )}
        </div>
        {showCharCount && charCount && (
          <p
            id={charCountId}
            className={`text-xs tabular-nums ${
              isAtLimit
                ? 'text-danger-500 font-medium'
                : isNearLimit
                  ? 'text-warning-500'
                  : 'text-surface-400'
            } ${charCountClassName}`}
            aria-live="polite"
          >
            {t('validation.charCount', {
              current: charCount.current,
              max: charCount.max,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

export interface FormFieldTextAreaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string | null;
  showCharCount?: boolean;
  charCount?: { current: number; max: number };
  containerClassName?: string;
  labelClassName?: string;
  inputWrapperClassName?: string;
  errorClassName?: string;
  charCountClassName?: string;
}

export function FormFieldTextArea({
  label,
  error,
  showCharCount = false,
  charCount,
  containerClassName = '',
  labelClassName = '',
  inputWrapperClassName = '',
  errorClassName = '',
  charCountClassName = '',
  className: textareaClassName = '',
  id: propId,
  ...textareaProps
}: FormFieldTextAreaProps): React.ReactElement {
  const autoId = useId();
  const id = propId ?? autoId;
  const errorId = `${id}-error`;
  const charCountId = `${id}-charcount`;
  const { t } = useTranslation();

  const hasError = Boolean(error);
  const isNearLimit = showCharCount && charCount ? charCount.current >= charCount.max * 0.8 : false;
  const isAtLimit = showCharCount && charCount ? charCount.current >= charCount.max : false;

  const describedBy = [
    hasError ? errorId : null,
    showCharCount && charCount ? charCountId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`space-y-1 ${containerClassName}`}>
      {label && (
        <label
          htmlFor={id}
          className={`text-xs font-bold uppercase tracking-wider text-surface-400 ${labelClassName}`}
        >
          {label}
        </label>
      )}
      <div className={`relative ${inputWrapperClassName}`}>
        <textarea
          id={id}
          className={`w-full border-0 bg-transparent p-0 text-base text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0 dark:text-surface-200 resize-none ${
            hasError ? 'border-b-2 border-danger-400' : ''
          } ${textareaClassName}`}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          {...textareaProps}
        />
      </div>

      <div className="flex items-center justify-between min-h-[1.25rem]">
        <div className="flex-1">
          {hasError && (
            <p
              id={errorId}
              role="alert"
              className={`text-xs text-danger-500 ${errorClassName}`}
            >
              {error}
            </p>
          )}
        </div>
        {showCharCount && charCount && (
          <p
            id={charCountId}
            className={`text-xs tabular-nums ${
              isAtLimit
                ? 'text-danger-500 font-medium'
                : isNearLimit
                  ? 'text-warning-500'
                  : 'text-surface-400'
            } ${charCountClassName}`}
            aria-live="polite"
          >
            {t('validation.charCount', {
              current: charCount.current,
              max: charCount.max,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

export interface InlineFormFieldProps {
  error?: string | null;
  showCharCount?: boolean;
  charCount?: { current: number; max: number };
  errorClassName?: string;
  charCountClassName?: string;
  children?: React.ReactNode;
}

export function InlineFormField({
  error,
  showCharCount = false,
  charCount,
  errorClassName = '',
  charCountClassName = '',
  children,
}: InlineFormFieldProps): React.ReactElement {
  const autoId = useId();
  const errorId = `${autoId}-error`;
  const charCountId = `${autoId}-charcount`;
  const { t } = useTranslation();

  const hasError = Boolean(error);
  const isNearLimit = showCharCount && charCount ? charCount.current >= charCount.max * 0.8 : false;
  const isAtLimit = showCharCount && charCount ? charCount.current >= charCount.max : false;

  const describedBy = [
    hasError ? errorId : null,
    showCharCount && charCount ? charCountId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  const enhancedChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && (child.type === 'input' || child.type === 'textarea' || child.type === 'select')) {
      return React.cloneElement(child as React.ReactElement<React.HTMLAttributes<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>>, {
        'aria-invalid': hasError || undefined,
        'aria-describedby': describedBy,
      });
    }
    return child;
  });

  return (
    <div>
      {enhancedChildren}
      <div className="flex items-center justify-between min-h-[1.25rem]">
        <div className="flex-1">
          {hasError && (
            <p
              id={errorId}
              role="alert"
              className={`text-xs text-danger-500 ${errorClassName}`}
            >
              {error}
            </p>
          )}
        </div>
        {showCharCount && charCount && (
          <p
            id={charCountId}
            className={`text-xs tabular-nums ${
              isAtLimit
                ? 'text-danger-500 font-medium'
                : isNearLimit
                  ? 'text-warning-500'
                  : 'text-surface-400'
            } ${charCountClassName}`}
            aria-live="polite"
          >
            {t('validation.charCount', {
              current: charCount.current,
              max: charCount.max,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

export default FormField;
