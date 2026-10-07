#!/usr/bin/env node
// The Atmosphere support catalog at Stripe, and the manifest the website prints
// its prices and buy buttons from.
//
//   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe.mjs setup
//   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe.mjs setup --apply --account acct_…
//   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe.mjs manifest > /tmp/m.json \
//     && mv /tmp/m.json src/data/stripe-manifest.json
//
// `setup` makes the account hold exactly the CATALOG below: one product per
// tier, one price per tier × interval (found again by its lookup_key), and one
// payment link per price (found again by its metadata). It creates only what is
// missing and never edits or archives anything; without --apply it only says
// what it would create. --apply also needs --account naming the account the key
// belongs to, because Async-IO and TrailSnag share one Stripe login and a key
// pasted from the wrong account would put Atmosphere's products into
// TrailSnag's, where snag's webhook would queue every sale as a purchase
// nobody can provision.
//
// `manifest` reads the four payment links back and prints what they charge, in
// the shape src/lib/pricing.ts checks at build time. It refuses, printing
// nothing, when a link is missing, doubled, inactive, sells anything but one
// unit of its own catalog price, or when that price drifted from the catalog.
// The output carries only public facts: no key and no price, product or
// account id.
//
// No dependency: Stripe's REST API over fetch, Node 18+.

const API = process.env.STRIPE_API_BASE ?? 'https://api.stripe.com';

/** What Async-IO sells self-serve. Amounts in US cents; a year is ten months.
    Mission-Critical, Legacy and professional services are quoted and never
    appear here. Changing an amount means a NEW price at Stripe (prices are
    immutable): archive the old price and deactivate its payment link at
    Stripe, run `setup --apply`, then regenerate the manifest. */
export const CATALOG = [
  { tier: 'developer', product: 'Atmosphere Developer Support', interval: 'month', unit_amount: 20000 },
  { tier: 'developer', product: 'Atmosphere Developer Support', interval: 'year', unit_amount: 200000 },
  { tier: 'production', product: 'Atmosphere Production Support', interval: 'month', unit_amount: 90000 },
  { tier: 'production', product: 'Atmosphere Production Support', interval: 'year', unit_amount: 900000 },
];
const CURRENCY = 'usd';
const lookupKey = (row) => `atmosphere_${row.tier}_${row.interval}`;

class Refused extends Error {}

function secretKey() {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (key === '') throw new Refused('STRIPE_SECRET_KEY is empty — nothing was read.');
  return key;
}

/** Stripe's form encoding: nested objects and arrays as bracketed keys. */
function form(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object') form(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}

/** A Stripe error message with any key in it blanked, so a pasted log never carries one. */
function redact(text) {
  return String(text).replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, '[key]');
}

