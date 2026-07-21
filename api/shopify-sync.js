// api/shopify-sync.js — Shopify-appin sisainen synkronointi + asetusten luku/kirjoitus
const SUPABASE_URL = 'https://eacfiiscsdqdcoduyzkk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const EDITABLE_SETTINGS_FIELDS = ['services', 'hours', 'bot_instructions', 'support_email'];

async function handleGetSettings(req, res) {
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

async function handleUpdateSettings(req, res) {
  const { shopDomain, ...body } = req.body || {};
  if (!shopDomain) return res.status(400).json({ error: 'shopDomain required' });

  const update = {};
  for (const field of EDITABLE_SETTINGS_FIELDS) {
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

async function handleSync(req, res) {
  const { shopDomain, shopName, email } = req.body || {};
  if (!shopDomain) return res.status(400).json({ error: 'shopDomain required' });

  const findRes = await fetch(`${SUPABASE_URL}/rest/v1/businesses?shopify_domain=eq.${encodeURIComponent(shopDomain)}&select=id,bot_name,is_active`, { headers: SB_HEADERS });
  const found = await findRes.json();
  if (found?.[0]) return res.status(200).json({ business: found[0], created: false });

  const now = new Date().toISOString();
  const id = 'biz_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const row = {
    id,
    name: shopName || shopDomain,
    type: 'verkkokauppa',
    owner_email: (email || '').toLowerCase() || null,
    shopify_domain: shopDomain,
    is_active: true,
    bot_name: 'Kulova',
    created_at: now
  };
  let createRes = await fetch(`${SUPABASE_URL}/rest/v1/businesses`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify(row)
  });
  if (!createRes.ok && row.owner_email) {
    row.owner_email = null;
    createRes = await fetch(`${SUPABASE_URL}/rest/v1/businesses`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify(row)
    });
  }
  const created = await createRes.json();
  if (!createRes.ok) return res.status(500).json({ error: 'create failed', detail: created });
  return res.status(200).json({ business: created?.[0], created: true });
}

module.exports = async (req, res) => {
  if (!process.env.KULOVA_INTERNAL_KEY || req.headers['x-kulova-key'] !== process.env.KULOVA_INTERNAL_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET') return handleGetSettings(req, res);
  if (req.method === 'PATCH') return handleUpdateSettings(req, res);
  if (req.method === 'POST') return handleSync(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
};
