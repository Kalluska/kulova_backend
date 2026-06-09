// api/auth.js — PIN-koodi kirjautuminen
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

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

    // Tarkista onko sähköposti olemassa
    const businesses = await sb(`businesses?owner_email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,name`);
    if (!businesses?.length) {
      return res.status(404).json({ error: 'Email not found' });
    }

    // Luo 6-numeroinen koodi
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Tallenna koodi
    await sb('login_codes', {
      method: 'POST',
      body: JSON.stringify({ email: email.toLowerCase(), code: pin, expires_at: expires })
    });

    // Lähetä sähköposti
    try {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
        body: JSON.stringify({
          sender: { name: 'Kulova', email: 'hello@kulova.com' },
          to: [{ email: email.toLowerCase(), name: businesses[0].name }],
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

  // Tarkista PIN-koodi
  if (action === 'verify') {
    if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });

    const codes = await sb(`login_codes?email=eq.${encodeURIComponent(email.toLowerCase())}&code=eq.${code}&used=eq.false&select=*`);
    
    if (!codes?.length) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    const loginCode = codes[0];
    if (new Date(loginCode.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Code expired' });
    }

    // Merkitse käytetyksi
    await sb(`login_codes?id=eq.${loginCode.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ used: true })
    });

    // Hae yritystiedot
    const businesses = await sb(`businesses?owner_email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,name`);
    if (!businesses?.length) {
      return res.status(404).json({ error: 'Business not found' });
    }

    return res.status(200).json({ 
      success: true, 
      businessId: businesses[0].id,
      businessName: businesses[0].name
    });
  }

  res.status(400).json({ error: 'Invalid action' });
};
