const path = require('path');
const fs = require('fs');

const uploadFile = async (req, res) => {
  try {
    if (!req.files || !req.files.image) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const image = req.files.image;
    const uploadDir = path.join(__dirname, '../../uploads');

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `${Date.now()}-${image.name}`;
    const uploadPath = path.join(uploadDir, filename);

    await image.mv(uploadPath);

    res.json({
      success: true,
      message: "File uploaded successfully",
      filePath: `/uploads/${filename}`
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to upload file" 
    });
  }
};

module.exports = { uploadFile };