// api/digest.js — Päivittäinen yhteenveto
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function sendEmail(to, name, subject, html) {
  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'Kulova', email: 'hello@kulova.com' },
        to: [{ email: to, name }],
        subject,
        htmlContent: html
      })
    });
  } catch(e) { console.error('Email error:', e.message); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const since = yesterday.toISOString();

    // Hae kaikki aktiiviset yritykset joilla digest päällä
    const businesses = await sb('businesses?is_active=eq.true&digest_enabled=eq.true&select=*');

    if (!businesses?.length) {
      return res.status(200).json({ sent: 0 });
    }

    let sent = 0;
    for (const biz of businesses) {
      try {
        const convs = await sb(`conversations?business_id=eq.${biz.id}&created_at=gte.${since}&select=*`);
        const msgs = await sb(`messages?business_id=eq.${biz.id}&created_at=gte.${since}&select=*`);
        const userMsgs = msgs.filter(m => m.role === 'user');

        if (userMsgs.length === 0) continue; // Ei viestejä, ei lähetetä

        const html = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#0a0a08;">Kulova — Päivittäinen yhteenveto</h2>
            <p>Hei ${biz.name},</p>
            <p>Viimeisen 24 tunnin aikana:</p>
            <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:0;font-size:18px;"><strong>${convs.length}</strong> uutta keskustelua</p>
              <p style="margin:8px 0 0;font-size:18px;"><strong>${userMsgs.length}</strong> asiakkaiden viestiä</p>
            </div>
            ${userMsgs.length > 0 ? `
            <h3>Viimeisimmät kysymykset:</h3>
            <ul style="padding-left:20px;">
              ${userMsgs.slice(-5).map(m => `<li style="margin-bottom:8px;">${m.content?.slice(0, 100)}${m.content?.length > 100 ? '...' : ''}</li>`).join('')}
            </ul>` : ''}
            <p><a href="https://kulova.com/dashboard?bid=${biz.id}&email=${biz.owner_email}" style="background:#c8f25a;color:#0a0a08;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Avaa hallintapaneeli →</a></p>
            <p style="color:#999;font-size:12px;">Voit muuttaa yhteenveto-asetuksia hallintapaneelin Asetukset-sivulla.</p>
          </div>
        `;

        await sendEmail(biz.owner_email, biz.name, `Kulova: ${userMsgs.length} viestiä viimeisen 24h aikana`, html);
        sent++;
      } catch(e) {
        console.error(`Digest error for ${biz.id}:`, e.message);
      }
    }

    res.status(200).json({ sent });
  } catch(e) {
    console.error('Digest error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
