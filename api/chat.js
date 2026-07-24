// api/chat.js — Kulova chat endpoint
const SUPABASE_URL = 'https://eacfiiscsdqdcoduyzkk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const KULOVA_APP_URL = process.env.KULOVA_APP_URL || 'https://kulova-app.vercel.app';
const KULOVA_INTERNAL_KEY = process.env.KULOVA_INTERNAL_KEY;

const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const MAX_HISTORY_MESSAGES = 20;
const ORDER_LOOKUP_MAX_ATTEMPTS = 5;
const ORDER_LOOKUP_WINDOW_MS = 15 * 60 * 1000;
const BOOKING_SENTINEL = '[[BOOKING]]';

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

// Hakee tai luo keskustelun session_id:lla. Palauttaa conversation_id:n tai nullin.
async function getOrCreateConversation(businessId, sessionId) {
  try {
    const now = new Date().toISOString();
    const findRes = await fetch(`${SUPABASE_URL}/rest/v1/conversations?session_id=eq.${encodeURIComponent(sessionId)}&select=id`, {
      headers: SB_HEADERS
    });
    const found = await findRes.json();

    if (found?.[0]?.id) {
      const convId = found[0].id;
      fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${convId}`, {
        method: 'PATCH',
        headers: SB_HEADERS,
        body: JSON.stringify({ last_message_at: now })
      }).catch(() => {});
      return convId;
    }

    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify({ business_id: businessId, session_id: sessionId, created_at: now, last_message_at: now })
    });
    const created = await createRes.json();
    return created?.[0]?.id || null;
  } catch(e) {
    console.error('getOrCreateConversation error:', e.message);
    return null;
  }
}

// Keskusteluhistoria Supabasesta — korvaa vanhan in-memory-olion, joka ei
// säilynyt Vercelin serverless-kutsujen välillä (tuotannossa botti oli jo
// tosiasiassa tilaton joka viestillä). Tilausseurannan monivaiheinen flow
// (kysy numero -> kysy email -> hae -> vastaa) vaatii oikean historian.
async function loadHistory(conversationId) {
  if (!conversationId) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/messages?conversation_id=eq.${conversationId}&select=role,content&order=created_at.asc&limit=${MAX_HISTORY_MESSAGES}`,
      { headers: SB_HEADERS }
    );
    const rows = await res.json();
    return Array.isArray(rows) ? rows.map(r => ({ role: r.role, content: r.content })) : [];
  } catch(e) {
    return [];
  }
}

async function saveMessages(conversationId, businessId, userMsg, botReply) {
  if (!conversationId) return;
  try {
    const now = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify([
        { conversation_id: conversationId, business_id: businessId, role: 'user', content: userMsg, created_at: now },
        { conversation_id: conversationId, business_id: businessId, role: 'assistant', content: botReply, created_at: now }
      ])
    });
  } catch(e) {
    console.error('Save error:', e.message);
  }
}

