const fetch = require('node-fetch');

(async () => {
    // 1. Check if the server is alive and responds to /webhook
    try {
        const r1 = await fetch('http://127.0.0.1:8787/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'TEST-NODE-DEBUG' })
        });
        console.log('Webhook Status:', r1.status);
        console.log('Webhook Body:', await r1.text());
    } catch (e) {
        console.error('Failed to hit /webhook:', e.message);
    }

})();
