const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fileUpload = require('express-fileupload'); // Add this line
const { scheduleSellviaOrderSyncJob } = require('./modules/admin/jobs/sellviaOrderSyncJob');

// Import routes Of All Backend Modules
const auth = require('./modules/auth/routes/auth');
const companyRoutes = require('./modules/company/routes/companyRoutes');
const productRoutes = require('./modules/product/routes/productRoutes');
const roleRoutes = require('./modules/role/routes/roleRoutes');
const subscriptionRoutes = require('./modules/subscription/routes/subscriptionRoutes');
const dashboardRoutes = require('./modules/dashboard/routes/dashboard');
const userRoutes = require("./modules/user/userRoutes");
const uploadRoutes = require('./modules/auth/routes/uploadRoutes');
const updatePasswordRoutes = require('./modules/auth/routes/updatePasswordRoutes');
const adminRoutes = require('./modules/admin/routes/adminRoutes');
const ebayRoutes = require("./modules/eBay/routes/ebayRoutes");
const sellviaRoutes = require('../backend/modules/admin/routes/sellviaRoutes');
const companyStoreRoutes = require('./modules/admin/routes/companyStoreRoutes');
const wordpressRoutes   = require('./modules/wordpress/routes/wordpressRoutes');
// const dns = require('dns');
// // Force reliable DNS servers (Cloudflare and Google)
// dns.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4']);

// Load environment variables
dotenv.config();

const app = express();

// Middleware setup
app.use(express.json()); // For parsing JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload()); // Add this for file uploads
// app.use('/uploads', express.static(path.join(__dirname, 'modules', 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'modules', 'uploads'), {
    setHeaders: (res) => {
      res.header('Access-Control-Allow-Origin', '*');
    }
  }));


// CORS configuration
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const allowedOrigins = [frontendUrl];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);



// Register routes (Backend API Routes)
app.use('/api/auth', auth);
app.use('/api/companies', companyRoutes);
app.use('/api/products', productRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/user', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/auth', updatePasswordRoutes);
app.use('/api/admin', adminRoutes);
app.use("/api/ebay", ebayRoutes);
app.use('/api/sellvia', sellviaRoutes);
app.use('/api/company-stores', companyStoreRoutes);
app.use('/api/wordpress', wordpressRoutes);


// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('MongoDB connected'))
.catch(err => console.log('MongoDB connection error:', err));

// Handle MongoDB connection errors
mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
});

// Schedule background jobs
scheduleSellviaOrderSyncJob();

// Error-handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Internal Server Error' });
});

// Start the server on a fixed port so frontend/backed stay aligned.
const PORT = Number(process.env.PORT) || 5001;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the previous backend instance and restart.`
    );
    return process.exit(1);
  }

  console.error('Failed to start server:', err.message);
  process.exit(1);
});