// Rate limit tilaushauille: max ORDER_LOOKUP_MAX_ATTEMPTS / ORDER_LOOKUP_WINDOW_MS per sessio.
// Kirjaa yrityksen aina (myös ylityksen), jotta ikkuna ei nollaudu spämmäämällä.
async function isOrderLookupAllowed(businessId, sessionId) {
  try {
    const windowStart = new Date(Date.now() - ORDER_LOOKUP_WINDOW_MS).toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/order_lookup_attempts?session_id=eq.${encodeURIComponent(sessionId)}&created_at=gte.${windowStart}&select=id`,
      { headers: SB_HEADERS }
    );
    const rows = await res.json();
    const count = Array.isArray(rows) ? rows.length : 0;

    fetch(`${SUPABASE_URL}/rest/v1/order_lookup_attempts`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({ business_id: businessId, session_id: sessionId })
    }).catch(() => {});

    return count < ORDER_LOOKUP_MAX_ATTEMPTS;
  } catch(e) {
    return true;
  }
}

// Suorittaa tilaushaun kulova-appin sisäisen endpointin kautta. Palauttaa aina
// JSON-merkkijonon jonka malli tulkitsee — {"found":false} identtisenä KAIKISSA
// epäonnistumistapauksissa (ei löydy / email ei täsmää / rate limit / verkkovirhe),
// jotta malli (eikä siis asiakas) ei voi erottaa syytä toisistaan.
async function executeOrderLookup(business, sessionId, input) {
  const NOT_FOUND = JSON.stringify({ found: false });

  const allowed = await isOrderLookupAllowed(business.id, sessionId);
  if (!allowed) return NOT_FOUND;
  if (!KULOVA_INTERNAL_KEY || !business.shopify_domain) return NOT_FOUND;

  try {
    const res = await fetch(`${KULOVA_APP_URL}/api/order-lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kulova-key': KULOVA_INTERNAL_KEY },
      body: JSON.stringify({
        shopDomain: business.shopify_domain,
        orderNumber: input?.order_number,
        email: input?.email
      })
    });
    if (!res.ok) return NOT_FOUND;
    const data = await res.json();
    if (!data?.found) return NOT_FOUND;
    return JSON.stringify(data);
  } catch(e) {
    return NOT_FOUND;
  }
}

function buildOrderLookupTool() {
  return {
    name: 'look_up_order',
    description: 'Hae Shopify-tilauksen tila tilausnumeron ja sähköpostin perusteella. Kysy molemmat asiakkaalta ensin jos et vielä tiedä niitä molempia — älä koskaan arvaa tai keksi niitä.',
    input_schema: {
      type: 'object',
      properties: {
        order_number: { type: 'string', description: 'Tilausnumero, esim. 1001 tai #1001' },
        email: { type: 'string', description: 'Tilauksessa käytetty sähköpostiosoite' }
      },
      required: ['order_number', 'email']
    },
    cache_control: { type: 'ephemeral' }
  };
}

