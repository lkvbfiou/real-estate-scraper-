require('dotenv').config();
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const path = require('path');

const logger = {
  info: (...args) => console.log(`[INFO] ${new Date().toISOString()}`, ...args),
  error: (...args) => console.error(`[ERROR] ${new Date().toISOString()}`, ...args)
};

// Configuration
const TARGET_URL = 'https://matrix.marismatrix.com/Matrix/Public/IDXSearch.aspx?count=1&idx=c2fe5d4&pv=&or=';
const DB_PATH = 'final_listings';
const LISTING_SELECTOR = 'div.multiLineDisplay.ajax_display.d68m_show';

async function initializeFirebase() {
  try {
    const serviceAccount = require(path.join(__dirname, '..', 'config', 'firebase-cfg.json'));
    
    if (!serviceAccount.private_key.includes('BEGIN PRIVATE KEY')) {
      throw new Error('Invalid private key format');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        ...serviceAccount,
        private_key: serviceAccount.private_key.replace(/\\n/g, '\n')
      }),
      databaseURL: process.env.FIREBASE_DB_URL
    });

    const db = admin.database();
    await db.ref('connection-test').set({ timestamp: Date.now() });
    logger.info('Firebase initialized successfully');
    
    return db;
  } catch (error) {
    logger.error('Firebase initialization failed:', error.stack);
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

async function scrapeGoogleMapsData(address) {
  try {
    const searchQuery = encodeURIComponent(`${address} Missouri`);
    const googleMapsUrl = `https://www.google.com/maps/search/${searchQuery}`;
    
    const response = await axios.get(googleMapsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    
    return {
      mapSectionHTML: $('div.lu_map_section').html(),
      streetViewLink: $('a[data-url*="/streetview/"]').attr('href'),
      staticMapImage: $('img.YQ4gaf').attr('src')
    };
  } catch (error) {
    logger.error('Google Maps scrape failed:', error.stack);
    return null;
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

    $(LISTING_SELECTOR).each(async (i, el) => {
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
        images: { size2: [], size3: [] },
        mapData: {},
        lastUpdated: Date.now()
      };

      // Scrape Google Maps data
      listing.mapData = await scrapeGoogleMapsData(listing.address);
      listings.push(listing);
    });

    return listings.reverse();
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

    for (const rawUrl of rawLinks) {
      try {
        const isSize2 = rawUrl.includes('2&exk');
        const isSize3 = rawUrl.includes('3&exk');
        if (!isSize2 && !isSize3) continue;

        const parsed = new URL(rawUrl);
        const listingId = parsed.searchParams.get('Key');
        if (!listingId || !listingIds.has(listingId)) continue;

        const response = await axios.head(rawUrl, { timeout: 5000 });
        if (response.status !== 200 || !response.headers['content-type']?.startsWith('image/')) continue;

        if (!imageMap.has(listingId)) {
          imageMap.set(listingId, { size2: [], size3: [] });
        }

        const category = isSize2 ? 'size2' : 'size3';
        imageMap.get(listingId)[category].push(rawUrl);
      } catch (error) {
        logger.error(`Image processing error: ${error.message}`);
      }
    }

    return listings.map(listing => ({
      ...listing,
      images: imageMap.get(listing.listingId) || { size2: [], size3: [] }
    }));
  } catch (error) {
    logger.error('Image processing failed:', error.stack);
    return listings;
  }
}

function deduplicateListings(listings) {
  const addressMap = new Map();
  const uniqueListings = [];
  
  for (const listing of listings.reverse()) {
    const existing = addressMap.get(listing.address);
    
    if (!existing) {
      addressMap.set(listing.address, listing);
      uniqueListings.push(listing);
    } else if (existing.lastUpdated > listing.lastUpdated) {
      const index = uniqueListings.findIndex(l => l.listingId === existing.listingId);
      uniqueListings[index] = listing;
      addressMap.set(listing.address, listing);
    }
  }

  logger.info(`Removed ${listings.length - uniqueListings.length} duplicates`);
  return uniqueListings.reverse();
}

async function main() {
  try {
    const db = await initializeFirebase();
    await clearDatabase(db);

    const listings = await scrapeListings();
    const fullListings = await processImages(listings);
    const finalListings = deduplicateListings(fullListings);

    const updates = {};
    finalListings.forEach((listing, index) => {
      const reverseIndex = finalListings.length - 1 - index;
      updates[`${DB_PATH}/${reverseIndex}_${listing.listingId}`] = {
        ...listing,
        position: reverseIndex
      };
    });

    await db.ref().update(updates);
    logger.info(`Stored ${finalListings.length} listings in reverse order`);
    process.exit(0);
  } catch (error) {
    logger.error('Main process failed:', error.stack);
    process.exit(1);
  }
}

main();