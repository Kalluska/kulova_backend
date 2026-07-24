// api/auth.js — PIN-koodi kirjautuminen + istuntotokenin luonti
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

const MAX_ATTEMPTS = 5;
const SEND_THROTTLE_MS = 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 vrk

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
      ...options.headers
    },
    ...options
  });
  return res.json();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, code } = req.body;

  // Lähetä PIN-koodi
  if (action === 'send') {
    if (!email) return res.status(400).json({ error: 'Missing email' });
    const normalizedEmail = email.toLowerCase();

    // Tarkista onko sähköposti olemassa
    const businesses = await sb(`businesses?owner_email=eq.${encodeURIComponent(normalizedEmail)}&select=id,name`);
    if (!businesses?.length) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Rate limit: max 1 lähetys / 60s per sähköposti (estää spämmäyksen)
    const recent = await sb(`login_codes?email=eq.${encodeURIComponent(normalizedEmail)}&select=created_at&order=created_at.desc&limit=1`);
    if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < SEND_THROTTLE_MS) {
      return res.status(429).json({ error: 'Koodi on jo lähetetty. Odota hetki ennen uutta yritystä.' });
    }

    // Mitätöi aiemmat käyttämättömät koodit — muuten hyökkääjä voisi kerätä
    // useita rinnakkaisia arvausbudjetteja spämmäämällä lähetystä.
    await sb(`login_codes?email=eq.${encodeURIComponent(normalizedEmail)}&used=eq.false`, {
      method: 'PATCH',
      body: JSON.stringify({ used: true })
    });

    // Luo 6-numeroinen koodi
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Tallenna koodi
    await sb('login_codes', {
      method: 'POST',
      body: JSON.stringify({ email: normalizedEmail, code: pin, expires_at: expires })
    });

    // Lähetä sähköposti
    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: 'Kulova', email: 'hello@kulova.com' },
          to: [{ email: normalizedEmail, name: businesses[0].name }],
          subject: 'Kulova — kirjautumiskoodi',
          htmlContent: `
            <div style="font-family:sans-serif;max-width:400px;margin:0 auto;">
              <h2 style="color:#0a0a08;">Kirjautumiskoodi</h2>
              <p>Käytä tätä koodia kirjautuaksesi Kulova-hallintapaneeliin.</p>
              <div style="background:#f5f5f5;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
                <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#0a0a08;">${pin}</span>
              </div>
              <p style="color:#999;font-size:13px;">Koodi vanhenee 10 minuutissa. Jos et pyytänyt tätä koodia, voit jättää viestin huomiotta.</p>
            </div>
          `
        })
      });
    } catch(e) {
      console.error('Email error:', e.message);
    }

    return res.status(200).json({ success: true });
  }

  // Tarkista PIN-koodi + luo istuntotoken
  if (action === 'verify') {
    if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });
    const normalizedEmail = email.toLowerCase();
    // Sama virhe riippumatta syystä (ei koodia, väärä koodi, vanhentunut, liikaa
    // yrityksiä) — muuten vastauksesta voisi päätellä mitä osaa arvata seuraavaksi.
    const GENERIC_ERROR = { error: 'Virheellinen tai vanhentunut koodi.' };

    const codes = await sb(`login_codes?email=eq.${encodeURIComponent(normalizedEmail)}&used=eq.false&select=*&order=created_at.desc&limit=1`);
    const loginCode = codes?.[0];

    if (!loginCode || loginCode.attempts >= MAX_ATTEMPTS || new Date(loginCode.expires_at) < new Date()) {
      return res.status(401).json(GENERIC_ERROR);
    }

    if (loginCode.code !== code) {
      await sb(`login_codes?id=eq.${loginCode.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ attempts: loginCode.attempts + 1 })
      });
      return res.status(401).json(GENERIC_ERROR);
    }

    // Merkitse käytetyksi
    await sb(`login_codes?id=eq.${loginCode.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ used: true })
    });

    // Hae yritystiedot
    const businesses = await sb(`businesses?owner_email=eq.${encodeURIComponent(normalizedEmail)}&select=id,name`);
    if (!businesses?.length) {
      return res.status(404).json({ error: 'Business not found' });
    }
    const biz = businesses[0];

    // Luo istuntotoken — raakaa tokenia ei koskaan tallenneta, vain sen tiiviste
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await sb('sessions', {
      method: 'POST',
      body: JSON.stringify({ business_id: biz.id, token_hash: hashToken(rawToken), expires_at: expiresAt })
    });

    return res.status(200).json({
      success: true,
      businessId: biz.id,
      businessName: biz.name,
      token: rawToken,
      expiresAt
    });
  }

  res.status(400).json({ error: 'Invalid action' });
};
