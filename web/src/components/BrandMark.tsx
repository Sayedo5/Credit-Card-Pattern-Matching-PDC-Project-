import type { ApiBrand } from '../api';

/**
 * Accent colours and glyphs are pure styling, keyed by the brand id that the
 * CUDA table hands over. Adding a network on the GPU side without adding a
 * colour here still works — it just falls back to slate.
 */
const BRAND_COLOR: Record<string, string> = {
  visa: '#1a1f71',
  mastercard: '#eb001b',
  amex: '#006fcf',
  jcb: '#0b4ea2',
  diners: '#0079be',
  discover: '#ff6000',
  unionpay: '#e21836',
  maestro: '#6c6bbd',
};

const FALLBACK_COLOR = '#475569';

/**
 * Generic geometric marks in each network's accent colour — not reproductions
 * of the real trademarks.
 */
function Glyph({ id }: { id: string }) {
  const common = { 'aria-hidden': true, focusable: false } as const;

  // Two interlocking circles — the shared Mastercard/Maestro silhouette.
  if (id === 'mastercard' || id === 'maestro') {
    return (
      <svg width="18" height="12" viewBox="0 0 18 12" {...common}>
        <circle cx="6" cy="6" r="5.2" fill="currentColor" opacity="0.95" />
        <circle cx="12" cy="6" r="5.2" fill="currentColor" opacity="0.55" />
      </svg>
    );
  }

  // Discover's single filled dot.
  if (id === 'discover') {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11" {...common}>
        <circle cx="5.5" cy="5.5" r="5" fill="currentColor" />
      </svg>
    );
  }

  // JCB's three stacked bars.
  if (id === 'jcb') {
    return (
      <svg width="13" height="11" viewBox="0 0 13 11" {...common}>
        <rect x="0" y="0" width="3.4" height="11" rx="1.2" fill="currentColor" opacity="0.95" />
        <rect x="4.8" y="0" width="3.4" height="11" rx="1.2" fill="currentColor" opacity="0.7" />
        <rect x="9.6" y="0" width="3.4" height="11" rx="1.2" fill="currentColor" opacity="0.45" />
      </svg>
    );
  }

  // Diners Club's split disc.
  if (id === 'diners') {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11" {...common}>
        <circle cx="5.5" cy="5.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 0.5 A5 5 0 0 1 5.5 10.5 Z" fill="currentColor" />
      </svg>
    );
  }

  return null;
}

type Props = {
  brand: ApiBrand;
  size?: 'md' | 'sm';
  title?: string;
};

export function BrandMark({ brand, size = 'md', title }: Props) {
  return (
    <span
      className={size === 'sm' ? 'mark mark--sm' : 'mark'}
      style={{ background: BRAND_COLOR[brand.id] ?? FALLBACK_COLOR }}
      title={title ?? `${brand.name} — starts with ${brand.prefixLabel}`}
    >
      <span style={{ color: '#fff', display: 'inline-flex' }}>
        <Glyph id={brand.id} />
      </span>
      {brand.short}
    </span>
  );
}
