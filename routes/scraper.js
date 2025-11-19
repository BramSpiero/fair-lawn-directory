const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

class BusinessScraper {
  constructor(googleApiKey) {
    this.googleApiKey = googleApiKey;
  }

  // Search for businesses by type in Fair Lawn
  async searchBusinesses(businessType, maxResults = 20) {
    try {
      const response = await axios.post(
        'https://places.googleapis.com/v1/places:searchText',
        {
          textQuery: `${businessType} in Fair Lawn, NJ`,
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
          content: `Write a friendly, SEO-optimized 150-word description for ${businessName}, a ${businessType} located at ${address} in Fair Lawn, New Jersey. Focus on what makes them valuable to the local community. Use natural language and include keywords like "Fair Lawn" and "${businessType}". Write in third person.`
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
          content: `Generate 8 SEO keywords for ${businessName}, a ${businessType} in Fair Lawn, NJ. Return only comma-separated keywords that locals might search for. Include variations with "Fair Lawn", "near me", and service-specific terms.`
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
  async processBusiness(place) {
    const name = place.displayName?.text || 'Unknown';
    const businessType = place.primaryType?.replace(/_/g, ' ') || 'business';
    const address = place.formattedAddress || '';

    console.log(`  Processing: ${name}...`);

    // Generate AI content
    const description = await this.generateDescription(name, businessType, address);
    const keywords = await this.generateKeywords(name, businessType);

    // Parse address
    const addressParts = address.split(',');
    const street = addressParts[0]?.trim() || '';
    const cityState = addressParts[1]?.trim() || 'Fair Lawn, NJ';
    const zip = addressParts[2]?.trim() || '';

    return {
      google_place_id: place.id,
      name: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      category: this.categorizeType(place.primaryType),
      subcategory: businessType,
      description: description,
      street: street,
      city: 'Fair Lawn',
      state: 'NJ',
      zip: zip,
      phone: place.nationalPhoneNumber || null,
      website: place.websiteUri || null,
      google_maps_url: place.googleMapsUri || null,
      latitude: place.location?.latitude || null,
      longitude: place.location?.longitude || null,
      rating: place.rating || null,
      total_ratings: place.userRatingCount || 0,
      price_level: place.priceLevel || null,
      opening_hours: place.regularOpeningHours || null,
      keywords: keywords,
      status: 'pending',
      scraped_at: new Date()
    };
  }

  // Categorize business types into main categories
  categorizeType(type) {
    const categories = {
      'plumber': 'Services',
      'electrician': 'Services',
      'general_contractor': 'Services',
      'roofing_contractor': 'Services',
      'hvac_contractor': 'Services',
      'painter': 'Services',
      'carpenter': 'Services',
      'handyman': 'Services',
      'locksmith': 'Services',
      'moving_company': 'Services',
      'cleaning_service': 'Services',
      'landscaper': 'Services',
      'tree_service': 'Services'
    };

    return categories[type] || 'Services';
  }

  // Main scraping function
  async scrapeBusinessesByTypes(businessTypes, maxPerType = 20) {
    const allBusinesses = [];

    for (const type of businessTypes) {
      console.log(`\n🔍 Searching for: ${type}...`);
      const places = await this.searchBusinesses(type, maxPerType);

      for (const place of places) {
        const business = await this.processBusiness(place);
        allBusinesses.push(business);
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return allBusinesses;
  }
}

module.exports = BusinessScraper;