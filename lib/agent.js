// lib/agent.js — Kulova AI core

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function buildSystemPrompt(business) {
  return `Olet ${business.name}-yrityksen asiakaspalveluagentti. Vastaat asiakkaiden viesteihin yrityksen puolesta.

YRITYKSEN TIEDOT:
- Nimi: ${business.name}
- Toimiala: ${business.type}
- Palvelut ja hinnat: ${business.services}
- Aukioloajat: ${business.hours}
- Sijainti: ${business.location || 'ei määritelty'}
- Lisätiedot: ${business.extra || ''}

OHJEET:
- Vastaa aina suomeksi ellei asiakas kirjoita englanniksi
- Ole ystävällinen mutta asiallinen — kuten oikea ihminen kirjoittaisi
- Älä koskaan lupaa mitä yritys ei voi toimittaa
- Jos asiakas haluaa varata ajan, kysy milloin sopii ja kerro vahvistus
- Jos et tiedä vastausta, sano rehellisesti "En tiedä tarkalleen, mutta voit soittaa meille"
- Älä mainitse olevasi tekoäly ellei erikseen kysytä
- Pidä vastaukset lyhyinä — maksimissaan 3-4 lausetta
- Jos viesti vaatii yrittäjän huomiota (reklamaatio, kiireellinen asia), lisää lopuksi: [TÄRKEÄ: ohjaa yrittäjälle]`;
}

async function generateReply(business, customerMessage, conversationHistory = []) {
  const systemPrompt = await buildSystemPrompt(business);

  const messages = [
    ...conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    { role: 'user', content: customerMessage }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages
  });

  const reply = response.content[0].text;
  const needsEscalation = reply.includes('[TÄRKEÄ: ohjaa yrittäjälle]');
  const cleanReply = reply.replace('[TÄRKEÄ: ohjaa yrittäjälle]', '').trim();

  return { reply: cleanReply, needsEscalation };
}

module.exports = { generateReply };
