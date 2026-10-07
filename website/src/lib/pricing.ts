// The self-serve support tiers, what they cost, and the doors that take the money.
//
// Every amount and every buy button on the Support section comes from
// src/data/stripe-manifest.json, through here. None of them is typed in a
// component. The manifest is printed from the Atmosphere Stripe account by
// `node scripts/stripe.mjs manifest` (src/data/README.md) and is never edited
// by hand. The guards below run inside `astro build`, so a manifest that does
// not fit the grid the page prints fails the deploy instead of shipping a
// button that charges something other than what the card says.

import manifestJson from '../data/stripe-manifest.json';

export type SoldTier = 'developer' | 'production';
type Interval = 'month' | 'year';
const SOLD: readonly SoldTier[] = ['developer', 'production'];
const INTERVALS: readonly Interval[] = ['month', 'year'];

/** What `scripts/stripe.mjs manifest` prints, in Stripe's field names (amounts
    in cents). Declared rather than inferred so `astro check` holds the
    committed file to the shape the script writes. */
type ManifestEntry = {
  tier: string;
  interval: string;
  price: { currency: string; interval: string; interval_count: number; unit_amount: number };
  link: { url: string; trial_period_days: number | null };
};
const manifest: { livemode: boolean; entries: readonly ManifestEntry[] } = manifestJson;
const MANIFEST = 'src/data/stripe-manifest.json';
const REGENERATE = 'Print it again with `node scripts/stripe.mjs manifest` (src/data/README.md).';

export type TierPrices = {
  /** USD per month. */
  monthly: number;
  /** USD per year: ten months of the monthly rate (guard 3). */
  yearly: number;
  monthlyUrl: string;
  yearlyUrl: string;
};

/**
 * GUARD 1 — every buy button is a live Stripe payment link for exactly the
 * amount the card prints: one entry per tier × interval, billed in USD, one
 * interval at a time, in whole dollars, on a https://buy.stripe.com/ link that
 * is not a sandbox (`test_`) one and carries no trial — a support contract
 * starts covering the day it is paid.
 */
function door(tier: SoldTier, interval: Interval): { amount: number; url: string } {
  const where = `${tier} ${interval}`;
  const found = manifest.entries.filter((e) => e.tier === tier && e.interval === interval);
  if (found.length !== 1) {
    throw new Error(`pricing: ${MANIFEST} holds ${found.length} entries for ${where}, not one. ${REGENERATE}`);
  }
  const { price, link } = found[0]!;
  if (price.currency !== 'usd' || price.interval !== interval || price.interval_count !== 1) {
    throw new Error(
      `pricing: ${where} bills ${price.currency} every ${price.interval_count} ${price.interval} — ` +
        `the page prints USD, one ${interval} at a time`,
    );
  }
  if (!Number.isInteger(price.unit_amount) || price.unit_amount <= 0 || price.unit_amount % 100 !== 0) {
    throw new Error(
      `pricing: ${where} costs ${price.unit_amount} cents — the page prints whole dollars, ` +
        `so it would quote an amount the checkout does not charge`,
    );
  }
  if (!link.url.startsWith('https://buy.stripe.com/') || link.url.startsWith('https://buy.stripe.com/test_')) {
    throw new Error(`pricing: ${where} must be a live https://buy.stripe.com/ payment link, got "${link.url}". ${REGENERATE}`);
  }
  if (link.trial_period_days !== null) {
    throw new Error(
      `pricing: ${where} offers a ${link.trial_period_days}-day trial the page never mentions — ` +
        `remove it from the payment link at Stripe, then regenerate the manifest`,
    );
  }
  return { amount: price.unit_amount / 100, url: link.url };
}

function prices(tier: SoldTier): TierPrices {
  const month = door(tier, 'month');
  const year = door(tier, 'year');
  return { monthly: month.amount, yearly: year.amount, monthlyUrl: month.url, yearlyUrl: year.url };
}

export const PRICES: Readonly<Record<SoldTier, TierPrices>> = {
  developer: prices('developer'),
  production: prices('production'),
};

// GUARD 2 — the manifest is the grid, the whole grid and nothing else, read
// from the live account, with no url behind two buttons.
if (manifest.entries.length !== SOLD.length * INTERVALS.length) {
  throw new Error(
    `pricing: ${MANIFEST} holds ${manifest.entries.length} entries, but the page sells ` +
      `${SOLD.length * INTERVALS.length} (${SOLD.join('/')} × ${INTERVALS.join('/')})`,
  );
}
const urls = manifest.entries.map((e) => e.link.url);
const shared = [...new Set(urls.filter((u, i) => urls.indexOf(u) !== i))];
if (shared.length > 0) {
  throw new Error(`pricing: ${MANIFEST} puts ${shared.join(', ')} behind more than one button. ${REGENERATE}`);
}
if (manifest.livemode !== true) {
  throw new Error(`pricing: ${MANIFEST} was read with a sandbox key — its links take no money. ${REGENERATE}`);
}

// GUARD 3 — a year is ten months, the discount the card states in words.
// GUARD 4 — Production costs more than Developer on both intervals.
for (const tier of SOLD) {
  const { monthly, yearly } = PRICES[tier];
  if (yearly !== monthly * 10) {
    throw new Error(`pricing: ${tier} yearly ${yearly} is not ten months of ${monthly} — fix the price at Stripe`);
  }
}
for (const key of ['monthly', 'yearly'] as const) {
  if (PRICES.production[key] <= PRICES.developer[key]) {
    throw new Error(`pricing: production ${key} (${PRICES.production[key]}) is not above developer (${PRICES.developer[key]})`);
  }
}

/** A whole-dollar USD amount as the page prints it: $2,000. */
export function usd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
