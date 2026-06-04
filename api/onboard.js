// api/onboard.js

const ADMIN_EMAIL = 'kalle.etelaaho15@gmail.com';

// In-memory store (tuotannossa tietokanta)
const businesses = {};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — hae yrityksen tiedot businessId:llä (käytetään chatissa)
  if (req.method === 'GET') {
    const { id } = req.query;
    if (id && businesses[id]) return res.status(200).json(businesses[id]);
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { businessName, businessType, services, hours, ownerEmail, skipPayment } = req.body;

  if (!businessName || !services || !ownerEmail) {
    return res.status(400).json({ error: 'Pakollisia kenttiä puuttuu' });
  }

  const isAdmin = ownerEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const businessId = 'biz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  const business = {
    id: businessId,
    name: businessName,
    type: businessType || 'palveluyritys',
    services,
    hours: hours || 'Ma-Pe 9-17',
    ownerEmail,
    isAdmin,
    createdAt: new Date().toISOString()
  };

  businesses[businessId] = business;
  console.log('Uusi yritys:', business);

  const widgetCode = `<script src="https://kulova-backend.vercel.app/api/widget.js" data-business="${businessId}"><\/script>`;

  // Admin tai skipPayment — suoraan sisään
  if (isAdmin || skipPayment) {
    // Lähetä tervetuloa-sähköposti
    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: 'Kulova', email: 'hello@kulova.com' },
          to: [{ email: ownerEmail, name: businessName }],
          subject: 'Kulova on käytössä! 🎉',
          htmlContent: `<h2>Moi!</h2><p>Kulova on nyt käytössä yrityksellesi <strong>${businessName}</strong>.</p><p>Widget-koodi sivullesi:</p><pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:12px;">${widgetCode.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre><p>Lisää tämä sivusi body-tagiin.</p><p>— Kulova</p>`
        })
      });
    } catch(e) { console.log('Email error:', e.message); }

    return res.status(200).json({ success: true, businessId, widgetCode });
  }

  // Maksuton käyttäjä — luo Stripe checkout
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: ownerEmail,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Kulova — AI-asiakaspalvelu', description: 'Rajaton viestimäärä, WhatsApp + sähköposti + chat' },
          unit_amount: 4900,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { businessId, businessName, ownerEmail }
      },
      success_url: `https://kulova.com/onboard?success=1&bid=${businessId}`,
      cancel_url: `https://kulova.com/onboard`
    });
    return res.status(200).json({ success: true, businessId, checkoutUrl: session.url });
  } catch(e) {
    console.error('Stripe error:', e.message);
    // Jos Stripe ei toimi, anna widgetkoodi silti
    return res.status(200).json({ success: true, businessId, widgetCode });
  }
};
