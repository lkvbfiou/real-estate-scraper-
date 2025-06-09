// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAb-MHQwnocdR3hfbh3jjR0TdfXG_ZWxVU",
    authDomain: "realestatehomesadmin.firebaseapp.com",
    databaseURL: "https://realestatehomesadmin-default-rtdb.firebaseio.com",
    projectId: "realestatehomesadmin",
    storageBucket: "realestatehomesadmin.firebasestorage.app",
    messagingSenderId: "243682405794",
    appId: "1:243682405794:web:5bf48d15fda558a62996fb",
    measurementId: "G-FDXTBEV5TN"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const listingsContainer = document.getElementById('listings-container');

// Carousel elements
const nextDom = document.getElementById('next');
const prevDom = document.getElementById('prev');
const carouselDom = document.querySelector('.modal .carousel');
const sliderDom = carouselDom.querySelector('.list');
const thumbnailDom = carouselDom.querySelector('.thumbnail');
const timeDom = carouselDom.querySelector('.time');

// Helper function to format values
function formatValue(val) {
    if (val === '0' || val === 0 || val === 'N/A' || val === '') {
        return '-';
    }
    return val;
}

// Helper function to check if details should be hidden
function shouldHideDetails(listing) {
    const fields = [
        listing.beds, 
        listing.baths, 
        listing.sqft, 
        listing.yearBuilt, 
        listing.acreage
    ];
    
    const invalidCount = fields.filter(val => 
        val === '0' || val === 0 || val === 'N/A' || val === ''
    ).length;
    
    return invalidCount >= 3;
}

// Create listing element
function createListingElement(listing) {
    const div = document.createElement('div');
    div.className = 'listing';
    
    // Determine if we should hide details
    const hideDetails = shouldHideDetails(listing);
    
    // Create image HTML (static first image)
    let imageHTML = '';
    if (listing.images && listing.images.size3 && listing.images.size2.length > 0) {
        imageHTML = `
            <div class="listing-slider">
                <img src="${listing.images.size3[0]}" alt="Property image" class="main-image">
                <div class="hover-tooltip">Click to see the images in fullscreen</div>
            </div>
        `;
    } else {
        imageHTML = '<div class="listing-slider">No images available</div>';
    }
    
    div.innerHTML = `
        <div class="listing-header">
            <h2 class="listing-address">${listing.address}</h2>
            <div class="listing-location">${listing.location}</div>
            <div class="listing-price">${listing.price}</div>
            <div class="listing-status">${listing.status}</div>
            <div class="listing-type">${listing.propertyType}</div>
        </div>
        
        ${imageHTML}
        
        <div class="listing-details">
            ${hideDetails ? 
                '<div class="coming-soon">More information coming soon!</div>' : 
                `
                <div class="details-grid">
                    <div class="detail-item">
                        <div class="detail-value">${formatValue(listing.beds)}</div>
                        <div class="detail-label">Beds</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-value">${formatValue(listing.baths)}</div>
                        <div class="detail-label">Baths</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-value">${formatValue(listing.sqft)}</div>
                        <div class="detail-label">SqFt</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-value">${formatValue(listing.yearBuilt)}</div>
                        <div class="detail-label">Year</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-value">${formatValue(listing.acreage)}</div>
                        <div class="detail-label">Acres</div>
                    </div>
                </div>
                
                <div class="listing-description">${listing.description}</div>
                `
            }
        </div>
    `;
    
    // Add click handler
    const slider = div.querySelector('.listing-slider');
    if (slider) {
        slider.addEventListener('click', () => showPopup(listing));
    }
    
    return div;
}

