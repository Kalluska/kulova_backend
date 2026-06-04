// api/onboard.js — Yrityksen onboarding-lomake

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    businessName,
    businessType,
    services,
    hours,
    location,
    ownerEmail,
    ownerPhone,
    whatsappNumber,
    extra
  } = req.body;

  // Validointi
  if (!businessName || !services || !ownerEmail) {
    return res.status(400).json({ error: 'Pakollisia kenttiä puuttuu' });
  }

  try {
    // Tallenna tietokantaan (TODO: lisää tietokanta)
    const businessId = `biz_${Date.now()}`;
    const business = {
      id: businessId,
      name: businessName,
      type: businessType || 'palveluyritys',
      services,
      hours: hours || 'Ma-Pe 9-17',
      location,
      ownerEmail,
      ownerPhone,
      whatsappNumber,
      extra,
      createdAt: new Date().toISOString()
    };

    console.log('Uusi yritys rekisteröity:', business);

    // Lähetä tervetuloa-sähköposti yrittäjälle
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { name: 'Kulova', email: 'hello@kulova.com' },
        to: [{ email: ownerEmail, name: businessName }],
        subject: 'Tervetuloa Kulovaan! 🎉',
        htmlContent: `
          <h2>Moi!</h2>
          <p>Kulova on nyt käytössä yrityksellesi <strong>${businessName}</strong>.</p>
          <p>Seuraava askel: yhdistä WhatsApp-numero tai chat-widget nettisivullesi.</p>
          <p>Chat-widget-koodi nettisivullesi:</p>
          <pre style="background:#f5f5f5;padding:12px;border-radius:8px;">
&lt;script src="https://kulova.com/widget.js" data-business="${businessId}"&gt;&lt;/script&gt;
          </pre>
          <p>Kysymyksiä? Vastaan heti: hello@kulova.com</p>
          <p>— Kulova</p>
        `
      })
    });

    res.status(200).json({
      success: true,
      businessId,
      widgetCode: `<script src="https://kulova.com/widget.js" data-business="${businessId}"></script>`
    });

  } catch (error) {
    console.error('Onboard error:', error);
    res.status(500).json({ error: 'Rekisteröinti epäonnistui' });
  }
};
