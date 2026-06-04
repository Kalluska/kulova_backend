# Kulova Backend

AI-agentti joka vastaa asiakkaille 24/7.

## Rakenne

```
api/
  chat.js      — Chat widget endpoint
  whatsapp.js  — WhatsApp webhook (Twilio)
  email.js     — Sähköpostivastaaja
  stripe.js    — Maksut ja tilaukset
  onboard.js   — Yrityksen rekisteröinti
  widget.js    — Chat widget (JS)
lib/
  agent.js     — AI-agentin ydinlogiikka
```

## Setup

### 1. Kloonaa repo ja asenna riippuvuudet
```bash
git clone https://github.com/Kalluska/kulova-backend.git
cd kulova-backend
npm install
```

### 2. Luo Vercel-projekti
```bash
npm i -g vercel
vercel
```

### 3. Lisää ympäristömuuttujat Verceliin
Mene Vercel Dashboard → Settings → Environment Variables:

| Muuttuja | Mistä saat |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook asetuksista |
| `TWILIO_ACCOUNT_SID` | console.twilio.com |
| `TWILIO_AUTH_TOKEN` | console.twilio.com |
| `TWILIO_WHATSAPP_NUMBER` | whatsapp:+14155238886 (Twilio sandbox) |
| `BREVO_API_KEY` | brevo.com |
| `FRONTEND_URL` | https://kulova.com |

### 4. Twilio WhatsApp sandbox
1. Mene console.twilio.com → Messaging → Try it out → WhatsApp
2. Aseta webhook URL: `https://kulova-backend.vercel.app/api/whatsapp`
3. Testaa lähettämällä WhatsApp-viesti numeroon +1 415 523 8886

### 5. Stripe webhook
1. Mene dashboard.stripe.com → Developers → Webhooks
2. Lisää endpoint: `https://kulova-backend.vercel.app/api/stripe/webhook`
3. Valitse eventit: `checkout.session.completed`, `customer.subscription.deleted`

### 6. Chat widget asiakkaan sivulle
```html
<script src="https://kulova-backend.vercel.app/api/widget.js" data-business="BUSINESS_ID"></script>
```

## API Endpoints

| Endpoint | Metodi | Kuvaus |
|---|---|---|
| `/api/chat` | POST | Chat widget |
| `/api/whatsapp` | POST | WhatsApp webhook |
| `/api/email` | POST | Sähköposti |
| `/api/stripe/checkout` | POST | Luo maksusessio |
| `/api/stripe/webhook` | POST | Stripe webhook |
| `/api/onboard` | POST | Yrityksen rekisteröinti |
| `/api/widget.js` | GET | Chat widget JS |
