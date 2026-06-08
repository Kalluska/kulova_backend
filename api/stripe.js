// api/stripe.js — Stripe maksut ja webhookit
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function sbPatch(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(data)
  });
  return res.ok;
}

async function sbQuery(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function sendEmail(to, name, subject, html) {
  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'Kulova', email: 'hello@kulova.com' },
        to: [{ email: to, name }],
        subject,
        htmlContent: html
      })
    });
  } catch(e) { console.error('Email error:', e.message); }
}

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
        unit_amount: 4900,
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
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const businessId = session.metadata?.businessId || session.subscription_data?.metadata?.businessId;
        const email = session.customer_email;
        console.log('Checkout completed:', email, businessId);

        if (businessId) {
          await sbPatch('businesses', businessId, { is_active: true, stripe_customer_id: session.customer });
          const rows = await sbQuery('businesses', `id=eq.${businessId}&select=*`);
          const biz = rows?.[0];
          if (biz) {
            const widgetCode = `&lt;script src="https://kulova-backend.vercel.app/api/widget.js" data-business="${businessId}"&gt;&lt;/script&gt;`;
            await sendEmail(email, biz.name, 'Kulova on käytössä! 🎉', `
              <h2>Tervetuloa, ${biz.name}!</h2>
              <p>14 päivän ilmainen kokeilu on alkanut. Ensimmäinen maksu veloitetaan 14 päivän kuluttua.</p>
              <p><strong>Widget-koodi:</strong></p>
              <pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:12px;">${widgetCode}</pre>
              <p><a href="https://kulova.com/dashboard?bid=${businessId}&email=${email}">Avaa hallintapaneeli →</a></p>
            `);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer;
        console.log('Subscription deleted:', customerId);
        const rows = await sbQuery('businesses', `stripe_customer_id=eq.${customerId}&select=*`);
        if (rows?.[0]) {
          await sbPatch('businesses', rows[0].id, { is_active: false });
          await sendEmail(rows[0].owner_email, rows[0].name, 'Kulova-tilaus päättynyt', `
            <h2>Tilaus päättynyt</h2>
            <p>Kulova-tilauksesi on peruttu. Bottisi ei enää vastaa asiakkaille.</p>
            <p>Voit aloittaa uudelleen milloin tahansa osoitteessa <a href="https://kulova.com">kulova.com</a>.</p>
          `);
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object;
        const customerId = sub.customer;
        console.log('Trial ending soon:', customerId);
        const rows = await sbQuery('businesses', `stripe_customer_id=eq.${customerId}&select=*`);
        if (rows?.[0]) {
          await sendEmail(rows[0].owner_email, rows[0].name, 'Ilmainen kokeilu päättyy 3 päivässä', `
            <h2>Kokeilujakso päättyy pian</h2>
            <p>Hei ${rows[0].name},</p>
            <p>14 päivän ilmainen kokeilusi päättyy 3 päivän kuluttua. Ensimmäinen maksu (49€) veloitetaan automaattisesti kokeilun jälkeen.</p>
            <p>Jos haluat peruuttaa, voit tehdä sen hallintapaneelissa ennen kokeilun päättymistä.</p>
            <p><a href="https://kulova.com/dashboard">Avaa hallintapaneeli →</a></p>
          `);
        }
        break;
      }

    }
  } catch(e) {
    console.error('Webhook handler error:', e.message);
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
