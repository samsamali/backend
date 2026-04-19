const bcrypt = require('bcryptjs');
const UpdatePasswordUser = require('../models/UpdatePasswordUser');
const User = require('../models/User');

exports.updatePassword = async (req, res) => {
  try {
    const { userId, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Update original User password
    await User.findByIdAndUpdate(userId, { password: hashedPassword });

    // Save updated password in UpdatePasswordUser collection
    const updateEntry = new UpdatePasswordUser({
      userId,
      newPassword: hashedPassword
    });

    await updateEntry.save();

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
