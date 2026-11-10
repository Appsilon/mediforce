'use client';

import { useEffect, useMemo, useState } from 'react';
import { isUsableDefaultModel, modelVendor } from '@mediforce/platform-core';
import { useModelRegistry } from '@/hooks/use-model-registry';
import { selectBase } from '@/components/workflows/workflow-editor/step-editor-fields';

interface DefaultModelPickerProps {
  id: string;
  /** The saved default; undefined follows `fallbackLabel`. */
  value: string | undefined;
  /** What an unset default means, e.g. "Platform default". */
  fallbackLabel: string;
  /** `null` clears the default. */
  onChange: (model: string | null) => void;
}

/**
 * A vendor, then one of its live, tool-capable registry models (the assistants
 * and cowork chat always send tools). The vendor only narrows the list.
 */
export function DefaultModelPicker({ id, value, fallbackLabel, onChange }: DefaultModelPickerProps) {
  const registry = useModelRegistry();
  const liveModels = useMemo(
    () => (registry.data ?? []).filter((model) => isUsableDefaultModel(model)),
    [registry.data],
  );
  const vendors = useMemo(
    () => [...new Set(liveModels.map((model) => modelVendor(model.id)))].sort(),
    [liveModels],
  );

  const [vendor, setVendor] = useState(value === undefined ? '' : modelVendor(value));
  useEffect(() => {
    if (value !== undefined) setVendor(modelVendor(value));
  }, [value]);

  const vendorModels = useMemo(
    () => liveModels
      .filter((model) => modelVendor(model.id) === vendor)
      .sort((modelA, modelB) => modelA.name.localeCompare(modelB.name)),
    [liveModels, vendor],
  );
  const valueListed = value === undefined || vendorModels.some((model) => model.id === value);

  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2">
      <select
        aria-label="Model vendor"
        value={vendor}
        onChange={(event) => setVendor(event.target.value)}
        className={selectBase}
      >
        <option value="">Vendor</option>
        {vendors.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
      <select
        id={id}
        aria-label="Default model"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className={selectBase}
      >
        <option value="">{fallbackLabel}</option>
        {valueListed === false && value !== undefined && <option value={value}>{value} (not live)</option>}
        {vendorModels.map((model) => (
          <option key={model.id} value={model.id}>{model.name}</option>
        ))}
      </select>
    </div>
  );
}
