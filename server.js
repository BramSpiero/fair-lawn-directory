require('dotenv').config();
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_DATABASE:', process.env.DB_DATABASE);
console.log('DB_USER:', process.env.DB_USER);
const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const BusinessScraper = require('./routes/scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('✓ Database connected successfully');
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Scraper will be initialized with municipality in the scrape route
// (no global scraper instance needed)

// ==================== PUBLIC ROUTES ====================

// Homepage - show all approved businesses with optional search and filters
app.get('/', async (req, res) => {
  try {
    const searchQuery = req.query.search || '';
    const categoryFilter = req.query.category || '';
    const minRating = req.query.rating || '';
    const priceLevel = req.query.price || '';
    
    let query = "SELECT * FROM businesses WHERE status = 'approved'";
    let params = [];
    let paramCount = 0;
    
    // Search filter
    if (searchQuery) {
      paramCount++;
      query += ` AND (
        name ILIKE $${paramCount} OR 
        description ILIKE $${paramCount} OR 
        category ILIKE $${paramCount} OR 
        subcategory ILIKE $${paramCount} OR
        $${paramCount + 1} = ANY(keywords)
      )`;
      params.push(`%${searchQuery}%`, searchQuery);
      paramCount++;
    }
    
    // Category filter
    if (categoryFilter) {
      paramCount++;
      query += ` AND category = $${paramCount}`;
      params.push(categoryFilter);
    }
    
    // Rating filter
    if (minRating) {
      paramCount++;
      query += ` AND rating >= $${paramCount}`;
      params.push(parseFloat(minRating));
    }
    
    // Price level filter
    if (priceLevel) {
      paramCount++;
      query += ` AND price_level = $${paramCount}`;
      params.push(parseInt(priceLevel));
    }
    
    // Sorting
const sortBy = req.query.sort || 'name';
const sortOptions = {
  'name': 'name ASC',
  'rating': 'rating DESC NULLS LAST',
  'reviews': 'total_ratings DESC',
  'newest': 'scraped_at DESC'
};

query += ` ORDER BY ${sortOptions[sortBy] || 'name ASC'}`;

// Get total count first (for pagination) - build separate count query
let countQuery = "SELECT COUNT(*) FROM businesses WHERE status = 'approved'";
// Add same filters as main query
if (searchQuery) {
  countQuery += ` AND (name ILIKE $1 OR description ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1 OR $2 = ANY(keywords))`;
}
if (categoryFilter) {
  const paramNum = paramCount;
  countQuery += ` AND category = $${paramNum}`;
}
if (minRating) {
  const paramNum = paramCount - (priceLevel ? 1 : 0);
  countQuery += ` AND rating >= $${paramNum}`;
}
if (priceLevel) {
  countQuery += ` AND price_level = $${paramCount}`;
}
const countResult = await pool.query(countQuery, params);
const totalBusinesses = parseInt(countResult.rows[0].count);
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const perPage = 24;
    const totalPages = Math.ceil(totalBusinesses / perPage);
    const offset = (page - 1) * perPage;
    
    query += ` LIMIT ${perPage} OFFSET ${offset}`;
    
    const result = await pool.query(query, params);
    
    // Get unique categories for filter dropdown
    const categoriesResult = await pool.query(
      "SELECT DISTINCT category FROM businesses WHERE status = 'approved' ORDER BY category"
    );
    
   res.render('index', { 
      businesses: result.rows,
      categories: categoriesResult.rows,
      searchQuery: searchQuery,
      categoryFilter: categoryFilter,
      minRating: minRating,
      priceLevel: priceLevel,
      sortBy: sortBy,
      currentPage: page,
      totalPages: totalPages,
      totalBusinesses: totalBusinesses
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});
// Categories overview page
app.get('/categories', async (req, res) => {
  try {
    // Get all categories with business counts
    const result = await pool.query(
      `SELECT category, COUNT(*) as business_count 
       FROM businesses 
       WHERE status = 'approved' 
       GROUP BY category 
       ORDER BY category`
    );
    
    res.render('categories', { categories: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Individual business page
app.get('/business/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM businesses WHERE slug = $1 AND status = 'approved'",
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).send('Business not found');
    }
    res.render('business', { business: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Category page with sort
app.get('/category/:category', async (req, res) => {
  try {
    const sortBy = req.query.sort || 'name';
    const sortOptions = {
      'name': 'name ASC',
      'rating': 'rating DESC NULLS LAST',
      'reviews': 'total_ratings DESC',
      'newest': 'scraped_at DESC'
    };
    
    const orderBy = sortOptions[sortBy] || 'name ASC';
    
    const result = await pool.query(
      `SELECT * FROM businesses WHERE category = $1 AND status = 'approved' ORDER BY ${orderBy}`,
      [req.params.category]
    );
    res.render('category', { 
      category: req.params.category, 
      businesses: result.rows,
      sortBy: sortBy
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ==================== ADMIN ROUTES ====================

// Admin login
app.get('/admin', (req, res) => {
  res.render('admin/login');
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === 'admin123') {
    req.session.isAdmin = true;
    res.redirect('/admin/dashboard');
  } else {
    res.render('admin/login', { error: 'Invalid password' });
  }
});

// Admin dashboard - show all businesses
app.get('/admin/dashboard', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/admin');
  }
  
  try {
    const pending = await pool.query(
      "SELECT * FROM businesses WHERE status = 'pending' ORDER BY scraped_at DESC"
    );
    const approved = await pool.query(
      "SELECT * FROM businesses WHERE status = 'approved' ORDER BY name"
    );
    
    res.render('admin/dashboard', { 
      pendingBusinesses: pending.rows,
      approvedBusinesses: approved.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Run scraper
app.get('/admin/scrape', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/admin');
  }
  res.render('admin/scrape');
});

app.post('/admin/scrape', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/admin');
  }

  const { businessTypes } = req.body;
  const types = businessTypes.split(',').map(t => t.trim());

  try {
    // Fetch municipality from database (for now, hardcoded to Fair Lawn ID = 1)
    const municipalityResult = await pool.query(
      'SELECT id, name, state FROM municipalities WHERE id = $1',
      [1] // Fair Lawn
    );
    
    if (municipalityResult.rows.length === 0) {
      return res.status(500).send('Municipality not found in database');
    }
    
    const municipality = municipalityResult.rows[0];
    console.log(`\n🏙️  Scraping for: ${municipality.name}, ${municipality.state}`);
    
    // Initialize scraper with municipality config
    const scraper = new BusinessScraper(
      process.env.GOOGLE_PLACES_API_KEY,
      { name: municipality.name, state: municipality.state }
    );
    
    console.log('\n🚀 Starting scrape...');
    const businesses = await scraper.scrapeBusinessesByTypes(types, 20, pool);

    console.log(`\n💾 Saving ${businesses.length} businesses to database...`);
    
    let saved = 0;
    let skipped = 0;

    for (const business of businesses) {
      try {
        await pool.query(
          `INSERT INTO businesses (
            google_place_id, name, slug, category, subcategory, description,
            street, city, state, zip, phone, website, google_maps_url,
            latitude, longitude, rating, total_ratings, price_level,
            opening_hours, keywords, status, scraped_at, municipality_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
          [
            business.google_place_id, business.name, business.slug,
            business.category, business.subcategory, business.description,
            business.street, business.city, business.state, business.zip,
            business.phone, business.website, business.google_maps_url,
            business.latitude, business.longitude, business.rating,
            business.total_ratings, business.price_level,
            JSON.stringify(business.opening_hours), business.keywords,
            business.status, business.scraped_at, municipality.id
          ]
        );
        saved++;
      } catch (err) {
        console.error(`Error saving ${business.name}:`, err.message);
        skipped++;
      }
    }

    console.log(`\n✅ Complete! Saved: ${saved}, Skipped: ${skipped}`);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).send('Scraping failed: ' + err.message);
  }
});

// Review/edit business
app.get('/admin/business/:id/review', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/admin');
  }
  
  try {
    const result = await pool.query('SELECT * FROM businesses WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Business not found');
    }
    res.render('admin/review', { business: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Approve business
app.post('/admin/business/:id/approve', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/admin');
  }
  
  try {
    await pool.query(
      "UPDATE businesses SET status = 'approved', reviewed_at = NOW() WHERE id = $1",
      [req.params.id]
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});
// Bulk approve businesses
app.post('/admin/businesses/bulk-approve', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const { ids } = req.body;
  
  try {
    await pool.query(
      "UPDATE businesses SET status = 'approved', reviewed_at = NOW() WHERE id = ANY($1)",
      [ids]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk delete businesses
app.post('/admin/businesses/bulk-delete', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const { ids } = req.body;
  
  try {
    await pool.query('DELETE FROM businesses WHERE id = ANY($1)', [ids]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// Update business
app.post('/admin/business/:id/update', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/admin');
  }

  const { name, description, phone, website, status } = req.body;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  try {
    await pool.query(
      `UPDATE businesses SET 
        name = $1, slug = $2, description = $3, phone = $4, 
        website = $5, status = $6, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $7`,
      [name, slug, description, phone, website, status, req.params.id]
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Delete business
app.post('/admin/business/:id/delete', async (req, res) => {
  if (!req.session.isAdmin) {
    return res.redirect('/admin');
  }
  
  try {
    await pool.query('DELETE FROM businesses WHERE id = $1', [req.params.id]);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// Logout
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin');
});

// Start server
app.listen(PORT, () => {
  console.log(`✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Admin panel: http://localhost:${PORT}/admin`);
});