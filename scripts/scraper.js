require('dotenv').config();
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const logger = {
  info: (...args) => console.log(`[INFO] ${new Date().toISOString()}`, ...args),
  error: (...args) => console.error(`[ERROR] ${new Date().toISOString()}`, ...args)
};

// Configuration
const TARGET_URL = 'https://matrix.marismatrix.com/Matrix/Public/IDXSearch.aspx?count=1&idx=c2fe5d4&pv=&or=';
const DB_PATH = 'property_listings';
const LISTING_SELECTOR = 'div.multiLineDisplay.ajax_display.d68m_show';

async function scrapePropertyListings() {
  try {
    logger.info(`Scraping property listings from ${TARGET_URL}`);
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
      const details = $el.find('div.col-sm-12:has(div.d-marginLeft--10)').text().replace(/\s+/g, ' ');
      
      // Extract numeric values using improved regex patterns
      const getValue = (pattern) => details.match(pattern)?.[1]?.replace(/,/g, '') || '0';
      
      const listing = {
        listingId: $el.find('div.ivResponsive').attr('data-key') || `listing-${Date.now()}-${i}`,
        address: $el.find('div.d-fontSize--largest.d-color--brandDark a').text().trim(),
        price: $el.find('div.col-sm-12:has(> .d-fontSize--largest)').text().trim().match(/\$[\d,]+/)?.[0] || 'N/A',
        beds: getValue(/(\d+)\s*Beds/),
        fullBaths: getValue(/(\d+)\s*Full Baths/),
        halfBaths: getValue(/(\d+)\s*Half Baths/),
        sqft: getValue(/([\d,]+)\s*SqFt/),
        yearBuilt: getValue(/Built in.*?(\d{4})/),
        acreage: getValue(/([\d.]+)\s*Acres/),
        images: [],
        lastUpdated: Date.now()
      };

      listings.push(listing);
    });

    // Reverse the listings array as requested
    return listings.reverse();
  } catch (error) {
    logger.error('Property scraping failed:', error.stack);
    process.exit(1);
  }
}

async function processFullListing() {
  const db = await initializeFirebase();
  await clearDatabase(db);

  try {
    // Step 1: Scrape property details
    const listings = await scrapePropertyListings();
    logger.info(`Found ${listings.length} property listings`);

    // Step 2: Scrape and process images
    const imageMap = await processAndMapImages();
    
    // Step 3: Merge image data with property details
    const fullListings = listings.map(listing => ({
      ...listing,
      images: imageMap[listing.listingId] || []
    }));

    // Step 4: Prepare Firebase updates
    const updates = {};
    fullListings.forEach((listing, index) => {
      updates[`${DB_PATH}/${index}_${listing.listingId}`] = listing;
    });

    // Step 5: Write to database
    await db.ref().update(updates);
    logger.info(`Successfully stored ${fullListings.length} reversed listings`);

    process.exit(0);
  } catch (error) {
    logger.error('Full processing failed:', error.stack);
    process.exit(1);
  }
}

// Modified image processor to return mapping
async function processAndMapImages() {
  try {
    const response = await axios.get(TARGET_URL, { timeout: 30000 });
    const html = response.data;
    const rawLinks = [...new Set(html.match(/https:\/\/matrix\.marismatrix\.com\/mediaserver\/GetMedia\.ashx\?[^"'\s]+/gi) || [])];
    
    const validatedImages = [];
    for (let i = 0; i < rawLinks.length; i += MAX_CONCURRENT_REQUESTS) {
      const chunk = rawLinks.slice(i, i + MAX_CONCURRENT_REQUESTS);
      const results = await Promise.all(chunk.map(validateImageUrl));
      validatedImages.push(...results.filter(Boolean));
    }

    return validatedImages.reduce((acc, image) => {
      acc[image.listingId] = acc[image.listingId] || [];
      acc[image.listingId].push(image.url);
      return acc;
    }, {});
  } catch (error) {
    logger.error('Image processing failed:', error.stack);
    return {};
  }
}

// Initialization and cleanup functions remain the same as previous example
// (initializeFirebase, clearDatabase, validateImageUrl)

// Execute
if (!require('./serviceAccount.json')) {
  logger.error('Missing service account file');
  process.exit(1);
}

processFullListing();