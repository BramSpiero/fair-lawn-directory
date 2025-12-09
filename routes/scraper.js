const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

class BusinessScraper {
  constructor(googleApiKey, municipality = { name: 'Fair Lawn', state: 'NJ' }) {
    this.googleApiKey = googleApiKey;
    this.municipality = municipality;
  }

  // Convert Google's price level strings to integers
  convertPriceLevel(priceLevel) {
    const priceLevelMap = {
      'PRICE_LEVEL_FREE': 0,
      'PRICE_LEVEL_INEXPENSIVE': 1,
      'PRICE_LEVEL_MODERATE': 2,
      'PRICE_LEVEL_EXPENSIVE': 3,
      'PRICE_LEVEL_VERY_EXPENSIVE': 4
    };
    
    return priceLevelMap[priceLevel] || null;
  }
// Validate that business is actually in the target municipality
  validateLocation(formattedAddress) {
    // Parse the address - Google format is typically: "Street, City State ZIP, Country"
    const addressParts = formattedAddress.split(',').map(part => part.trim());
    
    // The city is typically in the second part (index 1)
    // Example: "123 Main St, Fair Lawn, NJ 07410, USA"
    const cityStatePart = addressParts[1] || '';
    
    // Check if the city matches our target municipality
    const cityMatch = cityStatePart.toLowerCase().includes(this.municipality.name.toLowerCase());
    
    return {
      isValid: cityMatch,
      detectedCity: cityStatePart,
      reason: cityMatch ? null : `Business located in ${cityStatePart}, not ${this.municipality.name}`
    };
  }
  // Check if business already exists in database
  async checkDuplicate(googlePlaceId, pool) {
    if (!pool) return false; // No database connection provided
    
    try {
      const result = await pool.query(
        'SELECT id FROM businesses WHERE google_place_id = $1',
        [googlePlaceId]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('Error checking duplicate:', error.message);
      return false;
    }
  }
  // Search for businesses by type in Fair Lawn
  async searchBusinesses(businessType, maxResults = 20) {
    try {
      const response = await axios.post(
        'https://places.googleapis.com/v1/places:searchText',
        {
          textQuery: `${businessType} in ${this.municipality.name}, ${this.municipality.state}`,
          maxResultCount: maxResults
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.googleApiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri,places.primaryType,places.types'
          }
        }
      );

      console.log(`✓ Found ${response.data.places?.length || 0} businesses for "${businessType}"`);
      return response.data.places || [];
    } catch (error) {
      console.error('Error searching businesses:', error.response?.data || error.message);
      return [];
    }
  }

  // Get photo URL for a place
  async getPhotoUrl(photoName) {
    if (!photoName) return null;
    
    try {
      const response = await axios.get(
        `https://places.googleapis.com/v1/${photoName}/media`,
        {
          headers: {
            'X-Goog-Api-Key': this.googleApiKey
          },
          params: {
            maxWidthPx: 800,
            maxHeightPx: 600
          }
        }
      );
      return response.request.res.responseUrl;
    } catch (error) {
      console.error('Error getting photo:', error.message);
      return null;
    }
  }

