// api/chat.js — Kulova chat endpoint
const conversations = {};

const SUPABASE_URL = 'https://eacfiiscsdqdcoduyzkk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

async function getBusinessData(businessId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&select=*`, {
      headers: SB_HEADERS
    });
    const rows = await res.json();
    return rows?.[0] || null;
  } catch(e) {
    return null;
  }
}

async function getBusinessByShopDomain(shopDomain) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?shopify_domain=eq.${encodeURIComponent(shopDomain)}&select=*`, {
      headers: SB_HEADERS
    });
    const rows = await res.json();
    return rows?.[0] || null;
  } catch(e) {
    return null;
  }
}

async function saveToSupabase(businessId, sessionId, userMsg, botReply) {
  try {
    const now = new Date().toISOString();

    // 1. Hae tai luo keskustelu session_id:lla
    let convId = null;
    const findRes = await fetch(`${SUPABASE_URL}/rest/v1/conversations?session_id=eq.${sessionId}&select=id`, {
      headers: SB_HEADERS
    });
    const found = await findRes.json();

    if (found?.[0]?.id) {
      convId = found[0].id;
      await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${convId}`, {
        method: 'PATCH',
        headers: SB_HEADERS,
        body: JSON.stringify({ last_message_at: now })
      });
    } else {
      const createRes = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
        method: 'POST',
        headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          business_id: businessId,
          session_id: sessionId,
          created_at: now,
          last_message_at: now
        })
      });
      const created = await createRes.json();
      convId = created?.[0]?.id || null;
    }

    if (!convId) return;

    // 2. Tallenna viestit
    await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify([
        { conversation_id: convId, business_id: businessId, role: 'user', content: userMsg, created_at: now },
        { conversation_id: convId, business_id: businessId, role: 'assistant', content: botReply, created_at: now }
      ])
    });
  } catch(e) {
    console.error('Save error:', e.message);
  }
}

function buildSystemPrompt(biz) {
  if (!biz) {
    return `Olet asiakaspalveluagentti. Vastaat lyhyesti ja selkeasti suomeksi. Ala kayta markdown-muotoilua.`;
  }

  const name = biz.name || 'yritys';
  const services = biz.services || '';
  const hours = biz.hours || '';
  const botName = biz.bot_name || 'Asiakaspalvelu';
  const botTone = biz.bot_tone || 'ystavallinen ja ammattimainen';
  const botInstructions = biz.bot_instructions || '';
  const website = biz.website || '';
  const bookingUrl = biz.booking_url || '';

  return `Olet ${name}-yrityksen asiakaspalveluagentti nimelta ${botName}.

YRITYSTIEDOT:
- Yritys: ${name}
- Palvelut: ${services}
- Aukioloajat: ${hours}
${website ? `- Verkkosivusto: ${website}` : ''}
${bookingUrl ? `- Ajanvarauslinkki: ${bookingUrl}` : ''}

KAYTTAYTYMINEN:
- Savy: ${botTone}
- Vastaat asiakkaan kayttamalla kielella — suomeksi jos asiakas kirjoittaa suomeksi, englanniksi jos englanniksi
- Pidat vastaukset lyhyina ja selkeina (max 3-4 lausetta)
- Et kayta markdown-muotoilua (ei **bold**, ei # otsikot)
- Et kayta emojeja ellei asiakas kayta niita
${bookingUrl ? `- Kun asiakas haluaa varata ajan tai kysyy ajanvarauksesta, lisaa vastauksesi loppuun AINA tama HTML-nappi tasmalleen nain: <a href="${bookingUrl}" target="_blank" style="display:inline-block;margin-top:8px;background:#c8f25a;color:#0a0a08;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Varaa aika &rarr;</a>` : ''}
${!bookingUrl ? `- Et voi tehda ajanvarauksia etka kirjata aikoja jarjestelmaan. Jos asiakas haluaa varata ajan, pyyda hanta soittamaan tai kayttamaan yrityksen tavallista varaustapaa. ALA KOSKAAN vaita etta olet tehnyt varauksen tai etta varaus on hoidettu.` : ''}
${botInstructions ? `\nLISAOHJEET (nama ovat tarkeampia kuin ylla olevat ohjeet):\n${botInstructions}` : ''}

Jos asiakas kysyy jotain mita et tieda, kerro etta ohjaat asian eteenpain ja yritys ottaa yhteytta.`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, sessionId, businessId, shopDomain } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'Missing fields' });

  if (!conversations[sessionId]) conversations[sessionId] = [];
  const history = conversations[sessionId];

  let systemPrompt;
  let resolvedBusinessId = businessId || null;
  if (businessId === 'demo') {
    systemPrompt = `Olet Kulova-demon asiakaspalveluagentti. Kulova on suomalainen AI-palvelu joka hoitaa yritysten asiakasviestinnan automaattisesti. Hinta 49e/kk. Vastaat lyhyesti ja selkeasti suomeksi ilman markdown-muotoilua tai emojeja.`;
  } else if (shopDomain) {
    const biz = await getBusinessByShopDomain(shopDomain);
    if (biz) resolvedBusinessId = biz.id;
    systemPrompt = buildSystemPrompt(biz);
  } else {
    const biz = await getBusinessData(businessId);
    systemPrompt = buildSystemPrompt(biz);
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [
          ...history,
          { role: 'user', content: message }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(500).json({ reply: 'Hetki — yrita uudelleen.' });
    }

    const reply = data.content?.[0]?.text || 'Yrita uudelleen.';
    conversations[sessionId].push({ role: 'user', content: message });
    conversations[sessionId].push({ role: 'assistant', content: reply });
    if (conversations[sessionId].length > 20) {
      conversations[sessionId] = conversations[sessionId].slice(-20);
    }

    // Tallenna Supabaseen (paitsi demo)
    if (resolvedBusinessId && resolvedBusinessId !== 'demo') {
      await saveToSupabase(resolvedBusinessId, sessionId, message, reply);
    }

    res.status(200).json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ reply: 'Yhteysvirhe — yrita hetken kuluttua.' });
  }
};
