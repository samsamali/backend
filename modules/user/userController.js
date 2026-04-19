const User = require("../auth/models/User");
const UpdatedUserProfile = require("../auth/models/UpdatedUserProfile");
const UserSubscription = require("../subscription/models/UserSubscription");

const getTrialInfo = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user has an active subscription
    const activeSubscription = await UserSubscription.findOne({
      userId: userId,
      endDate: { $gte: new Date() }, // Subscription still valid
    });

    if (activeSubscription) {

      return res.status(200).json({
        isSubscribed: true,
        subscriptionEndDate: activeSubscription.endDate,
        daysRemaining: Math.ceil(
          (activeSubscription.endDate - new Date()) / (1000 * 60 * 60 * 24)
        ),
      });
    }

    // If no active subscription, check trial
    if (!user.trialStartDate) {
      return res.status(404).json({ message: "Trial information not found" });
    }

    const trialStartDate = user.trialStartDate;
    const currentDate = new Date();
    const daysRemaining = Math.floor(
      (trialStartDate.getTime() +
        14 * 24 * 60 * 60 * 1000 -
        currentDate.getTime()) /
        (24 * 60 * 60 * 1000)
    );

    return res.status(200).json({
      isSubscribed: false,
      trialStartDate: user.trialStartDate,
      daysRemaining,
    });
  } catch (error) {
    console.error("Error fetching trial info:", error);
    res.status(500).json({ message: "Server error" });
  }
};


// Fetch user profile with role and group name
const getUserProfile = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId).select(
      "name email phone street zipcode city state country profilePicture role group"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (
      user.profilePicture &&
      !user.profilePicture.startsWith("http://") &&
      !user.profilePicture.startsWith("https://")
    ) {
      const host = `${req.protocol}://${req.get("host")}`;
      user.profilePicture = `${host}${user.profilePicture}`;
    }

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      city: user.city,
      state: user.state,
      country: user.country,
      street: user.street,
      zipcode: user.zipcode,
      profilePicture: user.profilePicture,
      role: user.role || null,
      group: user.group || null,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ message: "Server error" });
  }
};


const normalize = (val) => (val === undefined || val === "" ? null : val);

const UpdateUserProfile = async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, phone, city, country, street, state, zipcode } =
      req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    // Prepare normalized update data
    const updateData = {
      name: normalize(name),
      email: normalize(email),
      phone: normalize(phone),
      city: normalize(city),
      country: normalize(country),
      street: normalize(street),
      state: normalize(state),
      zipcode: normalize(zipcode),
    };

    // Update main user document and include all the fields
    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select("name email phone city country street state zipcode");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Save updated data in audit collection
    await UpdatedUserProfile.create({
      userId,
      ...updateData,
    });

    // Return the updated user data, including all fields
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

const updateProfilePicture = async (req, res) => {
  try {
    const userId = req.params.id;
    const { profilePicture } = req.body;

    if (!profilePicture) {
      return res
        .status(400)
        .json({ message: "Profile picture URL is required" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePicture },
      { new: true }
    ).select("name email profilePicture");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Error updating profile picture:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getTrialInfo,
  getUserProfile,
  UpdateUserProfile,
  updateProfilePicture,
};
