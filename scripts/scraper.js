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

// Enhanced logging setup
const logger = {
  log: (...args) => console.log(`[${new Date().toISOString()}]`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}]`, ...args)
};

async function initializeFirebase() {
  logger.log('Initializing Firebase...');
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DB_URL
    });

    logger.log('Firebase initialized successfully');
    return admin.firestore();
  } catch (error) {
    logger.error('Firebase initialization failed:', error);
    process.exit(1);
  }
}

async function scrapeListings(client) {
  logger.log('Starting listings scrape...');
  try {
    const searchRes = await client.get(SEARCH_URL, { 
      params: IDX_PARAMS,
      timeout: 15000 
    });
    
    const $ = cheerio.load(searchRes.data);
    const containers = $('div.multiLineDisplay.ajax_display.d68m_show');

    const listings = containers.map((i, el) => {
      const $el = $(el);
      const listingId = $el.find('div.ivResponsive').attr('data-key') || `fallback-${Date.now()}-${i}`;
      logger.log(`Processing listing ${i + 1} - ID: ${listingId}`);
      
      return {
        listingId,
        address: $el.find('div.d-fontSize--largest.d-color--brandDark a').text().trim(),
        price: $el.find('div.col-sm-12:has(> .d-fontSize--largest)').text().trim().match(/\$[\d,]+/)?.[0] || 'N/A',
        beds: $el.find('div.d-marginLeft--10').text().match(/(\d+)\s*Beds/)?.[1] || '0',
        baths: $el.find('div.d-marginLeft--10').text().match(/(\d+)\s*Full Baths/)?.[1] || '0',
        images: [],
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      };
    }).get();

    logger.log(`Found ${listings.length} listings total`);
    return listings;
  } catch (error) {
    logger.error('Scraping failed:', error);
    throw error;
  }
}

async function processImages(listings, browser) {
  logger.log('Starting image processing...');
  const page = await browser.newPage();
  try {
    logger.log('Navigating to search URL with Puppeteer...');
    await page.goto(`${SEARCH_URL}?${new URLSearchParams(IDX_PARAMS)}`, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });

    // Wait for critical elements and dynamic content
    await page.waitForSelector('.ivResponsive', { timeout: 30000 });
    await page.waitForTimeout(2000); // Additional buffer for images
    
    const html = await page.content();
    const rawLinks = Array.from(new Set(
      html.match(/https:\/\/matrix\.marismatrix\.com\/mediaserver\/GetMedia\.ashx\?[^"'\s]+/gi) || []
    )).map(link => decodeURIComponent(link));

    logger.log(`Found ${rawLinks.length} raw image links before validation`);

    // Enhanced validation with concurrency control
    const validatedLinks = [];
    const seenUrls = new Set();

    for (let i = 0; i < rawLinks.length; i += MAX_CONCURRENT) {
      const chunk = rawLinks.slice(i, i + MAX_CONCURRENT);
      logger.log(`Processing image chunk ${i / MAX_CONCURRENT + 1}/${Math.ceil(rawLinks.length / MAX_CONCURRENT)}`);
      
      const results = await Promise.all(chunk.map(async url => {
        if (!url.includes('2&exk') || seenUrls.has(url)) return null;
        seenUrls.add(url);
        return validateImage(url);
      }));

      validatedLinks.push(...results.filter(Boolean));
      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
    }

    logger.log(`Validated ${validatedLinks.length} unique image URLs`);

    // Map images to listings with error handling
    const imageMap = validatedLinks.reduce((acc, link) => {
      try {
        const keyMatch = link.match(/Key=([^&]+)/);
        if (keyMatch) (acc[keyMatch[1]] ||= []).push(link);
        return acc;
      } catch (error) {
        logger.error(`Error processing image URL ${link}:`, error);
        return acc;
      }
    }, {});

    const listingsWithImages = listings.map(listing => ({
      ...listing,
      images: imageMap[listing.listingId] || []
    }));

    const totalImages = listingsWithImages.reduce((sum, l) => sum + l.images.length, 0);
    logger.log(`Mapped ${totalImages} images across ${listings.length} listings`);
    
    return listingsWithImages;
  } finally {
    await page.close();
  }
}

async function validateImage(url) {
  try {
    logger.log(`Validating image: ${url}`);
    const response = await axios.head(url, {
      timeout: 5000,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    const isValid = response.status === 200 &&
      response.headers['content-length'] > CONTENT_THRESHOLD &&
      response.headers['content-type']?.startsWith('image/');

    return isValid ? url : null;
  } catch (error) {
    logger.error(`Image validation failed for ${url}:`, error.message);
    return null;
  }
}

async function writeToFirestore(db, listings) {
  logger.log(`Starting Firestore write for ${listings.length} listings...`);
  try {
    const batchCount = Math.ceil(listings.length / FIRESTORE_BATCH_SIZE);
    
    for (let i = 0; i < listings.length; i += FIRESTORE_BATCH_SIZE) {
      const batch = db.batch();
      const chunk = listings.slice(i, i + FIRESTORE_BATCH_SIZE);
      
      chunk.forEach(listing => {
        const docRef = db.collection('listings').doc(listing.listingId);
        batch.set(docRef, listing, { 
          merge: true,
          mergeFields: ['address', 'price', 'beds', 'baths', 'images', 'lastUpdated']
        });
      });

      logger.log(`Committing batch ${Math.ceil(i/FIRESTORE_BATCH_SIZE) + 1}/${batchCount}`);
      await batch.commit();
      await new Promise(resolve => setTimeout(resolve, 1500)); // Rate limiting
    }
    
    logger.log('Firestore write completed successfully');
  } catch (error) {
    logger.error('Firestore write failed:', error);
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': SEARCH_URL
      }
    }));

    const listings = await scrapeListings(client);
    
    const browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--single-process'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: 120000
    });
    
    const listingsWithImages = await processImages(listings, browser);
    await browser.close();

    await writeToFirestore(db, listingsWithImages);
    logger.log('Scraper completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Scraper failed:', error);
    process.exit(1);
  }
}

main();