// api/shopify-settings.js — read/write bot settings for a Shopify-connected business
const SUPABASE_URL = 'https://eacfiiscsdqdcoduyzkk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const EDITABLE_FIELDS = ['services', 'hours', 'bot_instructions', 'support_email'];

module.exports = async (req, res) => {
  if (!process.env.KULOVA_INTERNAL_KEY || req.headers['x-kulova-key'] !== process.env.KULOVA_INTERNAL_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    const shopDomain = req.query.shopDomain;
    if (!shopDomain) return res.status(400).json({ error: 'shopDomain required' });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?shopify_domain=eq.${encodeURIComponent(shopDomain)}&select=services,hours,bot_instructions,support_email`,
      { headers: SB_HEADERS }
    );
    const rows = await r.json();
    if (!rows?.[0]) return res.status(404).json({ error: 'not found' });
    return res.status(200).json({ settings: rows[0] });
  }

  if (req.method === 'PATCH' || req.method === 'POST') {
    const { shopDomain, ...body } = req.body || {};
    if (!shopDomain) return res.status(400).json({ error: 'shopDomain required' });

    const update = {};
    for (const field of EDITABLE_FIELDS) {
      if (typeof body[field] === 'string') update[field] = body[field];
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'no editable fields provided' });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?shopify_domain=eq.${encodeURIComponent(shopDomain)}`,
      {
        method: 'PATCH',
        headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify(update)
      }
    );
    const updated = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'update failed', detail: updated });
    if (!updated?.[0]) return res.status(404).json({ error: 'not found' });
    return res.status(200).json({ settings: updated[0] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