function buildSystemBlocks(promptText) {
  return [{ type: 'text', text: promptText, cache_control: { type: 'ephemeral' } }];
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
  // support_email is the Shopify-settings field; owner_email keeps this working
  // for pre-Shopify kulova.com customers who never set support_email.
  const contactEmail = biz.support_email || biz.owner_email || '';

  // Kulova has no mechanism to actually forward a question to the merchant —
  // telling the customer "we'll pass this along" would be a lie nobody acts on.
  // Point them at a real contact channel instead, or be upfront that there isn't one.
  const unknownAnswerInstruction = contactEmail
    ? `Jos asiakas kysyy jotain mita et tieda, kerro rehellisesti ettet tieda vastausta ja ohjaa hanet ottamaan yhteytta osoitteeseen ${contactEmail}.`
    : website
      ? `Jos asiakas kysyy jotain mita et tieda, kerro rehellisesti ettet tieda vastausta ja ohjaa hanet yrityksen verkkosivuille (${website}) ottamaan yhteytta.`
      : `Jos asiakas kysyy jotain mita et tieda, kerro rehellisesti ettet tieda vastausta ja pyyda hanta ottamaan suoraan yhteytta yritykseen. ALA VAITA etta valitat asian eteenpain tai etta joku ottaa haneen yhteytta, koska sinulla ei ole tallaista mekanismia.`;

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
- Pidat vastaukset lyhyina: 2-3 lausetta, ellei kysymys aidosti vaadi enempaa
- Et kayta markdown-muotoilua (ei **bold**, ei # otsikot) etka minkaanlaista HTML:aa vastauksessasi
- Et kayta emojeja ellei asiakas kayta niita
${bookingUrl ? `- Kun asiakas haluaa varata ajan tai kysyy ajanvarauksesta, lisaa vastauksesi ihan loppuun tasmalleen merkkijono ${BOOKING_SENTINEL} (pelkka teksti, ei muotoilua) — jarjestelma nayttaa sen kohdalla varausnapin asiakkaalle.` : ''}
${!bookingUrl ? `- Et voi tehda ajanvarauksia etka kirjata aikoja jarjestelmaan. Jos asiakas haluaa varata ajan, pyyda hanta soittamaan tai kayttamaan yrityksen tavallista varaustapaa. ALA KOSKAAN vaita etta olet tehnyt varauksen tai etta varaus on hoidettu.` : ''}
${botInstructions ? `\nLISAOHJEET (nama ovat tarkeampia kuin ylla olevat ohjeet):\n${botInstructions}` : ''}

${unknownAnswerInstruction}`;
}

async function callAnthropic(body) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, sessionId, businessId, shopDomain } = req.body;
  if (!message || !sessionId) return res.status(400).json({ error: 'Missing fields' });

  let systemPrompt;
  let resolvedBusinessId = businessId || null;
  let biz = null;

  if (businessId === 'demo') {
    systemPrompt = `Olet Kulova-demon asiakaspalveluagentti. Kulova on suomalainen AI-palvelu joka hoitaa yritysten asiakasviestinnan automaattisesti. Hinta 49e/kk. Vastaat lyhyesti ja selkeasti suomeksi ilman markdown-muotoilua tai emojeja.`;
  } else if (shopDomain) {
    biz = await getBusinessByShopDomain(shopDomain);
    if (biz) resolvedBusinessId = biz.id;
    systemPrompt = buildSystemPrompt(biz);
  } else {
    biz = await getBusinessData(businessId);
    systemPrompt = buildSystemPrompt(biz);
  }

  const canPersist = resolvedBusinessId && resolvedBusinessId !== 'demo';
  let conversationId = null;
  let history = [];
  if (canPersist) {
    conversationId = await getOrCreateConversation(resolvedBusinessId, sessionId);
    history = await loadHistory(conversationId);
  }

  // Tilausseuranta tarjotaan vain Shopify-kaupoille (vaatii shopify_domainin) —
  // legacy kulova.com-asiakkailla ei ole Shopify-tilauksia hakea.
  const tools = biz?.shopify_domain ? [buildOrderLookupTool()] : null;

  try {
    const baseBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: buildSystemBlocks(systemPrompt),
      messages: [...history, { role: 'user', content: message }]
    };
    if (tools) baseBody.tools = tools;

    let { ok, data } = await callAnthropic(baseBody);
    if (!ok) {
      console.error('Anthropic error:', data);
      return res.status(500).json({ reply: 'Hetki — yrita uudelleen.' });
    }
    console.log('Anthropic usage:', JSON.stringify(data.usage));

    if (data.stop_reason === 'tool_use') {
      const toolUse = data.content.find(b => b.type === 'tool_use');
      if (toolUse) {
        const toolResultText = (toolUse.name === 'look_up_order' && biz)
          ? await executeOrderLookup(biz, sessionId, toolUse.input)
          : JSON.stringify({ found: false });

        const secondBody = {
          ...baseBody,
          messages: [
            ...baseBody.messages,
            { role: 'assistant', content: data.content },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResultText }] }
          ]
        };

        const second = await callAnthropic(secondBody);
        if (!second.ok) {
          console.error('Anthropic error (tool round):', second.data);
          return res.status(500).json({ reply: 'Hetki — yrita uudelleen.' });
        }
        data = second.data;
      }
    }

    let reply = data.content?.find(b => b.type === 'text')?.text || 'Yrita uudelleen.';
    let bookingUrl;
    if (reply.includes(BOOKING_SENTINEL)) {
      reply = reply.split(BOOKING_SENTINEL).join('').trim();
      if (biz?.booking_url) bookingUrl = biz.booking_url;
    }

    if (canPersist) {
      await saveMessages(conversationId, resolvedBusinessId, message, reply);
    }

    const payload = { reply };
    if (bookingUrl) payload.bookingUrl = bookingUrl;
    res.status(200).json(payload);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ reply: 'Yhteysvirhe — yrita hetken kuluttua.' });
  }
};
