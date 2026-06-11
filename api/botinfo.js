// api/botinfo.js — palauttaa botin julkiset tiedot widgetille
const SUPABASE_URL = 'https://eacfiiscsdqdcoduyzkk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const businessId = req.query.businessId;
  if (!businessId) return res.status(400).json({ error: 'businessId required' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&select=bot_name,is_active`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await r.json();
    const biz = rows?.[0];
    if (!biz) return res.status(404).json({ error: 'not found' });

    return res.status(200).json({
      botName: biz.bot_name || 'Asiakaspalvelu',
      active: biz.is_active !== false
    });
  } catch(e) {
    return res.status(500).json({ error: 'failed' });
  }
};
