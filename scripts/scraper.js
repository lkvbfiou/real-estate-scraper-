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

// Enhanced logger
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
    logger.log('Navigating to search URL...');
    
    // Configure timeouts
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(60000);

    const navigationPromise = page.goto(`${SEARCH_URL}?${new URLSearchParams(IDX_PARAMS)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    // Add timeout race condition
    await Promise.race([
      navigationPromise,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Navigation timeout exceeded')), 
        90000
      ))
    ]);

    logger.log('Waiting for critical elements...');
    await page.waitForSelector('.ivResponsive', { timeout: 30000 });

    // Debug screenshot in CI
    if (process.env.CI) {
      await page.screenshot({ path: 'debug-page.png' });
      logger.log('Saved debug screenshot');
    }

    logger.log('Extracting image links...');
    const html = await page.content();
    
    const rawLinks = Array.from(new Set(
      html.match(/https:\/\/matrix\.marismatrix\.com\/mediaserver\/GetMedia\.ashx\?[^"'\s]+/gi) || []
    )).map(link => decodeURIComponent(link));

    logger.log(`Found ${rawLinks.length} raw image links`);

    // Image validation
    const validatedLinks = [];
    const seenUrls = new Set();

    for (let i = 0; i < rawLinks.length; i += MAX_CONCURRENT) {
      const chunk = rawLinks.slice(i, i + MAX_CONCURRENT);
      logger.log(`Processing image chunk ${Math.ceil(i/MAX_CONCURRENT) + 1}/${Math.ceil(rawLinks.length/MAX_CONCURRENT)}`);
      
      const results = await Promise.all(chunk.map(async url => {
        if (!url.includes('2&exk') || seenUrls.has(url)) return null;
        seenUrls.add(url);
        return validateImage(url);
      }));

      validatedLinks.push(...results.filter(Boolean));
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    logger.log(`Validated ${validatedLinks.length} images`);

    // Map images to listings
    const imageMap = validatedLinks.reduce((acc, link) => {
      try {
        const keyMatch = link.match(/Key=([^&]+)/);
        if (keyMatch) (acc[keyMatch[1]] ||= []).push(link);
        return acc;
      } catch (error) {
        logger.error(`Error processing image URL: ${link}`, error);
        return acc;
      }
    }, {});

    const listingsWithImages = listings.map(listing => ({
      ...listing,
      images: imageMap[listing.listingId] || []
    }));

    const totalImages = listingsWithImages.reduce((sum, l) => sum + l.images.length, 0);
    logger.log(`Mapped ${totalImages} images to ${listings.length} listings`);
    
    return listingsWithImages;
  } catch (error) {
    logger.error('Image processing failed:', error);
    throw error;
  } finally {
    await page.close();
    logger.log('Closed browser page');
  }
}

async function validateImage(url) {
  try {
    logger.log(`Validating: ${url}`);
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
    logger.error(`Validation failed for ${url}:`, error.message);
    return null;
  }
}

async function writeToFirestore(db, listings) {
  logger.log(`Writing ${listings.length} listings to Firestore...`);
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
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    logger.log('Firestore write completed');
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
    
    logger.log('Launching browser...');
    const browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--single-process',
        '--no-zygote',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: 120000
    });
    
    const listingsWithImages = await processImages(listings, browser);
    await browser.close();
    logger.log('Browser closed');

    await writeToFirestore(db, listingsWithImages);
    logger.log('Scraper completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Scraper failed:', error);
    process.exit(1);
  }
}

main();