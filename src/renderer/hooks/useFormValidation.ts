import { useState, useCallback, useMemo } from 'react';
import { MAX_FIELD_LENGTHS } from '../../shared/constants';
import {
  validateField as validateFieldUtil,
  sanitizeField,
  type ValidationField,
} from '../../shared/validation';
import { useTranslation } from '../i18n/useTranslation';

export interface FieldConfig {
  validationField: ValidationField;
  maxLength?: number;
  required?: boolean;
  emailWarning?: boolean;
}

export interface FieldState {
  value: string;
  error: string | null;
  isTouched: boolean;
}

export type FormFields<T extends string> = Record<T, FieldConfig>;

interface UseFormValidationOptions<T extends string> {
  fields: FormFields<T>;
  initialValues?: Partial<Record<T, string>>;
  validateOnChange?: boolean;
}

interface UseFormValidationReturn<T extends string> {
  values: Record<T, string>;
  errors: Record<T, string | null>;
  touched: Record<T, boolean>;
  isFormValid: boolean;
  setValue: (field: T, value: string) => void;
  setValues: (values: Partial<Record<T, string>>) => void;
  setError: (field: T, error: string | null) => void;
  clearError: (field: T) => void;
  clearAllErrors: () => void;
  validateField: (field: T) => string | null;
  validateAllFields: () => boolean;
  handleFieldChange: (field: T, value: string) => string;
  handleBlur: (field: T) => void;
  resetForm: () => void;
  getFieldMaxLength: (field: T) => number;
  getCharCount: (field: T) => { current: number; max: number; percentage: number };
  shouldShowCharCount: (field: T) => boolean;
  sanitizeValue: (field: T, value: string) => string;
}