// Show popup with carousel
function showPopup(listing) {
    const modal = document.getElementById('imageModal');
    const propertyDetails = modal.querySelector('.property-details');
    
    // Clear previous content
    sliderDom.innerHTML = '';
    thumbnailDom.innerHTML = '';
    
    // Add images to carousel
    if (listing.images && listing.images.size3 && listing.images.size3.length > 0) {
        listing.images.size3.forEach((img, index) => {
            // Main slider image
            const slide = document.createElement('div');
            slide.className = `item ${index === 0 ? 'active' : ''}`;
            slide.innerHTML = `<img src="${img}" alt="Property image ${index + 1}">`;
            sliderDom.appendChild(slide);
            
            // Thumbnail
            const thumb = document.createElement('div');
            thumb.className = `item ${index === 0 ? 'active' : ''}`;
            thumb.innerHTML = `<img src="${img}" alt="Property thumbnail ${index + 1}">`;
            thumb.addEventListener('click', () => showSlide(index));
            thumbnailDom.appendChild(thumb);
        });
    } else {
        sliderDom.innerHTML = '<div class="item active"><p>No images available</p></div>';
    }
    
    // Determine if details should be hidden
    const hideDetails = shouldHideDetails(listing);
    
    // Add property details
    propertyDetails.innerHTML = `
        <h2>${listing.address}</h2>
        <div class="property-price">${listing.price}</div>
        <div class="property-status">${listing.status}</div>
        
        ${hideDetails ? 
            '<div class="coming-soon">More information coming soon!</div>' : 
            `
            <div class="detail-grid">
                <div class="detail-item-large">
                    <span class="detail-label-large">Location</span>
                    <p class="detail-value-large">${listing.location}</p>
                </div>
                <div class="detail-item-large">
                    <span class="detail-label-large">Property Type</span>
                    <p class="detail-value-large">${listing.propertyType}</p>
                </div>
                <div class="detail-item-large">
                    <span class="detail-label-large">Beds</span>
                    <p class="detail-value-large">${formatValue(listing.beds)}</p>
                </div>
                <div class="detail-item-large">
                    <span class="detail-label-large">Baths</span>
                    <p class="detail-value-large">${formatValue(listing.baths)}</p>
                </div>
                <div class="detail-item-large">
                    <span class="detail-label-large">Square Feet</span>
                    <p class="detail-value-large">${formatValue(listing.sqft)}</p>
                </div>
                <div class="detail-item-large">
                    <span class="detail-label-large">Year Built</span>
                    <p class="detail-value-large">${formatValue(listing.yearBuilt)}</p>
                </div>
                <div class="detail-item-large">
                    <span class="detail-label-large">Acreage</span>
                    <p class="detail-value-large">${formatValue(listing.acreage)} Acres</p>
                </div>
            </div>
            `
        }
    `;
    
    modal.style.display = 'block';
    initCarousel();
}

// Initialize carousel
function initCarousel() {
    const slides = sliderDom.querySelectorAll('.item');
    const thumbnails = thumbnailDom.querySelectorAll('.item');
    let currentIndex = 0;
    let autoPlayInterval;
    
    // Navigation functions
    function goToSlide(index) {
        // Update slides
        slides[currentIndex].classList.remove('active');
        slides[index].classList.add('active');
        
        // Update thumbnails
        thumbnails[currentIndex].classList.remove('active');
        thumbnails[index].classList.add('active');
        
        currentIndex = index;
        
        // Reset progress bar
        timeDom.style.width = '0%';
        clearInterval(autoPlayInterval);
        startAutoPlay();
    }
    
    function nextSlide() {
        const nextIndex = (currentIndex + 1) % slides.length;
        goToSlide(nextIndex);
    }
    
    function prevSlide() {
        const prevIndex = (currentIndex - 1 + slides.length) % slides.length;
        goToSlide(prevIndex);
    }
    
    function showSlide(index) {
        goToSlide(index);
    }
    
    function startAutoPlay() {
        let progress = 0;
        const duration = 5000; // 5 seconds per slide
        
        autoPlayInterval = setInterval(() => {
            progress += 10;
            timeDom.style.width = `${progress / (duration / 10)}%`;
            
            if (progress >= duration) {
                nextSlide();
            }
        }, 10);
    }
    
    // Add event listeners
    nextDom.onclick = nextSlide;
    prevDom.onclick = prevSlide;
    
    // Initialize thumbnails
    thumbnails.forEach((thumb, index) => {
        thumb.addEventListener('click', () => showSlide(index));
    });
    
    // Start autoplay
    startAutoPlay();
}

// Close Modal
document.querySelector('.close-btn').addEventListener('click', () => {
    document.getElementById('imageModal').style.display = 'none';
});

// Close modal when clicking outside content
window.addEventListener('click', (e) => {
    const modal = document.getElementById('imageModal');
    if (e.target === modal) {
        modal.style.display = 'none';
    }
});

// Real-time listener
database.ref('final_listings').on('value', (snapshot) => {
    const listings = snapshot.val() || {};
    const sortedListings = Object.values(listings).sort((a, b) => a.position - b.position);
    
    listingsContainer.innerHTML = '';
    sortedListings.forEach(listing => {
        const element = createListingElement(listing);
        listingsContainer.appendChild(element);
    });
});