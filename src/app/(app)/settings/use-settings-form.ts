'use client';

import { useState, useTransition } from 'react';
import { saveSettings } from '../../lib/actions/settings';

/** Local form state for a group of settings, saved together with field-level errors. */
export function useSettingsForm<T extends Record<string, unknown>>(
  initial: T,
  toChanges: (values: T) => Record<string, unknown>,
) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof T>(key: K, value: T[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function save() {
    startTransition(async () => {
      const result = await saveSettings(toChanges(values));
      if (result.ok) {
        setErrors({});
        setSaved(true);
      } else {
        setErrors(result.errors);
        setSaved(false);
      }
    });
  }

  const errorFor = (settingKey: string): string | undefined => errors[settingKey]?.join(' ');
  return { values, set, save, pending, saved, errorFor, hasErrors: Object.keys(errors).length > 0 };
}
