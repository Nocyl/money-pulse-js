# @money-pulse/checkout

Official JavaScript/TypeScript SDK for [Money-Pulse](https://money-pulse.org) — Accept payments and process payouts across Africa.

## Installation

```bash
npm install @money-pulse/checkout
```

## Server-side: Create a payment

```typescript
import { MoneyPulse } from '@money-pulse/checkout';

const mp = new MoneyPulse({ apiKey: process.env.MP_SECRET_KEY! });

const payment = await mp.payments.create({
  amount: 10000,
  currency: 'XOF',
  country: 'CI',
  customer: { email: 'client@example.com', phone: '+22507000000' },
  callbackUrl: 'https://your-site.com/webhook',
  returnUrl: 'https://your-site.com/thank-you',
});

console.log(payment.checkoutUrl); // Redirect customer here
```

## Browser checkout (popup)

```html
<script src="https://js.money-pulse.org/v1/checkout.js"></script>
<script>
MoneyPulseCheckout.open({
  publicKey: 'mp_pub_xxx',
  amount: 5000,
  currency: 'XOF',
  onSuccess: (r) => console.log('Paid:', r),
  onError: (e) => console.error(e),
});
</script>
```

## Payouts

```typescript
const payout = await mp.payouts.create({
  amount: 50000,
  currency: 'XOF',
  country: 'CI',
  recipient: {
    type: 'mobile_money',
    phone: '+22507000000',
    name: 'Jean Kouassi',
  },
});
```

## Webhooks (signature verification)

Money-Pulse signs every webhook with HMAC-SHA256 in the `X-MoneyPulse-Signature` header.

```typescript
import crypto from 'crypto';
import express from 'express';

const app = express();
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-moneypulse-signature'] as string;
  const expected = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET!)
    .update(req.body)
    .digest('hex');

  if (signature !== expected) return res.status(401).end();

  const event = JSON.parse(req.body.toString());
  switch (event.type) {
    case 'payment.success': /* fulfill order */ break;
    case 'payment.failed':  /* notify customer */ break;
    case 'payout.completed':/* mark withdrawal done */ break;
  }
  res.json({ received: true });
});
```

## Mode simulation (no funds, no webhook)

Use `simulate: true` to run end-to-end tests in production without moving money:

```typescript
const test = await mp.payments.create({
  amount: 1000, currency: 'XOF', country: 'CI',
  customer: { email: 't@t.com' },
  simulate: true,           // ← no balance change, no webhook fired
});
console.log(test.simulated); // true
```

Sandbox amount rules: `amount % 100 < 50 → success`, `< 90 → pending`, `≥ 90 → failed`.

## Common errors

| Code | Meaning |
|------|---------|
| `invalid_amount` | Amount outside method min/max |
| `unsupported_country` | No gateway covers this country/currency |
| `insufficient_balance` | Payout > available merchant balance |
| `gateway_unavailable` | All gateways failed; retry later |
| `invalid_signature` | Webhook HMAC mismatch (check secret) |

## Supported coverage

76+ countries, 19 gateways, 55+ currencies. See [docs.money-pulse.org](https://docs.money-pulse.org).

## License

MIT © NOCYL-PULSE
