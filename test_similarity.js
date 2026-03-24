const http = require('http');

const testCases = [
  { city: 'Kochi', price: 5000000, propertyType: 'Apartment', bedrooms: 2, area: 1200 },
  { city: 'Kozhikode', price: 8000000, propertyType: 'House', bedrooms: 3, area: 2000 }
];

async function runTests() {
  for (const testCase of testCases) {
    console.log(`\nTesting case: ${JSON.stringify(testCase)}`);
    const data = JSON.stringify(testCase);
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/properties/similar',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        const result = JSON.parse(body);
        console.log(`Success: ${result.success}`);
        console.log(`Results Found: ${result.results.length}`);
        if (result.results.length > 0) {
          result.results.forEach((r, idx) => {
            console.log(` Match ${idx+1}: ${r.title} | Score: ${r.similarityScore}% | City: ${r.address.city} | Type: ${r.propertyType}`);
          });
        }
      });
    });

    req.on('error', (e) => console.error(e));
    req.write(data);
    req.end();
    await new Promise(r => setTimeout(r, 1000));
  }
}

runTests();
