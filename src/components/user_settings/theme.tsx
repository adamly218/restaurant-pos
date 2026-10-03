import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { appPage } from '@/store/jotai.ts';
import { cn } from '@/lib/utils.ts';
import { Input } from '@/components/common/input/input.tsx';
import { useTheme } from '@/providers/theme.provider.tsx';
import {
  BRAND_IDS,
  DEFAULT_BRAND,
  DEFAULT_THEME,
  THEME_PREFERENCES,
  rgbChannelsToHex,
  type AppBrandId,
  type AppThemePreference,
} from '@/lib/theme.ts';
import {
  normalizeCustomBase,
  normalizeHex,
  type CustomPaletteBase,
} from '@/lib/derive-brand-palette.ts';
import { resolveBrandPalette } from '@/lib/brand-palettes.ts';

/** The four base colors a custom theme is built from. */
const BASE_FIELDS: Array<{ key: keyof CustomPaletteBase; labelKey: string }> = [
  { key: 'canvas', labelKey: 'theme.colorCanvas' },
  { key: 'surface', labelKey: 'theme.colorSurface' },
  { key: 'foreground', labelKey: 'theme.colorForeground' },
  { key: 'primary', labelKey: 'theme.colorPrimary' },
];

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (raw: string) => {
    const hex = normalizeHex(raw);
    if (hex) onChange(hex);
    else setDraft(value);
  };

  return (
    <div>
      <label className="form-label">{label}</label>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          className="h-12 w-16 flex-1 cursor-pointer p-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="min-w-0 flex-1">
          <Input
            type="text"
            className="h-12"
            value={draft}
            placeholder="#000000"
            onChange={(e) => {
              setDraft(e.target.value);
              // Apply as soon as the value is a valid hex (so typed colors show).
              const hex = normalizeHex(e.target.value);
              if (hex) onChange(hex);
            }}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export const ThemeSettings = () => {
  const [page, setPage] = useAtom(appPage);
  const { t } = useTranslation('settings');
  const { resolvedTheme } = useTheme();
  const currentTheme: AppThemePreference = page.theme ?? DEFAULT_THEME;
  const currentBrand: AppBrandId = page.brand ?? DEFAULT_BRAND;

  // Four base colors (hex); seeded from an older single primary if needed.
  const base = useMemo(
    () => normalizeCustomBase(page.customPaletteBase ?? page.customPrimary),
    [page.customPaletteBase, page.customPrimary],
  );
  const preview = useMemo(
    () => resolveBrandPalette('custom', resolvedTheme, base),
    [base, resolvedTheme],
  );

  const updateBase = (patch: Partial<CustomPaletteBase>) => {
    setPage((prev) => {
      const next = { ...normalizeCustomBase(prev.customPaletteBase ?? prev.customPrimary), ...patch };
      return { ...prev, brand: 'custom', customPaletteBase: next, customPrimary: next.primary };
    });
  };

  const selectBrand = (brandId: AppBrandId) => {
    setPage((prev) => {
      if (brandId !== 'custom') {
        return { ...prev, brand: brandId };
      }
      const next = normalizeCustomBase(prev.customPaletteBase ?? prev.customPrimary);
      return { ...prev, brand: 'custom', customPaletteBase: next, customPrimary: next.primary };
    });
  };

  return (
    <div className="shadow p-5 rounded-xl bg-surface-elevated" data-testid="settings-card-theme">
      <div className="flex items-start mb-5">
        <div>
          <h2 className="text-xl font-semibold mb-1">{t('theme.title')}</h2>
          <p className="text-sm text-muted">{t('theme.description')}</p>
        </div>
      </div>
      <div className="mb-6 inline-flex overflow-hidden rounded-full border border-border">
        {THEME_PREFERENCES.map((mode) => {
          const active = currentTheme === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setPage((prev) => ({
                  ...prev,
                  theme: mode,
                }));
              }}
              className={cn(
                'px-4 py-1.5 text-sm transition-colors',
                active ? 'bg-primary text-primary-fg font-semibold' : 'text-muted',
              )}
            >
              {t(`theme.${mode}`)}
            </button>
          );
        })}
      </div>

      <div className="mb-3">
        <h3 className="text-base font-semibold mb-1">{t('theme.brandTitle')}</h3>
        <p className="text-sm text-muted">{t('theme.brandDescription')}</p>
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        {BRAND_IDS.map((brandId) => {
          const palette = resolveBrandPalette(brandId, resolvedTheme, base);
          const active = currentBrand === brandId;
          return (
            <button
              key={brandId}
              type="button"
              onClick={() => selectBrand(brandId)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                active ? 'border-primary bg-primary/10 font-semibold' : 'border-border',
              )}
            >
              <span className="flex h-4 w-4 overflow-hidden rounded-full border border-border" aria-hidden>
                <span className="h-full w-1/2" style={{ background: `rgb(${palette.canvas})` }} />
                <span className="h-full w-1/2" style={{ background: `rgb(${palette.primary})` }} />
              </span>
              {t(`theme.brand.${brandId}`)}
            </button>
          );
        })}
      </div>

      {currentBrand === 'custom' ? (
        <div className="rounded-lg border border-border bg-surface p-4" data-testid="settings-custom-brand">
          <p className="text-sm text-muted mb-3">{t('theme.customDescription')}</p>
          <div className="grid gap-3">
            {BASE_FIELDS.map((field) => (
              <ColorField
                key={field.key}
                label={t(field.labelKey)}
                value={base[field.key]}
                onChange={(hex) => updateBase({ [field.key]: hex })}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted">{t('theme.customPreview')}</span>
            {[
              { channels: preview.canvas, label: t('theme.colorCanvas') },
              { channels: preview.surface, label: t('theme.colorSurface') },
              { channels: preview.foreground, label: t('theme.colorForeground') },
              { channels: preview.primary, label: t('theme.colorPrimary') },
              { channels: preview.border, label: t('theme.colorBorder') },
            ].map((swatch) => (
              <span key={swatch.label} className="flex flex-col items-center gap-1">
                <span
                  className="inline-block h-6 w-6 rounded-md border border-border"
                  style={{ backgroundColor: rgbChannelsToHex(swatch.channels) }}
                />
                <span className="text-[10px] text-muted">{swatch.label}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
