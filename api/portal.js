const crypto = require('crypto');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// business_id tulee AINA istuntotokenista, ei koskaan pyynnön bodystä —
// vanha versio otti businessId:n suoraan bodystä ilman mitään auth-tarkistusta.
async function authenticate(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/sessions?token_hash=eq.${hashToken(token)}&select=business_id,expires_at`, {
    headers: SB_HEADERS
  });
  const rows = await res.json();
  const session = rows?.[0];
  if (!session || new Date(session.expires_at) < new Date()) return null;
  return session.business_id;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const businessId = await authenticate(req);
  if (!businessId) return res.status(401).json({ error: 'unauthorized' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&select=stripe_customer_id`, {
      headers: SB_HEADERS
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
