require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

async function generateSitemap() {
  try {
   const baseUrl = process.env.BASE_URL || 'https://bestfairlawn.com';
    
    // Start sitemap
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    // Homepage
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/</loc>\n`;
    sitemap += '    <changefreq>daily</changefreq>\n';
    sitemap += '    <priority>1.0</priority>\n';
    sitemap += '  </url>\n';
    
    // Categories page
    sitemap += '  <url>\n';
    sitemap += `    <loc>${baseUrl}/categories</loc>\n`;
    sitemap += '    <changefreq>weekly</changefreq>\n';
    sitemap += '    <priority>0.9</priority>\n';
    sitemap += '  </url>\n';
    
    // Get all categories
    const categoriesResult = await pool.query(
      "SELECT DISTINCT category FROM businesses WHERE status = 'approved'"
    );
    
    for (const cat of categoriesResult.rows) {
      sitemap += '  <url>\n';
      sitemap += `    <loc>${baseUrl}/category/${encodeURIComponent(cat.category)}</loc>\n`;
      sitemap += '    <changefreq>weekly</changefreq>\n';
      sitemap += '    <priority>0.8</priority>\n';
      sitemap += '  </url>\n';
    }
    
    // Get all approved businesses
    const businessesResult = await pool.query(
      "SELECT slug, updated_at FROM businesses WHERE status = 'approved' ORDER BY slug"
    );
    
    for (const business of businessesResult.rows) {
      const lastmod = business.updated_at ? new Date(business.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      sitemap += '  <url>\n';
      sitemap += `    <loc>${baseUrl}/business/${business.slug}</loc>\n`;
      sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
      sitemap += '    <changefreq>monthly</changefreq>\n';
      sitemap += '    <priority>0.7</priority>\n';
      sitemap += '  </url>\n';
    }
    
    // Close sitemap
    sitemap += '</urlset>';
    
    // Write to public directory
    fs.writeFileSync('./public/sitemap.xml', sitemap);
    
    console.log('✅ Sitemap generated successfully!');
    console.log(`   Homepage: 1 URL`);
    console.log(`   Categories: ${categoriesResult.rows.length + 1} URLs`);
    console.log(`   Businesses: ${businessesResult.rows.length} URLs`);
    console.log(`   Total: ${businessesResult.rows.length + categoriesResult.rows.length + 2} URLs`);
    console.log('\n📍 Sitemap saved to: ./public/sitemap.xml');
    console.log('🌐 Accessible at: http://localhost:3000/sitemap.xml');
    
    process.exit(0);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    process.exit(1);
  }
}

generateSitemap();