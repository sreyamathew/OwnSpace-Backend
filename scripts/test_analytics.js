const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api/analytics';
// Note: You'll need a valid token to test this if protection is enabled.
// For now, I'll check if the routes even exist (expecting 401 or 200).
const token = ''; // Fill this if manual testing

async function testEndpoints() {
    const endpoints = [
        '/stats',
        '/location-distribution',
        '/monthly-trends',
        '/risk-distribution',
        '/ai-insights'
    ];

    for (const ep of endpoints) {
        try {
            console.log(`Testing ${ep}...`);
            const res = await axios.get(`${BASE_URL}${ep}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            console.log(`✅ ${ep}: ${res.status} ${JSON.stringify(res.data).substring(0, 50)}...`);
        } catch (err) {
            console.log(`❌ ${ep}: ${err.response?.status || err.message}`);
            if (err.response?.data) console.log('   Data:', err.response.data);
        }
    }
}

testEndpoints();
