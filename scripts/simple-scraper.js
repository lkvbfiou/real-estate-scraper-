const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const SEARCH_URL = 'https://matrix.marismatrix.com/Matrix/Public/IDXSearch.aspx';
const IDX_PARAMS = { count: 50, idx: 'c2fe5d4' };
const CONTENT_THRESHOLD = 1024;
const BATCH_SIZE = 100;

async function initializeFirebase() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DB_URL
  });
  return admin.firestore();
}

async function scrapeImageLinks() {
  try {
    const response = await axios.get(SEARCH_URL, { params: IDX_PARAMS });
    const $ = cheerio.load(response.data);
    
    // Find all links containing the media server pattern
    const imageLinks = [];
    $('a[href*="GetMedia.ashx?"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        imageLinks.push({
          url: href,
          listingId: href.match(/Key=([^&]+)/)?.[1] || 'unknown',
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    console.log(`Found ${imageLinks.length} potential image links`);
    return imageLinks;
  } catch (error) {
    console.error('Scraping failed:', error);
    throw error;
  }
}

async function writeToFirestore(db, links) {
  const batch = db.batch();
  const collection = db.collection('image-tester');
  
  links.forEach(link => {
    const docRef = collection.doc(link.listingId);
    batch.set(docRef, link, { merge: true });
  });

  await batch.commit();
  console.log(`Wrote ${links.length} links to Firestore`);
}

async function main() {
  try {
    const db = await initializeFirebase();
    const links = await scrapeImageLinks();
    await writeToFirestore(db, links);
    console.log('Scraper completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  }
}

main();