const fetch = require('node-fetch');
(async () => {
    try {
        console.log('Sending webhook...');
        await fetch('http://127.0.0.1:8787/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({id: 'TEST-POLL-123'})
        });
        
        console.log('Fetching pending...');
        const res = await fetch('http://127.0.0.1:8787/pending');
        console.log(await res.text());
    } catch(e) {
        console.error(e);
    }
})();
