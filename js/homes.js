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
let popupSwiper = null;
let carouselInterval = null;

// Carousel elements
const nextDom = document.getElementById('next');
const prevDom = document.getElementById('prev');
const carouselDom = document.querySelector('.modal .carousel');
const sliderDom = carouselDom.querySelector('.list');
const thumbnailDom = carouselDom.querySelector('.thumbnail');
const timeDom = carouselDom.querySelector('.time');

function createListingElement(listing) {
    const div = document.createElement('div');
    div.className = 'listing';
    
    // Create gallery HTML
    let galleryHTML = '';
    if (listing.images && listing.images.size2 && listing.images.size2.length > 0) {
        galleryHTML = `
            <div class="listing-slider">
                <div class="gallery-container">
                    ${listing.images.size2.map((img, index) => `
                        <div class="gallery-slide ${index === 0 ? 'active' : ''}">
                            <img src="${img}" alt="Property image ${index + 1}">
                        </div>
                    `).join('')}
                </div>
                <div class="hover-tooltip">Click to see the images in fullscreen</div>
            </div>
        `;
    } else {
        galleryHTML = '<div class="listing-slider">No images available</div>';
    }
    
    div.innerHTML = `
        <div class="listing-header">
            <h2 class="listing-address">${listing.address}</h2>
            <div class="listing-location">${listing.location}</div>
            <div class="listing-price">${listing.price}</div>
            <div class="listing-status">${listing.status}</div>
            <div class="listing-type">${listing.propertyType}</div>
        </div>
        
        ${galleryHTML}
        
        <div class="listing-details">
            <div class="details-grid">
                <div class="detail-item">
                    <div class="detail-value">${listing.beds}</div>
                    <div class="detail-label">Beds</div>
                </div>
                <div class="detail-item">
                    <div class="detail-value">${listing.baths}</div>
                    <div class="detail-label">Baths</div>
                </div>
                <div class="detail-item">
                    <div class="detail-value">${listing.sqft}</div>
                    <div class="detail-label">SqFt</div>
                </div>
                <div class="detail-item">
                    <div class="detail-value">${listing.yearBuilt}</div>
                    <div class="detail-label">Year</div>
                </div>
                <div class="detail-item">
                    <div class="detail-value">${listing.acreage}</div>
                    <div class="detail-label">Acres</div>
                </div>
            </div>
            
            <div class="listing-description">${listing.description}</div>
        </div>
    `;
    
    // Add click handler to slider container
    const slider = div.querySelector('.listing-slider');
    if (slider) {
        slider.addEventListener('click', () => showPopup(listing));
    }
    
    // Initialize gallery animation if there are multiple images
    const gallerySlides = div.querySelectorAll('.gallery-slide');
    if (gallerySlides.length > 1) {
        startGalleryAnimation(div);
    }
    
    return div;
}

function startGalleryAnimation(listingElement) {
    const slides = listingElement.querySelectorAll('.gallery-slide');
    let currentIndex = 0;
    
    // Shuffle slides for random order
    const slidesArray = Array.from(slides);
    for (let i = slidesArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slidesArray[i], slidesArray[j]] = [slidesArray[j], slidesArray[i]];
    }
    
    // Apply shuffled order
    const container = listingElement.querySelector('.gallery-container');
    container.innerHTML = '';
    slidesArray.forEach(slide => container.appendChild(slide));
    
    // Set first slide as active
    slidesArray[0].classList.add('active');
    
    // Rotate images every 5 seconds
    setInterval(() => {
        // Remove active class from current slide
        slidesArray[currentIndex].classList.remove('active');
        
        // Move to next slide
        currentIndex = (currentIndex + 1) % slidesArray.length;
        
        // Add active class to new slide
        slidesArray[currentIndex].classList.add('active');
    }, 5000);
}

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
    
    // Add property details
    propertyDetails.innerHTML = `
        <h2>${listing.address}</h2>
        <div class="property-price">${listing.price}</div>
        <div class="property-status">${listing.status}</div>
        
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
                <p class="detail-value-large">${listing.beds}</p>
            </div>
            <div class="detail-item-large">
                <span class="detail-label-large">Baths</span>
                <p class="detail-value-large">${listing.baths}</p>
            </div>
            <div class="detail-item-large">
                <span class="detail-label-large">Square Feet</span>
                <p class="detail-value-large">${listing.sqft}</p>
            </div>
            <div class="detail-item-large">
                <span class="detail-label-large">Year Built</span>
                <p class="detail-value-large">${listing.yearBuilt}</p>
            </div>
            <div class="detail-item-large">
                <span class="detail-label-large">Acreage</span>
                <p class="detail-value-large">${listing.acreage} Acres</p>
            </div>
        </div>
        
        <div class="description-text">${listing.description}</div>
    `;
    
    modal.style.display = 'block';
    initCarousel();
}

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
    clearInterval(carouselInterval);
});

// Close modal when clicking outside content
window.addEventListener('click', (e) => {
    const modal = document.getElementById('imageModal');
    if (e.target === modal) {
        modal.style.display = 'none';
        clearInterval(carouselInterval);
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