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

function createListingElement(listing) {
    const div = document.createElement('div');
    div.className = 'listing';
    
    div.innerHTML = `
        <div class="listing-header">
            <h2 class="listing-address">${listing.address}</h2>
            <div class="listing-location">${listing.location}</div>
            <div class="listing-price">${listing.price}</div>
            <div class="listing-status">${listing.status}</div>
            <div class="listing-type">${listing.propertyType}</div>
        </div>
        
        <div class="listing-slider">
            <div class="swiper">
                <div class="swiper-wrapper">
                    ${listing.images.size2.map(img => `
                        <div class="swiper-slide">
                            <img src="${img}" alt="Property image">
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        
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
    div.querySelector('.listing-slider').addEventListener('click', () => showPopup(listing));
    return div;
}

function showPopup(listing) {
    const modal = document.getElementById('imageModal');
    const sliderContainer = modal.querySelector('.popup-slider');
    const mapContainer = modal.querySelector('.map-container');
    const detailsPanel = modal.querySelector('#detail-content');

    // Initialize Popup Slider
    sliderContainer.innerHTML = `
        <div class="swiper-wrapper">
            ${listing.images.size3.map(img => `
                <div class="swiper-slide">
                    <img src="${img}" alt="Property image">
                </div>
            `).join('')}
        </div>
        <div class="swiper-pagination"></div>
        <div class="swiper-button-prev"></div>
        <div class="swiper-button-next"></div>
    `;

    if (popupSwiper) popupSwiper.destroy();
    popupSwiper = new Swiper(sliderContainer, {
        loop: true,
        navigation: {
            nextEl: '.swiper-button-next',
            prevEl: '.swiper-button-prev',
        },
        pagination: {
            el: '.swiper-pagination',
            clickable: true,
        },
        autoplay: {
            delay: 5000,
        },
    });

    // Add Map Data
    mapContainer.innerHTML = listing.mapData.mapSectionHTML || `
        <div class="map-placeholder">
            <p>Map preview not available</p>
        </div>
    `;
    
    // Add Details
    detailsPanel.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item-large">
                <span class="detail-label-large">Address</span>
                <p class="detail-value-large">${listing.address}</p>
            </div>
            <div class="detail-item-large">
                <span class="detail-label-large">Location</span>
                <p class="detail-value-large">${listing.location}</p>
            </div>
            <div class="detail-item-large">
                <span class="detail-label-large">Price</span>
                <p class="detail-value-large">${listing.price}</p>
            </div>
            <div class="detail-item-large">
                <span class="detail-label-large">Status</span>
                <p class="detail-value-large">${listing.status}</p>
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
        
        <div class="detail-item-large">
            <span class="detail-label-large">Description</span>
            <p class="description-text">${listing.description}</p>
        </div>
    `;

    modal.style.display = 'block';
}

// Close Modal
document.querySelector('.close-btn').addEventListener('click', () => {
    document.getElementById('imageModal').style.display = 'none';
    if (popupSwiper) popupSwiper.destroy();
});

// Close modal when clicking outside content
window.addEventListener('click', (e) => {
    const modal = document.getElementById('imageModal');
    if (e.target === modal) {
        modal.style.display = 'none';
        if (popupSwiper) popupSwiper.destroy();
    }
});

// Real-time listener
database.ref('final_listings').on('value', (snapshot) => {
    const listings = snapshot.val() || {};
    const sortedListings = Object.values(listings).sort((a, b) => a.position - b.position);
    
    listingsContainer.innerHTML = '';
    sortedListings.forEach(listing => {
        const element = createListingElement(listing);
        const swiper = new Swiper(element.querySelector('.swiper'), {
            slidesPerView: 1,
            spaceBetween: 10,
            autoplay: {
                delay: 4000,
            },
        });
        listingsContainer.appendChild(element);
    });
});