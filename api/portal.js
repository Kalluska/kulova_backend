const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { businessId } = req.body;
    if (!businessId) return res.status(400).json({ error: 'businessId required' });

    // Hae stripe_customer_id Supabasesta
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&select=stripe_customer_id`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const rows = await r.json();
    const customerId = rows[0] && rows[0].stripe_customer_id;

    if (!customerId) {
      return res.status(404).json({ error: 'Ei aktiivista tilausta. Jos olet juuri tilannut, odota hetki ja yritä uudelleen.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://kulova.com/dashboard'
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err.message);
    return res.status(500).json({ error: 'Portal session failed' });
  }
};