async function stripe(method, path, params = {}) {
  const query = method === 'GET' ? `?${form(params)}` : '';
  const res = await fetch(`${API}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? form(params) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error ?? {};
    throw new Refused(
      res.status === 401
        ? 'Stripe refused STRIPE_SECRET_KEY — revoked, mistyped, or not this account\'s'
        : redact(`${method} ${path}: ${res.status} ${e.type ?? ''} ${e.message ?? ''}`.trim()),
    );
  }
  return body;
}

async function listAll(path, params = {}) {
  const out = [];
  let starting_after;
  for (;;) {
    const page = await stripe('GET', path, { ...params, limit: 100, starting_after });
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) return out;
    starting_after = page.data[page.data.length - 1].id;
  }
}

/** The active catalog price for a row, or null. Two is a refusal, never a guess. */
async function findPrice(row) {
  const { data } = await stripe('GET', '/v1/prices', {
    lookup_keys: [lookupKey(row)],
    active: true,
  });
  if (data.length > 1) throw new Refused(`${lookupKey(row)} names ${data.length} active prices`);
  return data[0] ?? null;
}

/** The active payment links carrying a row's catalog key in their metadata. */
function linksFor(links, row) {
  return links.filter((l) => l.active && l.metadata?.atmosphere_catalog === lookupKey(row));
}

/** Everything wrong with a price measured against its catalog row. */
function priceProblems(price, row) {
  const p = [];
  if (price.currency !== CURRENCY) p.push(`bills ${price.currency}, not ${CURRENCY}`);
  if (price.unit_amount !== row.unit_amount) p.push(`costs ${price.unit_amount}, catalog says ${row.unit_amount}`);
  if (!price.recurring) p.push('is not recurring');
  else {
    if (price.recurring.interval !== row.interval || price.recurring.interval_count !== 1) {
      p.push(`bills every ${price.recurring.interval_count} ${price.recurring.interval}, catalog says one ${row.interval}`);
    }
    if (price.recurring.usage_type !== 'licensed') p.push(`is ${price.recurring.usage_type}, not a flat amount`);
  }
  if (price.tax_behavior !== 'exclusive') p.push(`has tax behaviour ${price.tax_behavior ?? 'unset'}, the page says taxes extra`);
  return p.map((s) => `${lookupKey(row)} ${s}`);
}

async function setup(args) {
  const apply = args.includes('--apply');
  const accountArg = args[args.indexOf('--account') + 1];
  const account = await stripe('GET', '/v1/account');
  const name = account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? '(no name)';
  console.error(`account ${account.id} — ${name}`);
  if (apply && (args.indexOf('--account') < 0 || accountArg !== account.id)) {
    throw new Refused(
      `--apply needs --account ${account.id} to confirm this is the Atmosphere account. ` +
        `If "${name}" is not Async-IO, this key is from the wrong account.`,
    );
  }

  const products = await listAll('/v1/products', { active: true });
  const links = await listAll('/v1/payment_links', { active: true });
  const todo = [];

  for (const row of CATALOG) {
    let price = await findPrice(row);
    if (price) {
      const problems = priceProblems(price, row);
      if (problems.length > 0) throw new Refused(problems.join('\n'));
      console.error(`ok      price ${lookupKey(row)}`);
    } else {
      todo.push(`create  price ${lookupKey(row)} — ${row.unit_amount / 100} ${CURRENCY} / ${row.interval}`);
      if (apply) {
        let product = products.find((p) => p.metadata?.atmosphere_tier === row.tier);
        if (!product) {
          product = await stripe('POST', '/v1/products', {
            name: row.product,
            metadata: { atmosphere_tier: row.tier },
          });
          products.push(product);
          console.error(`created product ${row.product}`);
        }
        price = await stripe('POST', '/v1/prices', {
          product: product.id,
          currency: CURRENCY,
          unit_amount: row.unit_amount,
          recurring: { interval: row.interval, interval_count: 1, usage_type: 'licensed' },
          tax_behavior: 'exclusive',
          lookup_key: lookupKey(row),
          // findPrice saw no ACTIVE price with this key, so any holder is an
          // archived one, which keeps its key until it is transferred.
          transfer_lookup_key: true,
        });
        console.error(`created price ${lookupKey(row)}`);
      }
    }

    const found = linksFor(links, row);
    if (found.length > 1) {
      throw new Refused(`${found.length} active payment links carry ${lookupKey(row)} — deactivate all but one at Stripe`);
    }
    if (found.length === 1) {
      console.error(`ok      link  ${lookupKey(row)}`);
      continue;
    }
    todo.push(`create  link  ${lookupKey(row)}`);
    if (apply) {
      const link = await stripe('POST', '/v1/payment_links', {
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { atmosphere_catalog: lookupKey(row) },
        billing_address_collection: 'required',
      });
      links.push(link);
      console.error(`created link  ${lookupKey(row)} ${link.url}`);
    }
  }

  if (!apply) {
    for (const t of todo) console.error(t);
    console.error(todo.length === 0 ? 'nothing to create.' : `dry run — re-run with --apply --account ${account.id}`);
  } else {
    console.error('done — now print the manifest: node scripts/stripe.mjs manifest');
  }
}

/** JSON with every object's keys sorted, so an unchanged account prints byte for byte the same file. */
export function renderManifest(manifest) {
  return (
    JSON.stringify(
      manifest,
      (_k, v) =>
        v !== null && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
          : v,
      2,
    ) + '\n'
  );
}

async function manifest() {
  const links = await listAll('/v1/payment_links', { active: true });
  const problems = [];
  const entries = [];
  let livemode = true;

  for (const row of CATALOG) {
    const found = linksFor(links, row);
    if (found.length !== 1) {
      problems.push(`${found.length} active payment links carry ${lookupKey(row)}, not one — run setup`);
      continue;
    }
    const link = found[0];
    const items = await listAll(`/v1/payment_links/${link.id}/line_items`);
    const item = items.length === 1 ? items[0] : null;
    if (!item?.price) {
      problems.push(`${lookupKey(row)}'s link sells ${items.length} line items, a buy button sells one price`);
      continue;
    }
    if (item.quantity !== 1 || item.adjustable_quantity?.enabled) {
      problems.push(`${lookupKey(row)}'s link sells ${item.quantity} unit(s)${item.adjustable_quantity?.enabled ? ' and lets the buyer change that' : ''}`);
      continue;
    }
    if (item.price.lookup_key !== lookupKey(row)) {
      problems.push(`${lookupKey(row)}'s link sells a price whose lookup_key is ${item.price.lookup_key ?? 'unset'}`);
      continue;
    }
    const drift = priceProblems(item.price, row);
    if (drift.length > 0) {
      problems.push(...drift);
      continue;
    }
    livemode &&= link.livemode && item.price.livemode;
    entries.push({
      tier: row.tier,
      interval: row.interval,
      price: {
        currency: item.price.currency,
        interval: item.price.recurring.interval,
        interval_count: item.price.recurring.interval_count,
        unit_amount: item.price.unit_amount,
      },
      link: { url: link.url, trial_period_days: link.subscription_data?.trial_period_days ?? null },
    });
  }

  if (problems.length > 0) throw new Refused(problems.join('\n'));
  const order = (e) => `${e.tier}/${e.interval}`;
  entries.sort((a, b) => (order(a) < order(b) ? -1 : 1));
  process.stdout.write(renderManifest({ livemode, entries }));
  console.error(`manifest: ${entries.length} prices and links, ${livemode ? 'LIVE' : 'SANDBOX — the build refuses this one'}`);
}

const [command, ...args] = process.argv.slice(2);
const commands = { setup, manifest };
if (!commands[command]) {
  console.error('usage: node scripts/stripe.mjs setup [--apply --account acct_…] | manifest');
  process.exit(2);
}
try {
  await commands[command](args);
} catch (e) {
  if (!(e instanceof Refused)) throw e;
  console.error(`stripe ${command}: refused — nothing was printed.`);
  for (const line of e.message.split('\n')) console.error(`  ${line}`);
  process.exit(1);
}
