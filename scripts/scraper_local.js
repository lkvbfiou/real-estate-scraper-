const puppeteer = require('puppeteer');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const admin = require('firebase-admin');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const SEARCH_URL = 'https://matrix.marismatrix.com/Matrix/Public/IDXSearch.aspx';
const IDX_PARAMS = { count: 50, idx: 'c2fe5d4' };
const CONTENT_THRESHOLD = 1024;
const MAX_CONCURRENT_REQUESTS = 3;

// Firebase Initialization
async function initializeFirebase() {
  console.log('Initializing Firebase...');
  try {
    const serviceAccount = require('./serviceAccount.json');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://realestatehomesadmin-default-rtdb.firebaseio.com'
    });

    console.log('Firebase initialized successfully');
    return admin.database();
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    process.exit(1);
  }
}

async function scrapeListings(client) {
  console.log('Scraping listings...');
  try {
    const searchRes = await client.get(SEARCH_URL, { 
      params: IDX_PARAMS,
      timeout: 15000 
    });
    
    const $ = cheerio.load(searchRes.data);
    const containers = $('div.multiLineDisplay.ajax_display.d68m_show');

    const listings = containers.map((i, el) => {
      const $el = $(el);
      const listingId = $el.find('div.ivResponsive').attr('data-key') || `local-${Date.now()}-${i}`;
      console.log(`Processing listing ${i + 1} - ID: ${listingId}`);
      
      return {
        listingId,
        address: $el.find('div.d-fontSize--largest.d-color--brandDark a').text().trim(),
        price: $el.find('div.col-sm-12:has(> .d-fontSize--largest)').text().trim().match(/\$[\d,]+/)?.[0] || 'N/A',
        beds: $el.find('div.d-marginLeft--10').text().match(/(\d+)\s*Beds/)?.[1] || '0',
        baths: $el.find('div.d-marginLeft--10').text().match(/(\d+)\s*Full Baths/)?.[1] || '0',
        images: []
      };
    }).get();

    console.log(`Found ${listings.length} listings total`);
    return listings;
  } catch (error) {
    console.error('Scraping failed:', error);
    throw error;
  }
}

async function processImages(listings, browser) {
  console.log('Starting image processing...');
  const page = await browser.newPage();
  try {
    console.log('Navigating to search URL with Puppeteer...');
    await page.goto(`${SEARCH_URL}?${new URLSearchParams(IDX_PARAMS)}`, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });

    // Wait for potential image containers to load
    await page.waitForSelector('.ivResponsive', { timeout: 15000 });
    const html = await page.content();
    
    console.log('Extracting image URLs...');
    const rawLinks = Array.from(
      new Set(
        html.match(/https:\/\/matrix\.marismatrix\.com\/mediaserver\/GetMedia\.ashx\?[^"'\s]+/gi) || []
      )
    ).map(link => 
      link.replace(/&amp;/g, '&')
          .replace(/%3a/gi, ':')
          .replace(/%2f/gi, '/')
          .replace(/%3f/gi, '?')
          .replace(/%3d/gi, '=')
    );

    console.log(`Found ${rawLinks.length} raw image links before validation`);

    const validatedLinks = [];
    const seenUrls = new Set();

    const validateUrl = async (url) => {
      try {
        if (!url.includes('2&exk')) {
          console.log(`Skipping URL (missing parameter): ${url}`);
          return null;
        }
        
        if (seenUrls.has(url)) {
          console.log(`Skipping duplicate URL: ${url}`);
          return null;
        }

        console.log(`Validating image URL: ${url}`);
        const response = await axios.get(url, { 
          timeout: 5000,
          responseType: 'arraybuffer'
        });
        
        const isValid = response.data.length > CONTENT_THRESHOLD &&
                        response.headers['content-type']?.startsWith('image/') &&
                        response.status === 200;

        if (isValid) {
          console.log(`Valid image found: ${url}`);
          return url;
        }
        console.log(`Invalid image (failed checks): ${url}`);
        return null;
      } catch (error) {
        console.log(`Image validation failed for ${url}: ${error.message}`);
        return null;
      }
    };

    // Process URLs in chunks
    for (let i = 0; i < rawLinks.length; i += MAX_CONCURRENT_REQUESTS) {
      const chunk = rawLinks.slice(i, i + MAX_CONCURRENT_REQUESTS);
      console.log(`Processing chunk ${i / MAX_CONCURRENT_REQUESTS + 1} of ${Math.ceil(rawLinks.length / MAX_CONCURRENT_REQUESTS)}`);
      
      const results = await Promise.all(chunk.map(validateUrl));
      
      results.filter(link => link).forEach(link => {
        if (!seenUrls.has(link)) {
          validatedLinks.push(link);
          seenUrls.add(link);
        }
      });
    }

    console.log(`Validated ${validatedLinks.length} unique image URLs`);

    // Map images to listings
    const listingIdMap = validatedLinks.reduce((acc, link) => {
      const keyMatch = link.match(/Key=([^&]+)/);
      if (keyMatch) {
        const listingId = keyMatch[1];
        acc[listingId] = acc[listingId] || [];
        acc[listingId].push(link);
      } else {
        console.log(`No Key parameter found in image URL: ${link}`);
      }
      return acc;
    }, {});

    // Verify mapping
    const listingsWithImages = listings.map(listing => {
      const images = listingIdMap[listing.listingId] || [];
      if (images.length === 0) {
        console.log(`No images found for listing ${listing.listingId}`);
      }
      return { ...listing, images };
    });

    const totalMappedImages = listingsWithImages.reduce((sum, listing) => sum + listing.images.length, 0);
    console.log(`Mapped ${totalMappedImages} images to ${listings.length} listings`);

    return listingsWithImages;
  } finally {
    await page.close();
  }
}

async function writeToRealtimeDB(db, listings) {
  console.log(`Writing ${listings.length} listings to Firebase...`);
  try {
    const updates = {};
    const timestamp = admin.database.ServerValue.TIMESTAMP;
    
    listings.forEach((listing, index) => {
      console.log(`Preparing listing ${index + 1}/${listings.length} for write: ${listing.listingId}`);
      updates[`/listings/data/${index}`] = {
        ...listing,
        actualImages: listing.images.length,
        lastUpdated: timestamp
      };
    });

    console.log('Sending batch update to Firebase...');
    await db.ref().update(updates);
    console.log(`Successfully wrote ${listings.length} listings to Firebase`);
  } catch (error) {
    console.error('Realtime Database write failed:', error);
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      }
    }));

    const listings = await scrapeListings(client);
    
    const browser = await puppeteer.launch({
      headless: false,
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      timeout: 60000
    });
    
    const listingsWithImages = await processImages(listings, browser);
    await browser.close();

    await writeToRealtimeDB(db, listingsWithImages);
    console.log('Local scraper completed successfully');
  } catch (error) {
    console.error('Local scraper failed:', error);
  }
}

main();