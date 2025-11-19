require('dotenv').config();
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function generateDescription(businessName, businessType, address) {
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
    console.error('Error generating description:', error.message);
    return null;
  }
}

async function generateKeywords(businessName, businessType) {
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

async function regenerateAll() {
  try {
    console.log('🚀 Starting AI content generation...\n');
    
    // Get all businesses without descriptions
    const result = await pool.query(
      'SELECT * FROM businesses WHERE description IS NULL OR description = \'\' ORDER BY id'
    );
    
    const businesses = result.rows;
    console.log(`Found ${businesses.length} businesses needing descriptions\n`);
    
    let count = 0;
    for (const business of businesses) {
      count++;
      console.log(`[${count}/${businesses.length}] Processing: ${business.name}...`);
      
      const description = await generateDescription(
        business.name,
        business.subcategory || business.category,
        business.street
      );
      
      const keywords = await generateKeywords(
        business.name,
        business.subcategory || business.category
      );
      
      if (description) {
        await pool.query(
          'UPDATE businesses SET description = $1, keywords = $2, updated_at = NOW() WHERE id = $3',
          [description, keywords, business.id]
        );
        console.log(`  ✓ Updated with AI content\n`);
      } else {
        console.log(`  ✗ Failed to generate\n`);
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`\n✅ Complete! Generated content for ${count} businesses`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

regenerateAll();