export function useFormValidation<T extends string>(
  options: UseFormValidationOptions<T>,
): UseFormValidationReturn<T> {
  const { fields, initialValues = {} as Partial<Record<T, string>>, validateOnChange = true } = options;
  const { t } = useTranslation();

  const fieldNames = useMemo(() => Object.keys(fields) as T[], [fields]);

  const [values, setValuesState] = useState<Record<T, string>>(() => {
    const initial = {} as Record<T, string>;
    const initVals = initialValues as Record<string, string>;
    for (const name of fieldNames) {
      initial[name] = initVals[name as string] ?? '';
    }
    return initial;
  });

  const [errors, setErrors] = useState<Record<T, string | null>>(() => {
    const initial = {} as Record<T, string | null>;
    for (const name of fieldNames) {
      initial[name] = null;
    }
    return initial;
  });

  const [touched, setTouched] = useState<Record<T, boolean>>(() => {
    const initial = {} as Record<T, boolean>;
    for (const name of fieldNames) {
      initial[name] = false;
    }
    return initial;
  });

  const getFieldMaxLength = useCallback(
    (field: T): number => {
      const config = fields[field];
      if (config.maxLength !== undefined) return config.maxLength;

      const limitMap: Partial<Record<ValidationField, number>> = {
        folderName: MAX_FIELD_LENGTHS.FOLDER_NAME,
        itemTitle: MAX_FIELD_LENGTHS.ITEM_TITLE,
        username: MAX_FIELD_LENGTHS.USERNAME,
        password: MAX_FIELD_LENGTHS.PASSWORD,
        url: MAX_FIELD_LENGTHS.URL,
        notes: MAX_FIELD_LENGTHS.NOTES,
        tagName: MAX_FIELD_LENGTHS.TAG_NAME,
      };

      return limitMap[config.validationField] ?? 1000;
    },
    [fields],
  );

  const sanitizeValue = useCallback(
    (field: T, value: string): string => {
      return sanitizeField(fields[field].validationField, value);
    },
    [fields],
  );

  const validateSingleField = useCallback(
    (field: T, value: string): string | null => {
      const config = fields[field];
      const errorKey = validateFieldUtil(config.validationField, value);

      if (errorKey) {
        if (errorKey === 'validation.maxLength') {
          return t('validation.maxLength', { max: getFieldMaxLength(field) });
        }
        return t(errorKey);
      }

      if (config.required && value.trim().length === 0) {
        return t('validation.required');
      }

      if (config.emailWarning && value.length > 0) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          return t('validation.emailWarning');
        }
      }

      return null;
    },
    [fields, t, getFieldMaxLength],
  );

  const validateField = useCallback(
    (field: T): string | null => {
      const error = validateSingleField(field, values[field]);
      setErrors((prev) => ({ ...prev, [field]: error }));
      return error;
    },
    [values, validateSingleField],
  );

  const isFormValid = useMemo(() => {
    return fieldNames.every((name) => {
      const error = validateSingleField(name, values[name]);
      return error === null;
    });
  }, [fieldNames, values, validateSingleField]);

  const setValue = useCallback(
    (field: T, value: string) => {
      setValuesState((prev) => ({ ...prev, [field]: value }));

      if (validateOnChange) {
        const error = validateSingleField(field, value);
        setErrors((prev) => ({ ...prev, [field]: error }));
      }
    },
    [validateOnChange, validateSingleField],
  );

  const setValues = useCallback(
    (newValues: Partial<Record<T, string>>) => {
      setValuesState((prev) => ({ ...prev, ...newValues }));

      if (validateOnChange) {
        for (const [field, value] of Object.entries(newValues) as [T, string][]) {
          const error = validateSingleField(field, value);
          setErrors((prev) => ({ ...prev, [field]: error }));
        }
      }
    },
    [validateOnChange, validateSingleField],
  );

  const setError = useCallback((field: T, error: string | null) => {
    setErrors((prev) => ({ ...prev, [field]: error }));
  }, []);

  const clearError = useCallback((field: T) => {
    setErrors((prev) => ({ ...prev, [field]: null }));
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors((prev) => {
      const next = { ...prev };
      for (const name of fieldNames) {
        next[name] = null;
      }
      return next;
    });
  }, [fieldNames]);

  const validateAllFields = useCallback((): boolean => {
    let allValid = true;
    const newErrors = {} as Record<T, string | null>;

    for (const name of fieldNames) {
      const error = validateSingleField(name, values[name]);
      newErrors[name] = error;
      if (error) allValid = false;
    }

    setErrors(newErrors);
    return allValid;
  }, [fieldNames, values, validateSingleField]);

  const handleFieldChange = useCallback(
    (field: T, value: string): string => {
      const sanitized = sanitizeValue(field, value);
      setValue(field, sanitized);
      return sanitized;
    },
    [sanitizeValue, setValue],
  );

  const handleBlur = useCallback(
    (field: T) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      validateField(field);
    },
    [validateField],
  );

  const resetForm = useCallback(() => {
    const newValues = {} as Record<T, string>;
    const newErrors = {} as Record<T, string | null>;
    const newTouched = {} as Record<T, boolean>;
    const initVals = initialValues as Record<string, string>;

    for (const name of fieldNames) {
      newValues[name] = initVals[name as string] ?? '';
      newErrors[name] = null;
      newTouched[name] = false;
    }

    setValuesState(newValues);
    setErrors(newErrors);
    setTouched(newTouched);
  }, [fieldNames, initialValues]);

  const getCharCount = useCallback(
    (field: T) => {
      const max = getFieldMaxLength(field);
      const current = values[field]?.length ?? 0;
      return {
        current,
        max,
        percentage: (current / max) * 100,
      };
    },
    [values, getFieldMaxLength],
  );

  const shouldShowCharCount = useCallback(
    (field: T) => {
      const { percentage } = getCharCount(field);
      return percentage >= 80;
    },
    [getCharCount],
  );

  return {
    values,
    errors,
    touched,
    isFormValid,
    setValue,
    setValues,
    setError,
    clearError,
    clearAllErrors,
    validateField,
    validateAllFields,
    handleFieldChange,
    handleBlur,
    resetForm,
    getFieldMaxLength,
    getCharCount,
    shouldShowCharCount,
    sanitizeValue,
  };
}

export default useFormValidation;
