exports.getDashboardData = async (req, res) => {
    try {
      const userId = req.user.id; // Extracted from the authMiddleware
      
      // Mock dashboard data - replace with real logic
      const dashboardData = {
        message: `Welcome, User ${userId}!`,
        stats: {
          orders: 34,
          revenue: 1234.56,
          storesConnected: 5,
        },
      };
  
      res.status(200).json(dashboardData);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  };
  