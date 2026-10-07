# `stripe-manifest.json` — what the payment links charge

The Support section prints the Developer and Production amounts and their four
buy buttons from this file, through `src/lib/pricing.ts`. **Do not edit it by
hand.** It is printed from the **Atmosphere** Stripe account (a separate account
under the same Stripe login as TrailSnag) by `scripts/stripe.mjs`.

## First time: create the catalog at Stripe

From `website/`, with a secret key of the Atmosphere account in the shell (never
commit it):

```bash
export STRIPE_SECRET_KEY=sk_live_…            # the Atmosphere account's key
node scripts/stripe.mjs setup                 # dry run: names the account, lists what it would create
node scripts/stripe.mjs setup --apply --account acct_…   # the id the dry run printed
```

`setup` creates only what is missing — two products, four USD prices found
again by their lookup keys (`atmosphere_{developer,production}_{month,year}`),
and one payment link per price — and never edits or archives anything, so
running it twice is harmless. `--apply` refuses unless `--account` names the
account the key belongs to: a TrailSnag key would put Atmosphere's products in
TrailSnag's account, where snag's webhook would queue every sale as an
unprovisioned TrailSnag purchase.

The amounts live in `CATALOG` at the top of `scripts/stripe.mjs`:
$200 / month or $2,000 / year (Developer), $900 / month or $9,000 / year
(Production). Prices are tax-exclusive and links collect a billing address, so
Stripe Tax applies if it is enabled on the account.

## Every time something changes at Stripe

```bash
node scripts/stripe.mjs manifest > /tmp/stripe-manifest.json \
  && mv /tmp/stripe-manifest.json src/data/stripe-manifest.json
```

Commit it and push `main`, which deploys. If nothing changed, the file comes out
byte for byte the same. `manifest` refuses, printing nothing, when a link is
missing, doubled or inactive, sells anything other than one unit of its own
catalog price, or when that price drifted from `CATALOG`. The file carries only
public facts: no key and no price, product or account id.

The build then refuses a manifest that does not fit the page: a sandbox
manifest or a `https://buy.stripe.com/test_…` link, a missing, doubled or extra
row, two rows sharing a url, a currency other than USD, an amount with cents, a
trial on any link, a yearly price that is not ten months of the monthly one, or
Production not costing more than Developer.

## Changing a price

Stripe prices are immutable. Change the amount in `CATALOG`, then at Stripe
archive the old price and deactivate its payment link, run
`node scripts/stripe.mjs setup --apply --account acct_…` (it creates the new
price, moving the lookup key off the archived one, and a new link), and print
the manifest again.

## After a purchase

Nothing on this site reacts to a sale. Stripe emails the account owner on each
new subscription; onboarding the buyer onto their support channel is done by
hand from there.
