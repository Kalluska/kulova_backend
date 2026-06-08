// api/scrape.js — Hakee yritystiedot verkkosivulta
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    // Hae sivun sisältö
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kulova/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    const html = await pageRes.text();

    // Poista HTML-tagit ja ota vain teksti
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    // Käytä Anthropic API:a parsimaan tiedot
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
        system: 'Olet apulainen joka poimii yritystietoja verkkosivun tekstistä. Vastaa VAIN JSON-muodossa, ei muuta tekstiä.',
        messages: [{
          role: 'user',
          content: `Poimi seuraavasta verkkosivun tekstistä yrityksen tiedot JSON-muodossa. Kentät: name (yrityksen nimi), services (palvelut ja hinnat lyhyesti), hours (aukioloajat). Jos tietoa ei löydy, jätä kenttä tyhjäksi. Vastaa VAIN JSON objektina.\n\nTeksti:\n${text}`
        }]
      })
    });

    const aiData = await aiRes.json();
    const replyText = aiData.content?.[0]?.text || '{}';
    const clean = replyText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    res.status(200).json(parsed);
  } catch(e) {
    console.error('Scrape error:', e.message);
    res.status(500).json({ error: 'Scrape failed', name: '', services: '', hours: '' });
  }
};
