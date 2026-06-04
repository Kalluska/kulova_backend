// api/chat.js — Kulova chat endpoint (no external deps)

const conversations = {};

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

  const systemPrompt = businessId === 'demo'
    ? `Olet Kulovan asiakaspalvelu. Kulova on AI-palvelu joka hoitaa pienyrityksen asiakasviestit automaattisesti — WhatsApp, sähköposti ja nettisivun chat. Hinta 49€/kk, ei sitoutumista.

Vastaa AINA lyhyesti — maksimissaan 2-3 lausetta. Älä käytä bullet-listoja tai emojeja. Puhu kuten normaali ihminen puhuisi, ei kuin markkinointiteksti. Älä aloita vastausta sanoilla "Hyvä kysymys" tai ylistyksellä. Vastaa suomeksi.`
    : `Olet yrityksen asiakaspalvelu. Vastaa lyhyesti ja luonnollisesti suomeksi, maksimissaan 2-3 lausetta.`;

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
      return res.status(500).json({ error: 'AI error', reply: 'Hetki — yritä uudelleen.' });
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
