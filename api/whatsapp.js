// api/whatsapp.js — Twilio WhatsApp webhook

const twilio = require('twilio');
const { generateReply } = require('../lib/agent');

// Yksinkertainen in-memory store (tuotannossa käytetään tietokantaa)
const conversations = {};
const businesses = {};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Twilio validointi
  const twilioSignature = req.headers['x-twilio-signature'];
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const url = `https://${req.headers.host}/api/whatsapp`;

  const isValid = twilio.validateRequest(authToken, twilioSignature, url, req.body);
  if (!isValid && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const { From, Body, To } = req.body;
  const customerPhone = From; // whatsapp:+358401234567
  const businessPhone = To;

  try {
    // Hae yrityksen tiedot numeron perusteella
    const business = businesses[businessPhone] || {
      name: 'Yritys',
      type: 'palveluyritys',
      services: 'Palvelut ja hinnat määrittämättä',
      hours: 'Ma-Pe 9-17',
      location: 'Helsinki'
    };

    // Hae tai luo keskusteluhistoria
    const convKey = `${customerPhone}-${businessPhone}`;
    if (!conversations[convKey]) conversations[convKey] = [];

    // Generoi vastaus
    const { reply, needsEscalation } = await generateReply(
      business,
      Body,
      conversations[convKey]
    );

    // Tallenna historiaan
    conversations[convKey].push({ role: 'user', content: Body });
    conversations[convKey].push({ role: 'assistant', content: reply });

    // Pidä historia max 10 viestissä
    if (conversations[convKey].length > 10) {
      conversations[convKey] = conversations[convKey].slice(-10);
    }

    // Lähetä vastaus Twilion kautta
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      from: businessPhone,
      to: customerPhone,
      body: reply
    });

    // Jos tärkeä viesti, lähetä ilmoitus yrittäjälle
    if (needsEscalation && business.ownerPhone) {
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${business.ownerPhone}`,
        body: `⚠️ Kulova-ilmoitus: Asiakas ${customerPhone} lähetti viestin joka vaatii huomiotasi:\n\n"${Body}"`
      });
    }

    res.status(200).send('<Response></Response>');
  } catch (error) {
    console.error('WhatsApp error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
