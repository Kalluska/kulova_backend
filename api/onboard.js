// api/onboard.js — with Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = 'kalle.etelaaho15@gmail.com';

async function supabaseInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  });
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${id}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await r.json();
    return res.status(200).json(data[0] || null);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { businessName, businessType, services, hours, ownerEmail, skipPayment } = req.body;
  if (!businessName || !services || !ownerEmail) return res.status(400).json({ error: 'Missing fields' });

  const isAdmin = ownerEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const businessId = 'biz_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  try {
    await supabaseInsert('businesses', {
      id: businessId,
      name: businessName,
      type: businessType || 'palveluyritys',
      services,
      hours: hours || 'Ma-Pe 9-17',
      owner_email: ownerEmail,
      is_admin: isAdmin,
      is_active: true
    });
  } catch(e) {
    console.log('DB insert error:', e.message);
  }

  const widgetCode = `<script src="https://kulova-backend.vercel.app/api/widget.js" data-business="${businessId}"><\/script>`;

  if (isAdmin || skipPayment) {
    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: 'Kulova', email: 'hello@kulova.com' },
          to: [{ email: ownerEmail, name: businessName }],
          subject: 'Kulova on käytössä! 🎉',
          htmlContent: `<h2>Moi!</h2><p>Kulova on käytössä yrityksellesi <strong>${businessName}</strong>.</p><p>Widget-koodi:</p><pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:12px;">${widgetCode.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre><p>Hallintapaneeli: <a href="https://kulova.com/dashboard?bid=${businessId}&email=${ownerEmail}">Avaa paneeli</a></p>`
        })
      });
    } catch(e) { console.log('Email error:', e.message); }

    return res.status(200).json({ success: true, businessId, widgetCode });
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: ownerEmail,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Kulova', description: 'AI-asiakaspalvelu 24/7' },
          unit_amount: 4900,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }],
      subscription_data: { trial_period_days: 14, metadata: { businessId } },
      success_url: `https://kulova.com/onboard?success=1&bid=${businessId}`,
      cancel_url: `https://kulova.com/onboard`
    });
    return res.status(200).json({ success: true, businessId, checkoutUrl: session.url });
  } catch(e) {
    console.error('Stripe error:', e.message);
    return res.status(200).json({ success: true, businessId, widgetCode });
  }
};
