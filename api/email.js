// api/email.js — Brevo inbound webhook: botti vastaa sahkoposteihin
const SUPABASE_URL = 'https://eacfiiscsdqdcoduyzkk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

async function getBusinessData(businessId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const rows = await res.json();
    return rows?.[0] || null;
  } catch(e) { return null; }
}

function buildSystemPrompt(biz) {
  if (!biz) return null;
  const name = biz.name || 'yritys';
  const services = biz.services || '';
  const hours = biz.hours || '';
  const botName = biz.bot_name || 'Asiakaspalvelu';
  const botTone = biz.bot_tone || 'ystavallinen ja ammattimainen';
  const botInstructions = biz.bot_instructions || '';
  const website = biz.website || '';
  const bookingUrl = biz.booking_url || '';

  return `Olet ${name}-yrityksen asiakaspalveluagentti nimelta ${botName}. Vastaat asiakkaan SAHKOPOSTIIN.

YRITYSTIEDOT:
- Yritys: ${name}
- Palvelut: ${services}
- Aukioloajat: ${hours}
${website ? `- Verkkosivusto: ${website}` : ''}
${bookingUrl ? `- Ajanvarauslinkki: ${bookingUrl}` : ''}

KAYTTAYTYMINEN:
- Savy: ${botTone}
- Vastaat asiakkaan kayttamalla kielella — suomeksi jos asiakas kirjoittaa suomeksi, englanniksi jos englanniksi
- Kirjoitat kohteliaan sahkopostivastauksen: tervehdys alkuun, asia selkeasti, lopputervehdys "Ystavallisin terveisin, ${botName} / ${name}"
- Et kayta markdown-muotoilua
- Pidat vastauksen tiiviina (max 6-8 lausetta)
${bookingUrl ? `- Jos asiakas haluaa varata ajan, anna ajanvarauslinkki: ${bookingUrl}` : ''}
${botInstructions ? `\nLISAOHJEET (nama ovat tarkeampia kuin ylla olevat ohjeet):\n${botInstructions}` : ''}

Jos et tieda vastausta, kerro etta valitat kysymyksen eteenpain ja yritys vastaa pian.`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Brevo inbound lahettaa items-taulukon
    const items = req.body.items || [req.body];

    for (const item of items) {
      const fromEmail = item.From?.Address || item.from || '';
      const fromName = item.From?.Name || '';
      const subject = item.Subject || item.subject || '(ei aihetta)';
      const text = item.RawTextBody || item.ExtractedMarkdownMessage || item.text || '';

      // businessId = vastaanottajaosoitteen alkuosa (biz_xxx@mail.kulova.com)
      const toList = item.Recipients || (item.To ? [item.To?.Address || item.to] : []);
      let businessId = null;
      for (const r of toList) {
        const addr = typeof r === 'string' ? r : (r?.Address || '');
        const m = addr.match(/^(biz_[a-z0-9_]+)@/i);
        if (m) { businessId = m[1]; break; }
      }

      if (!businessId || !fromEmail || !text) {
        console.log('Email skip: missing data', { businessId, fromEmail, hasText: !!text });
        continue;
      }

      const biz = await getBusinessData(businessId);
      if (!biz) { console.log('Email skip: business not found', businessId); continue; }

      const systemPrompt = buildSystemPrompt(biz);

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Aihe: ${subject}\n\n${text}` }]
        })
      });

      const aiData = await aiRes.json();
      if (!aiRes.ok) { console.error('Anthropic error:', aiData); continue; }
      const reply = aiData.content?.[0]?.text;
      if (!reply) continue;

      // Laheta vastaus Brevolla
      const sendRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.BREVO_API_KEY
        },
        body: JSON.stringify({
          sender: { name: biz.name || 'Asiakaspalvelu', email: 'hello@kulova.com' },
          to: [{ email: fromEmail, name: fromName || undefined }],
          subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
          textContent: reply
        })
      });

      if (!sendRes.ok) {
        const errData = await sendRes.json();
        console.error('Brevo send error:', errData);
      } else {
        console.log('Email replied:', { businessId, to: fromEmail });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Email handler error:', err.message);
    return res.status(200).json({ ok: false });
  }
};
