require('dotenv').config();
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const path = require('path');

// Logger configuration
const logger = {
  info: (...args) => console.log(`[INFO] ${new Date().toISOString()}`, ...args),
  error: (...args) => console.error(`[ERROR] ${new Date().toISOString()}`, ...args)
};

// Configuration constants
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'firebase-cfg.json');
const DB_URL = 'https://realestatehomesadmin-default-rtdb.firebaseio.com';

async function initializeFirebase() {
  try {
    logger.info('Initializing Firebase connection...');
    
    // Load configuration
    const serviceAccount = require(CONFIG_PATH);
    
    // Validate configuration
    if (!serviceAccount.project_id || 
        !serviceAccount.private_key || 
        !serviceAccount.client_email) {
      throw new Error('Invalid Firebase configuration - missing required fields');
    }

    // Fix newline formatting in private key
    const formattedKey = serviceAccount.private_key.replace(/\\n/g, '\n');

    // Initialize Firebase Admin SDK
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: formattedKey
      }),
      databaseURL: DB_URL
    });

    // Test database connection
    const db = admin.database();
    const testRef = db.ref('connection-test');
    await testRef.set({
      timestamp: Date.now(),
      status: 'Connection test successful'
    });

    logger.info('Firebase initialized successfully');
    return db;

  } catch (error) {
    logger.error('Firebase initialization failed:', error.message);
    
    // Specific error handling
    if (error.code === 'MODULE_NOT_FOUND') {
      logger.error('Missing firebase-cfg.json in config directory');
    } else if (error.code === 'app/invalid-credential') {
      logger.error('Credential validation failed - verify service account key');
    }
    
    process.exit(1);
  }
}

async function clearDatabase(db) {
  try {
    logger.info('Clearing existing data...');
    await db.ref(DB_PATH).remove();
    logger.info('Database cleared successfully');
  } catch (error) {
    logger.error('Database cleanup failed:', error.stack);
    process.exit(1);
  }
}

async function scrapeListings() {
  try {
    logger.info(`Scraping listings from ${TARGET_URL}`);
    const response = await axios.get(TARGET_URL, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const listings = [];

    $(LISTING_SELECTOR).each((i, el) => {
      const $el = $(el);
      const detailsText = $el.find('div.d-marginLeft--10').text();
      
      const listing = {
        listingId: $el.find('div.ivResponsive').attr('data-key') || `listing-${Date.now()}-${i}`,
        address: $el.find('div.d-fontSize--largest.d-color--brandDark a').text().trim(),
        price: $el.find('div.col-sm-12:has(> .d-fontSize--largest)').text().trim().match(/\$[\d,]+/)?.[0] || 'N/A',
        beds: detailsText.match(/(\d+)\s*Beds/)?.[1] || '0',
        baths: detailsText.match(/(\d+)\s*Full Baths/)?.[1] || '0',
        sqft: detailsText.match(/([\d,]+)\s*SqFt/)?.[1]?.replace(/,/g, '') || '0',
        yearBuilt: detailsText.match(/Built in.*?(\d{4})/)?.[1] || 'N/A',
        acreage: detailsText.match(/([\d.]+)\s*Acres/)?.[1] || '0',
        images: [],
        lastUpdated: Date.now()
      };

      listings.push(listing);
    });

    return listings.reverse(); // Reverse order as requested
  } catch (error) {
    logger.error('Listing scrape failed:', error.stack);
    process.exit(1);
  }
}

async function processImages(listings) {
  try {
    logger.info('Processing images...');
    const response = await axios.get(TARGET_URL, { timeout: 30000 });
    const html = response.data;
    const rawLinks = [...new Set(html.match(/https:\/\/matrix\.marismatrix\.com\/mediaserver\/GetMedia\.ashx\?[^"'\s]+/gi) || [])];
    
    const imageMap = new Map();
    const listingIds = new Set(listings.map(l => l.listingId));

    // Process all image URLs
    for (const rawUrl of rawLinks) {
      try {
        if (!rawUrl.includes('2&exk')) continue;

        const parsed = new URL(rawUrl);
        const listingId = parsed.searchParams.get('Key');
        if (!listingId || !listingIds.has(listingId)) continue;

        // Validate basic image properties
        const response = await axios.head(rawUrl, { timeout: 5000 });
        if (response.status !== 200 || !response.headers['content-type']?.startsWith('image/')) continue;

        if (!imageMap.has(listingId)) {
          imageMap.set(listingId, []);
        }
        imageMap.get(listingId).push(rawUrl);
      } catch (error) {
        logger.error(`Image processing error: ${error.message}`);
      }
    }

    // Map images to listings
    return listings.map(listing => ({
      ...listing,
      images: imageMap.get(listing.listingId) || []
    }));
  } catch (error) {
    logger.error('Image processing failed:', error.stack);
    return listings;
  }
}

function deduplicateListings(listings) {
  const addressMap = new Map();
  const uniqueListings = [];
  
  // Process in reverse-chronological order (newest first)
  for (const listing of listings.reverse()) {
    const existing = addressMap.get(listing.address);
    
    if (!existing) {
      addressMap.set(listing.address, listing);
      uniqueListings.push(listing);
    } else if (existing.lastUpdated > listing.lastUpdated) {
      // Replace with older listing
      const index = uniqueListings.findIndex(l => l.listingId === existing.listingId);
      uniqueListings[index] = listing;
      addressMap.set(listing.address, listing);
    }
  }

  logger.info(`Removed ${listings.length - uniqueListings.length} duplicates`);
  return uniqueListings.reverse(); // Return in original reversed order
}

async function main() {
  try {
    const db = await initializeFirebase();
    await clearDatabase(db);
    
    // Scrape and process data
    let listings = await scrapeListings();
    let fullListings = await processImages(listings);
    const finalListings = deduplicateListings(fullListings);

    // Prepare updates
    const updates = {};
    finalListings.forEach((listing, index) => {
      const reverseIndex = finalListings.length - 1 - index;
      updates[`${DB_PATH}/${reverseIndex}_${listing.listingId}`] = {
        ...listing,
        position: reverseIndex
      };
    });

    // Write to database
    await db.ref().update(updates);
    logger.info(`Successfully stored ${finalListings.length} listings`);
    
    process.exit(0);
  } catch (error) {
    logger.error('Main process failed:', error.stack);
    process.exit(1);
  }
}

// Start the process
main();