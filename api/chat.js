// api/chat.js — Kulova chat endpoint
const conversations = {};

const SUPABASE_URL = 'https://eacfiiscsdqdcoduyzkk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

async function getBusinessData(businessId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${businessId}&select=*`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const rows = await res.json();
    return rows?.[0] || null;
  } catch(e) {
    return null;
  }
}

function buildSystemPrompt(biz) {
  if (!biz) {
    return `Olet asiakaspalveluagentti. Vastaat lyhyesti ja selkeästi suomeksi. Älä käytä markdown-muotoilua.`;
  }

  const name = biz.name || 'yritys';
  const services = biz.services || '';
  const hours = biz.hours || '';
  const botName = biz.bot_name || 'Asiakaspalvelu';
  const botTone = biz.bot_tone || 'ystävällinen ja ammattimainen';
  const botInstructions = biz.bot_instructions || '';
  const website = biz.website || '';
  const bookingUrl = biz.booking_url || '';

  return `Olet ${name}-yrityksen asiakaspalveluagentti nimeltä ${botName}.

YRITYSTIEDOT:
- Yritys: ${name}
- Palvelut: ${services}
- Aukioloajat: ${hours}
${website ? `- Verkkosivusto: ${website}` : ''}
${bookingUrl ? `- Ajanvarauslinkki: ${bookingUrl}` : ''}

KÄYTTÄYTYMINEN:
- Sävy: ${botTone}
- Vastaat aina suomeksi
- Pidät vastaukset lyhyinä ja selkeinä (max 3-4 lausetta)
- Et käytä markdown-muotoilua (ei **bold**, ei # otsikot)
- Et käytä emojeja ellei asiakas käytä niitä
${bookingUrl ? `- Kun asiakas haluaa varata ajan tai kysyy ajanvarauksesta, lisää vastauksesi loppuun AINA tämä HTML-nappi täsmälleen näin: <a href="${bookingUrl}" target="_blank" style="display:inline-block;margin-top:8px;background:#c8f25a;color:#0a0a08;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Varaa aika →</a>` : ''}
${botInstructions ? `\nLISÄOHJEET:\n${botInstructions}` : ''}

Jos asiakas kysyy jotain mitä et tiedä, kerro että ohjaat asian eteenpäin ja yritys ottaa yhteyttä.`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, sessionId, businessId } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'Missing fields' });

  if (!conversations[sessionId]) conversations[sessionId] = [];
  const history = conversations[sessionId];

  let systemPrompt;
  if (businessId === 'demo') {
    systemPrompt = `Olet Kulova-demon asiakaspalveluagentti. Kulova on suomalainen AI-palvelu joka hoitaa yritysten asiakasviestinnän automaattisesti. Hinta 49€/kk. Vastaat lyhyesti ja selkeästi suomeksi ilman markdown-muotoilua tai emojeja.`;
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
      return res.status(500).json({ reply: 'Hetki — yritä uudelleen.' });
    }

    const reply = data.content?.[0]?.text || 'Yritä uudelleen.';
    conversations[sessionId].push({ role: 'user', content: message });
    conversations[sessionId].push({ role: 'assistant', content: reply });
    if (conversations[sessionId].length > 20) {
      conversations[sessionId] = conversations[sessionId].slice(-20);
    }

    res.status(200).json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ reply: 'Yhteysvirhe — yritä hetken kuluttua.' });
  }
};
