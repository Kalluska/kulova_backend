// widget.js — Kulova chat widget
// Lisätään asiakkaan nettisivulle yhdellä script-tagilla

(function() {
  const KULOVA_API = 'https://kulova-backend.vercel.app';
  const businessId = document.currentScript?.getAttribute('data-business') || 'demo';
  const sessionId = Math.random().toString(36).substring(2, 15);

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    #kulova-widget { position: fixed; bottom: 24px; right: 24px; z-index: 9999; font-family: system-ui, sans-serif; }
    #kulova-btn { width: 56px; height: 56px; border-radius: 50%; background: #c8f25a; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(0,0,0,0.2); transition: transform 0.2s; }
    #kulova-btn:hover { transform: scale(1.05); }
    #kulova-btn svg { width: 24px; height: 24px; }
    #kulova-box { position: absolute; bottom: 68px; right: 0; width: 320px; background: #fff; border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); overflow: hidden; display: none; flex-direction: column; }
    #kulova-box.open { display: flex; }
    #kulova-header { background: #0a0a08; color: #c8f25a; padding: 16px; font-weight: 600; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
    #kulova-header span { font-size: 11px; color: #6b6b63; font-weight: 400; }
    #kulova-messages { flex: 1; padding: 16px; overflow-y: auto; max-height: 300px; display: flex; flex-direction: column; gap: 10px; }
    .kulova-msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }
    .kulova-msg.bot { background: #f5f3ee; color: #0a0a08; align-self: flex-start; }
    .kulova-msg.user { background: #0a0a08; color: #f5f3ee; align-self: flex-end; }
    .kulova-msg.typing { background: #f5f3ee; color: #9a9a90; font-style: italic; }
    #kulova-input-area { padding: 12px; border-top: 1px solid #f0f0f0; display: flex; gap: 8px; }
    #kulova-input { flex: 1; border: 1px solid #e0e0e0; border-radius: 100px; padding: 8px 16px; font-size: 14px; outline: none; font-family: inherit; }
    #kulova-input:focus { border-color: #c8f25a; }
    #kulova-send { background: #c8f25a; border: none; border-radius: 100px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; color: #0a0a08; }
    #kulova-send:hover { background: #a8d43a; }
    #kulova-footer { text-align: center; padding: 8px; font-size: 10px; color: #c0c0c0; border-top: 1px solid #f0f0f0; }
    #kulova-footer a { color: #c0c0c0; text-decoration: none; }
  `;
  document.head.appendChild(style);

  // Inject HTML
  const widget = document.createElement('div');
  widget.id = 'kulova-widget';
  widget.innerHTML = `
    <div id="kulova-box">
      <div id="kulova-header">
        <div>Asiakaspalvelu <span>● Online</span></div>
        <button onclick="document.getElementById('kulova-box').classList.remove('open')" style="background:none;border:none;color:#6b6b63;cursor:pointer;font-size:18px;">×</button>
      </div>
      <div id="kulova-messages">
        <div class="kulova-msg bot">Hei! 👋 Miten voin auttaa?</div>
      </div>
      <div id="kulova-input-area">
        <input id="kulova-input" type="text" placeholder="Kirjoita viesti..." />
        <button id="kulova-send">Lähetä</button>
      </div>
      <div id="kulova-footer">Powered by <a href="https://kulova.com" target="_blank">Kulova</a></div>
    </div>
    <button id="kulova-btn" onclick="document.getElementById('kulova-box').classList.toggle('open')">
      <svg viewBox="0 0 24 24" fill="none" stroke="#0a0a08" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
    </button>
  `;
  document.body.appendChild(widget);

  const messagesEl = document.getElementById('kulova-messages');
  const inputEl = document.getElementById('kulova-input');
  const sendBtn = document.getElementById('kulova-send');

  function addMessage(text, type) {
    const msg = document.createElement('div');
    msg.className = `kulova-msg ${type}`;
    msg.textContent = text;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msg;
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    addMessage(text, 'user');

    const typing = addMessage('Kirjoittaa...', 'typing');

    try {
      const res = await fetch(`${KULOVA_API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, businessId })
      });
      const data = await res.json();
      typing.remove();
      addMessage(data.reply || 'Virhe — yritä uudelleen', 'bot');
    } catch (e) {
      typing.remove();
      addMessage('Virhe — yritä uudelleen', 'bot');
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
})();
