// test-creds.js
try {
    const creds = process.env.FIREBASE_CREDENTIALS;
    JSON.parse(creds);
    console.log('✅ Credentials are valid JSON');
  } catch (error) {
    console.error('❌ Invalid JSON:', error.message);
  }