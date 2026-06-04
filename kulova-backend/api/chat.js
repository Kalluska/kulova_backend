// api/chat.js — Chat widget endpoint

const { generateReply } = require('../lib/agent');

const conversations = {};

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, sessionId, businessId } = req.body;

  if (!message || !sessionId || !businessId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Hae yrityksen tiedot (tuotannossa tietokannasta businessId:n perusteella)
    const business = {
      name: 'Yritys',
      type: 'palveluyritys',
      services: 'Palvelut ja hinnat pyydettäessä',
      hours: 'Ma-Pe 9-17'
    };

    if (!conversations[sessionId]) conversations[sessionId] = [];

    const { reply, needsEscalation } = await generateReply(
      business,
      message,
      conversations[sessionId]
    );

    conversations[sessionId].push({ role: 'user', content: message });
    conversations[sessionId].push({ role: 'assistant', content: reply });

    if (conversations[sessionId].length > 20) {
      conversations[sessionId] = conversations[sessionId].slice(-20);
    }

    res.status(200).json({ reply, needsEscalation });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Virhe — yritä uudelleen' });
  }
};
