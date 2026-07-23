// api/dashboard.js — istuntotoken-suojatut hallintapaneelin endpointit
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const EDITABLE_BUSINESS_FIELDS = [
  'name', 'services', 'hours', 'website', 'booking_url',
  'bot_name', 'bot_tone', 'bot_instructions', 'digest_enabled', 'digest_hour'
];

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: SB_HEADERS });
  return res.json();
}
async function sbPatch(path, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify(data)
  });
  return res.json();
}
async function sbDelete(path) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers: SB_HEADERS });
}

// Palauttaa business_id:n istuntotokenista, tai null jos token puuttuu/on
// väärä/vanhentunut. business_id EI KOSKAAN tule pyynnön parametreista —
// tämä oli alkuperäisen haavoittuvuuden juurisyy, ei toisteta sitä täällä.
async function authenticate(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const tokenHash = hashToken(token);

  // Opportunistinen siivous vanhentuneille istunnoille — ei vaadi erillistä cronia.
  sbDelete(`sessions?expires_at=lt.${new Date().toISOString()}`).catch(() => {});

  const rows = await sbGet(`sessions?token_hash=eq.${tokenHash}&select=id,business_id,expires_at`);
  const session = rows?.[0];
  if (!session || new Date(session.expires_at) < new Date()) return null;

  sbPatch(`sessions?id=eq.${session.id}`, { last_used_at: new Date().toISOString() }).catch(() => {});

  return session.business_id;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const resource = req.query.resource;

  // Uloskirjautuminen tarvitsee vain tokenin itsensä, ei muuta validointia.
  if (resource === 'logout' && req.method === 'DELETE') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) await sbDelete(`sessions?token_hash=eq.${hashToken(token)}`);
    return res.status(200).json({ success: true });
  }

  const businessId = await authenticate(req);
  if (!businessId) return res.status(401).json({ error: 'unauthorized' });

  if (resource === 'business' && req.method === 'GET') {
    const rows = await sbGet(`businesses?id=eq.${businessId}&select=*`);
    const biz = rows?.[0];
    if (!biz) return res.status(404).json({ error: 'not found' });

    const totalMsgs = await sbGet(`messages?business_id=eq.${businessId}&select=id`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMsgs = await sbGet(`messages?business_id=eq.${businessId}&created_at=gte.${today.toISOString()}&select=id`);

    return res.status(200).json({
      business: biz,
      totalMessages: totalMsgs?.length || 0,
      todayMessages: todayMsgs?.length || 0
    });
  }

  if (resource === 'business' && req.method === 'PATCH') {
    const body = req.body || {};
    const update = {};
    for (const field of EDITABLE_BUSINESS_FIELDS) {
      if (body[field] !== undefined) update[field] = body[field];
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'no editable fields provided' });

    const rows = await sbPatch(`businesses?id=eq.${businessId}`, update);
    return res.status(200).json({ business: rows?.[0] });
  }

  if (resource === 'conversations' && req.method === 'GET') {
    const convs = await sbGet(
      `conversations?business_id=eq.${businessId}&select=id,customer_identifier,last_message_at,created_at&order=last_message_at.desc`
    );
    if (!convs?.length) return res.status(200).json({ conversations: [] });

    // conversations.message_count ei ole koskaan ylläpidetty (tunnettu, korjaamaton
    // puute vanhassa koodissa) — lasketaan oikeat määrät messages-taulusta.
    const allMsgs = await sbGet(`messages?business_id=eq.${businessId}&select=conversation_id`);
    const counts = {};
    for (const m of (allMsgs || [])) {
      counts[m.conversation_id] = (counts[m.conversation_id] || 0) + 1;
    }

    return res.status(200).json({
      conversations: convs.map(c => ({ ...c, message_count: counts[c.id] || 0 }))
    });
  }

  if (resource === 'messages' && req.method === 'GET') {
    const conversationId = req.query.conversationId;
    if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

    // Omistajuustarkistus: keskustelun pitää kuulua TÄLLE business_id:lle,
    // ei riitä että conversationId on validi jonkun tahansa yrityksen keskustelu.
    const owns = await sbGet(`conversations?id=eq.${conversationId}&business_id=eq.${businessId}&select=id`);
    if (!owns?.length) return res.status(404).json({ error: 'not found' });

    const msgs = await sbGet(`messages?conversation_id=eq.${conversationId}&select=*&order=created_at.asc`);
    return res.status(200).json({ messages: msgs });
  }

  return res.status(404).json({ error: 'unknown resource' });
};
