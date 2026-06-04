// api/email.js — Sähköpostivastaaja

const { generateReply } = require('../lib/agent');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { from, to, subject, text, businessId } = req.body;

  try {
    // Hae yrityksen tiedot (tuotannossa tietokannasta)
    const business = {
      name: 'Yritys',
      type: 'palveluyritys',
      services: 'Palvelut ja hinnat määrittämättä',
      hours: 'Ma-Pe 9-17',
      ownerEmail: to
    };

    const { reply, needsEscalation } = await generateReply(
      business,
      `Aihe: ${subject}\n\n${text}`,
      []
    );

    // Lähetä vastaussähköposti Brevon kautta
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { name: business.name, email: to },
        to: [{ email: from }],
        subject: `Re: ${subject}`,
        textContent: reply
      })
    });

    if (needsEscalation) {
      // Ilmoita yrittäjälle
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.BREVO_API_KEY
        },
        body: JSON.stringify({
          sender: { name: 'Kulova', email: 'noreply@kulova.com' },
          to: [{ email: business.ownerEmail }],
          subject: `⚠️ Tärkeä asiakasviesti: ${subject}`,
          textContent: `Asiakas ${from} lähetti viestin joka vaatii huomiotasi:\n\n${text}`
        })
      });
    }

    res.status(200).json({ success: true, reply });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