  // Generate AI description using Claude
  async generateDescription(businessName, businessType, address) {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a friendly, SEO-optimized 150-word description for ${businessName}, a ${businessType} located at ${address} in ${this.municipality.name}, ${this.municipality.state}. Focus on what makes them valuable to the local community. Use natural language and include keywords like "${this.municipality.name}" and "${businessType}". Write in third person.`
        }]
      });

      return message.content[0].text;
    } catch (error) {
      console.error('Error generating AI description:', error.message);
      return null;
    }
  }

  // Generate SEO keywords
  async generateKeywords(businessName, businessType) {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `Generate 8 SEO keywords for ${businessName}, a ${businessType} in ${this.municipality.name}, ${this.municipality.state}. Return only comma-separated keywords that locals might search for. Include variations with "${this.municipality.name}", "near me", and service-specific terms.`
        }]
      });

      const keywordsText = message.content[0].text;
      return keywordsText.split(',').map(k => k.trim());
    } catch (error) {
      console.error('Error generating keywords:', error.message);
      return [];
    }
  }

  // Process a single business and enrich with AI
  async processBusiness(place, pool = null) {
    const name = place.displayName?.text || 'Unknown';
    const businessType = place.primaryType?.replace(/_/g, ' ') || 'business';
   const address = place.formattedAddress || '';
const googlePlaceId = place.id;

console.log(`  Processing: ${name}...`);

// Check for duplicates FIRST (before expensive operations)
const isDuplicate = await this.checkDuplicate(googlePlaceId, pool);
if (isDuplicate) {
  console.log(`  ⏭️  Skipped: ${name} - Already exists in database`);
  return null;
}

// Validate location BEFORE doing expensive AI work
const locationCheck = this.validateLocation(address);
if (!locationCheck.isValid) {
  console.log(`  ❌ Skipped: ${name} - ${locationCheck.reason}`);
  return null; // Skip this business
}

// Generate AI content
    const description = await this.generateDescription(name, businessType, address);
    const keywords = await this.generateKeywords(name, businessType);

    // Parse address
    const addressParts = address.split(',');
    const street = addressParts[0]?.trim() || '';
    const cityState = addressParts[1]?.trim() || `${this.municipality.name}, ${this.municipality.state}`;
    const zip = addressParts[2]?.trim() || '';

    return {
      google_place_id: place.id,
      name: name.substring(0, 255),
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${place.id.substring(0, 8)}`,
      category: this.categorizeType(place.primaryType),
      subcategory: businessType,
      description: description,
      street: street,
      city: this.municipality.name,
      state: this.municipality.state.substring(0, 20),
      zip: zip.substring(0, 10),
      phone: place.nationalPhoneNumber || null,
      website: place.websiteUri || null,
      google_maps_url: place.googleMapsUri || null,
      latitude: place.location?.latitude || null,
      longitude: place.location?.longitude || null,
      rating: place.rating || null,
      total_ratings: place.userRatingCount || 0,
      price_level: this.convertPriceLevel(place.priceLevel),
      opening_hours: place.regularOpeningHours || null,
      keywords: keywords,
      status: 'pending',
      scraped_at: new Date()
    };
  }

  // Categorize business types into main categories
  categorizeType(type) {
    const categoryMap = {
      // Home Services
      'plumber': 'Home Services',
      'electrician': 'Home Services',
      'roofing_contractor': 'Home Services',
      'painter': 'Home Services',
      'general_contractor': 'Home Services',
      'locksmith': 'Home Services',
      'moving_company': 'Home Services',
      
      // Food & Dining
      'restaurant': 'Food & Dining',
      'cafe': 'Food & Dining',
      'bakery': 'Food & Dining',
      'pizza_restaurant': 'Food & Dining',
      'bar': 'Food & Dining',
      'meal_delivery': 'Food & Dining',
      'meal_takeaway': 'Food & Dining',
      
      // Healthcare
      'doctor': 'Healthcare',
      'dentist': 'Healthcare',
      'pharmacy': 'Healthcare',
      'physiotherapist': 'Healthcare',
      'veterinary_care': 'Healthcare',
      
      // Personal Care
      'hair_care': 'Personal Care',
      'beauty_salon': 'Personal Care',
      'spa': 'Personal Care',
      'gym': 'Personal Care',
      'laundry': 'Personal Care',
      
      // Retail
      'supermarket': 'Retail',
      'convenience_store': 'Retail',
      'hardware_store': 'Retail',
      'clothing_store': 'Retail',
      'shoe_store': 'Retail',
      'florist': 'Retail',
      'jewelry_store': 'Retail',
      
      // Professional Services
      'lawyer': 'Professional Services',
      'accounting': 'Professional Services',
      'insurance_agency': 'Professional Services',
      'real_estate_agency': 'Professional Services',
      
      // Automotive
      'car_repair': 'Automotive',
      'car_wash': 'Automotive',
      'car_dealer': 'Automotive',
      'gas_station': 'Automotive',
      
      // Other
      'bank': 'Financial',
      'atm': 'Financial',
      'lodging': 'Hospitality',
      'school': 'Education',
      'library': 'Education'
    };

    return categoryMap[type] || 'Services';
  }

  // Main scraping function
  async scrapeBusinessesByTypes(businessTypes, maxPerType = 20, pool = null) {
    const allBusinesses = [];

    for (const type of businessTypes) {
      console.log(`\n🔍 Searching for: ${type}...`);
      const places = await this.searchBusinesses(type, maxPerType);

     for (const place of places) {
  const business = await this.processBusiness(place, pool);
  
  // Only add if business passed validation (not null)
  if (business !== null) {
    allBusinesses.push(business);
  }
  
  // Small delay to avoid rate limits
  await new Promise(resolve => setTimeout(resolve, 500));
}
    }

    return allBusinesses;
  }
}

module.exports = BusinessScraper;