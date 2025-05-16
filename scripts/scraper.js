const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const SEARCH_URL = 'https://matrix.marismatrix.com/Matrix/Public/IDXSearch.aspx';
const IDX_PARAMS = { count: 50, idx: 'c2fe5d4' };
const CONTENT_THRESHOLD = 1024;
const MAX_CONCURRENT = 3;
const FIRESTORE_BATCH_SIZE = 400;

async function initializeFirebase() {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DB_URL
    });

    return admin.firestore();
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    process.exit(1);
  }
}

async function scrapeListings(client) {
  try {
    const searchRes = await client.get(SEARCH_URL, { 
      params: IDX_PARAMS,
      timeout: 15000 
    });
    
    const $ = cheerio.load(searchRes.data);
    const containers = $('div.multiLineDisplay.ajax_display.d68m_show');

    return containers.map((i, el) => {
      const $el = $(el);
      return {
        listingId: $el.find('div.ivResponsive').attr('data-key') || `fallback-${Date.now()}-${i}`,
        address: $el.find('div.d-fontSize--largest.d-color--brandDark a').text().trim(),
        price: $el.find('div.col-sm-12:has(> .d-fontSize--largest)').text().trim().match(/\$[\d,]+/)?.[0] || 'N/A',
        beds: $el.find('div.d-marginLeft--10').text().match(/(\d+)\s*Beds/)?.[1] || '0',
        baths: $el.find('div.d-marginLeft--10').text().match(/(\d+)\s*Full Baths/)?.[1] || '0',
        images: [],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };
    }).get();
  } catch (error) {
    console.error('Scraping failed:', error);
    throw error;
  }
}

async function processImages(listings, browser) {
  const page = await browser.newPage();
  try {
    await page.goto(`${SEARCH_URL}?${new URLSearchParams(IDX_PARAMS)}`, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });

    const html = await page.content();
    const imageLinks = Array.from(new Set(
      html.match(/https:\/\/matrix\.marismatrix\.com\/mediaserver\/GetMedia\.ashx\?[^"'\s]+/gi) || []
    )).map(link => decodeURIComponent(link));

    const validatedLinks = [];
    for (let i = 0; i < imageLinks.length; i += MAX_CONCURRENT) {
      const chunk = imageLinks.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.all(chunk.map(validateImage));
      validatedLinks.push(...results.filter(Boolean));
    }

    const imageMap = validatedLinks.reduce((acc, link) => {
      const keyMatch = link.match(/Key=([^&]+)/);
      if (keyMatch) (acc[keyMatch[1]] ||= []).push(link);
      return acc;
    }, {});

    return listings.map(listing => ({
      ...listing,
      images: imageMap[listing.listingId] || []
    }));
  } finally {
    await page.close();
  }
}

async function validateImage(url) {
  try {
    const response = await axios.head(url, { 
      timeout: 5000,
      validateStatus: () => true 
    });
    return response.headers['content-length'] > CONTENT_THRESHOLD &&
           response.headers['content-type']?.startsWith('image/') ?
           url : null;
  } catch {
    return null;
  }
}

async function writeToFirestore(db, listings) {
  try {
    for (let i = 0; i < listings.length; i += FIRESTORE_BATCH_SIZE) {
      const batch = db.batch();
      const chunk = listings.slice(i, i + FIRESTORE_BATCH_SIZE);

      chunk.forEach(listing => {
        const docRef = db.collection('listings').doc(listing.listingId);
        batch.set(docRef, listing, { merge: true });
      });

      console.log(`Committing batch ${Math.ceil(i/FIRESTORE_BATCH_SIZE) + 1}`);
      await batch.commit();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('Firestore write failed:', error);
    throw error;
  }
}

async function main() {
  try {
    const db = await initializeFirebase();
    const jar = new CookieJar();
    const client = wrapper(axios.create({ 
      jar,
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }));

    const listings = await scrapeListings(client);
    console.log(`Found ${listings.length} listings`);

    const browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: 60000
    });
    
    const listingsWithImages = await processImages(listings, browser);
    await browser.close();

    await writeToFirestore(db, listingsWithImages);
    console.log('Scraper completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  }
}

main();