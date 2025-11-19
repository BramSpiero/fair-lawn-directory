require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const BusinessScraper = require('./routes/scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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

// Initialize scraper
const scraper = new BusinessScraper(process.env.GOOGLE_PLACES_API_KEY);

// ==================== PUBLIC ROUTES ====================

// Homepage - show all approved businesses
app.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM businesses WHERE status = 'approved' ORDER BY name"
    );
    res.render('index', { businesses: result.rows });
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

// Category page
app.get('/category/:category', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM businesses WHERE category = $1 AND status = 'approved' ORDER BY name",
      [req.params.category]
    );
    res.render('category', { 
      category: req.params.category, 
      businesses: result.rows 
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
    console.log('\n🚀 Starting scrape...');
    const businesses = await scraper.scrapeBusinessesByTypes(types, 20);

    console.log(`\n💾 Saving ${businesses.length} businesses to database...`);
    
    let saved = 0;
    let skipped = 0;

    for (const business of businesses) {
      try {
        // Check if already exists
        const existing = await pool.query(
          'SELECT id FROM businesses WHERE google_place_id = $1',
          [business.google_place_id]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO businesses (
              google_place_id, name, slug, category, subcategory, description,
              street, city, state, zip, phone, website, google_maps_url,
              latitude, longitude, rating, total_ratings, price_level,
              opening_hours, keywords, status, scraped_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
            [
              business.google_place_id, business.name, business.slug,
              business.category, business.subcategory, business.description,
              business.street, business.city, business.state, business.zip,
              business.phone, business.website, business.google_maps_url,
              business.latitude, business.longitude, business.rating,
              business.total_ratings, business.price_level,
              JSON.stringify(business.opening_hours), business.keywords,
              business.status, business.scraped_at
            ]
          );
          saved++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Error saving ${business.name}:`, err.message);
      }
    }

    console.log(`\n✅ Complete! Saved: ${saved}, Skipped (duplicates): ${skipped}`);
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