// api/stripe.js — Stripe maksut ja tilaukset

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Luo Stripe Checkout -sessio
async function createCheckout(req, res) {
  const { email, businessName } = req.body;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer_email: email,
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: {
          name: 'Kulova — AI-agentti',
          description: 'Rajaton määrä viestejä, WhatsApp + sähköposti + chat',
        },
        unit_amount: 4900, // 49€
        recurring: { interval: 'month' }
      },
      quantity: 1
    }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { businessName, email }
    },
    success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/#hinnat`
  });

  res.status(200).json({ url: session.url });
}

// Stripe webhook — tilauksen aktivointi
async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log('Uusi asiakas:', session.customer_email);
      // TODO: Tallenna asiakastiedot tietokantaan + lähetä onboarding-sähköposti
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      console.log('Tilaus peruttu:', subscription.customer);
      // TODO: Deaktivoi asiakkaan botti
      break;
    }
  }

  res.status(200).json({ received: true });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.split('?')[0];

  if (path === '/api/stripe/checkout') return createCheckout(req, res);
  if (path === '/api/stripe/webhook') return handleWebhook(req, res);

  res.status(404).json({ error: 'Not found' });
};
