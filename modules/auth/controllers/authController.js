const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendOTPEmail, sendNotRegisteredEmail } = require("../utils/email");
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const Role = require("../../../modules/role/models/Role");
const Group = require("../../../modules/admin/models/Group");
const UserRole = require("../../../modules/role/models/user-roles");
const UserGroup = require("../../../modules/admin/models/user-groups");
const RolePermission = require("../../../modules/role/models/role-permissions");
const ModulePermission = require("../../../modules/admin/models/module-permissions");
const Module = require("../../../modules/admin/models/Module");
const Permission = require("../../../modules/admin/models/Permission");
const UserSubscription = require("../../../modules/subscription/models/UserSubscription");
const GroupPermission = require("../../../modules/admin/models/group-permissions");



// ── Helper: Get allowedStoreIds for a company ────────────────────
const getCompanyStoreIds = async (CompanyStore, companyId) => {
    if (!companyId) return [];
    try {
        const stores = await CompanyStore.find({ companyId, isActive: true }).lean();
        return stores.map(s => s.store_id);
    } catch (e) {
        console.warn('[getCompanyStoreIds] error:', e.message);
        return [];
    }
};

// ===================== SIGNUP =====================
exports.signup = async (req, res) => {
  try {
    // ← ADDED companyId to destructuring
    const { name, email, password, subscriptionid, roleid, groupid, companyId } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email, and password are required" });

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ success: false, message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    // 1️⃣ Determine role
    let role;
    if (roleid) {
      role = await Role.findById(roleid);
      if (!role) return res.status(400).json({ success: false, message: "Invalid roleId" });
    } else {
      role = await Role.findOne({ name: "Customer" });
      if (!role) return res.status(500).json({ success: false, message: "Default role 'Customer' not found" });
    }

    const isCustomer = role.name.toLowerCase() === "customer";

    // 2️⃣ Create User
    const userData = {
      name,
      email,
      password: hashedPassword,
      isActive: false,
    };

    if (isCustomer) {
      userData.trialStartDate = new Date();
      userData.trialEndDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    }

    const newUser = await User.create(userData);

    // 3️⃣ Assign role
    await UserRole.create({ userId: newUser._id, roleId: role._id, roleName: role.name });

    let userSubscription = null;
    let groupInfo = null;
    let groupPermissions = [];
    let userModules = [];

    // =============================================
    // CUSTOMER ROLE — unchanged logic
    // =============================================
    if (isCustomer) {
      if (subscriptionid) {
        const Subscription = require("../../../modules/subscription/models/Subscription");
        const GroupPlan = require("../../../modules/admin/models/GroupPlan");
        const subscription = await Subscription.findById(subscriptionid);
        if (!subscription)
          return res.status(400).json({ success: false, message: "Invalid subscriptionId" });

        const planGroup = await GroupPlan.findOne({ planId: subscriptionid });
        if (!planGroup)
          return res.status(400).json({ success: false, message: "No group mapped to this subscription plan" });

        await UserGroup.create({
          userId: newUser._id,
          groupId: planGroup.groupId,
          groupName: planGroup.groupName,
        });

        const groupPermDoc = await GroupPermission.findOne({ groupId: planGroup.groupId });
        if (groupPermDoc && Array.isArray(groupPermDoc.permissions)) {
          groupPermissions = groupPermDoc.permissions
            .filter((p) => p.isActive !== false)
            .map((p) => ({ permissionId: p.permissionId, permissionCode: p.permissionCode }));
        }

        groupInfo = {
          groupId: planGroup.groupId,
          groupName: planGroup.groupName,
          permissions: groupPermissions,
        };

        userSubscription = await UserSubscription.create({
          userId: newUser._id,
          subscriptionId: subscription._id,
          startDate: new Date(),
          endDate: new Date(Date.now() + (subscription.durationMonths || 1) * 30 * 24 * 60 * 60 * 1000),
          isTrial: false,
          isActive: true,
        });
      } else {
        let trialGroup = await Group.findOne({ groupName: "Trial Group" });
        if (!trialGroup) {
          trialGroup = await Group.create({
            groupName: "Trial Group",
            description: "Default trial group for new users",
            isActive: true,
          });
        }

        await UserGroup.create({
          userId: newUser._id,
          groupId: trialGroup._id,
          groupName: trialGroup.groupName,
        });

        const groupPermDoc = await GroupPermission.findOne({ groupId: trialGroup._id });
        if (groupPermDoc && Array.isArray(groupPermDoc.permissions)) {
          groupPermissions = groupPermDoc.permissions
            .filter((p) => p.isActive !== false)
            .map((p) => ({ permissionId: p.permissionId, permissionCode: p.permissionCode }));
        }

        groupInfo = {
          groupId: trialGroup._id,
          groupName: trialGroup.groupName,
          permissions: groupPermissions,
        };
      }

      const allModules = await Module.find({ is_active: true }).lean();
      const modulePermissions = await ModulePermission.find({ is_active: true })
        .populate("moduleId")
        .populate("permissionId");

      const modulePermissionsMap = {};
      modulePermissions.forEach((mp) => {
        if (mp && mp.moduleId && mp.permissionId) {
          const moduleId = mp.moduleId._id.toString();
          if (!modulePermissionsMap[moduleId]) modulePermissionsMap[moduleId] = [];
          modulePermissionsMap[moduleId].push({
            _id: mp.permissionId._id,
            name: mp.permissionId.name,
            code: mp.permissionId.code,
          });
        }
      });

      const rolePermissions = await RolePermission.find({
        roleId: role._id,
        is_active: true,
      }).populate({
        path: "modulePermissionId",
        populate: [{ path: "moduleId" }, { path: "permissionId" }],
      });

      const accessibleModuleIds = new Set();
      for (const rp of rolePermissions) {
        const mp = rp.modulePermissionId;
        if (mp && mp.is_active && mp.moduleId && mp.moduleId.is_active) {
          accessibleModuleIds.add(mp.moduleId._id.toString());
        }
      }

      const groupPermissionCodes = groupPermissions.map((p) => p.permissionCode);

      userModules = allModules
        .filter((module) => accessibleModuleIds.has(module._id.toString()))
        .map((module) => {
          const modulePerms = modulePermissionsMap[module._id.toString()] || [];
          const modulePermissionCodes = modulePerms.map((p) => p.code);

          if (groupPermissionCodes.length === 0) {
            return { ...buildModuleBase(module), permissions: [] };
          }
          if (groupPermissionCodes.includes("*")) {
            return { ...buildModuleBase(module), permissions: modulePermissionCodes };
          }
          const userPermissions = modulePermissionCodes.filter((code) =>
            groupPermissionCodes.includes(code)
          );
          return { ...buildModuleBase(module), permissions: userPermissions };
        })
        .filter((m) => m.permissions.length > 0);

    // =============================================
    // NON-CUSTOMER ROLE — role-based only
    // =============================================
    } else {
      const rolePermissions = await RolePermission.find({
        roleId: role._id,
        is_active: true,
      }).populate({
        path: "modulePermissionId",
        populate: [{ path: "moduleId" }, { path: "permissionId" }],
      });

      const modulesMap = {};
      for (const rp of rolePermissions) {
        const mp = rp.modulePermissionId;
        if (!mp || !mp.is_active) continue;
        if (!mp.moduleId || !mp.moduleId.is_active) continue;
        if (!mp.permissionId) continue;

        const moduleId = mp.moduleId._id.toString();
        if (!modulesMap[moduleId]) {
          modulesMap[moduleId] = {
            ...buildModuleBase(mp.moduleId),
            permissions: [],
          };
        }
        if (!modulesMap[moduleId].permissions.includes(mp.permissionId.code)) {
          modulesMap[moduleId].permissions.push(mp.permissionId.code);
        }
      }

      userModules = Object.values(modulesMap).filter((m) => m.permissions.length > 0);
    }

    // ── ✅ NEW: Company Assignment ────────────────────────────────
    // For any non-super-admin user — assign to company if companyId provided
    let userCompanyId   = null;
    let allowedStoreIds = [];

    const isSuperAdminRole = role.name === 'super-admin' || role.name === 'superadmin';

    if (!isSuperAdminRole && companyId) {
        try {
            const CompanyStore = require('../../admin/models/CompanyStore');
            const UserCompany  = require('../../admin/models/UserCompany');
            const Company      = require('../../company/models/Company');

            const company = await Company.findById(companyId);
            if (company) {
                // Upsert UserCompany — one user = one company
                await UserCompany.findOneAndUpdate(
                    { userId: newUser._id },
                    { $set: { companyId: company._id, isActive: true } },
                    { upsert: true, new: true }
                );
                userCompanyId   = company._id;
                allowedStoreIds = await getCompanyStoreIds(CompanyStore, company._id);
                console.log(`[Signup] user=${newUser._id} company=${company._id} stores=${allowedStoreIds.length}`);
            } else {
                console.warn(`[Signup] companyId not found: ${companyId}`);
            }
        } catch (companyErr) {
            console.warn('[Signup] Company assignment error:', companyErr.message);
        }
    }
    // ── END Company Assignment ────────────────────────────────────

    // 4️⃣ Activate user
    newUser.isActive = true;
    await newUser.save();

    // 5️⃣ Generate JWT — ✅ ADDED companyId + allowedStoreIds
    const tokenPayload = {
      userId:          newUser._id,
      role:            role.name,
      modules:         userModules,
      isCustomer,
      companyId:       userCompanyId,   // ← NEW
      allowedStoreIds,                   // ← NEW ([] for super-admin)
    };

    if (isCustomer) {
      tokenPayload.groupId = groupInfo?.groupId || null;
      tokenPayload.permissions = groupPermissions.map((p) => p.permissionCode);
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "1h" });

    // 6️⃣ Build response — ✅ ADDED companyId + allowedStoreIds
    const responseData = {
      success:         true,
      token,
      userId:          newUser._id,
      role:            role.name,
      roleId:          role._id,
      isActive:        newUser.isActive,
      modules:         userModules,
      companyId:       userCompanyId,   // ← NEW
      allowedStoreIds,                   // ← NEW
      message:         "User registered successfully!",
    };

    if (isCustomer) {
      responseData.subscription = userSubscription;
      responseData.group        = groupInfo;
      responseData.permissions  = groupPermissions;
    }

    res.status(201).json(responseData);

  } catch (error) {
    console.error("Signup error:", error.message);
    res.status(500).json({ success: false, message: "Server error during signup", error: error.message });
  }
};

// ── Helper: build base module object ─────────────────────────────
function buildModuleBase(module) {
  return {
    moduleId:    module._id,
    name:        module.name,
    description: module.description,
    route_path:  module.route_path,
    icon:        module.icon,
    parent_id:   module.parent_id,
    is_active:   module.is_active,
    is_category: module.is_category,
    order:       module.order,
    created_at:  module.created_at || module.createdAt,
    updated_at:  module.updated_at || module.updatedAt,
  };
}

// ===================== LOGIN =====================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Find user
    const user = await User.findOne({ email }).select("+password");
    if (!user)
      return res.status(400).json({ success: false, message: "Invalid email or password" });

    // 2. Validate password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid)
      return res.status(400).json({ success: false, message: "Invalid email or password" });

    // 3. Get user role
    const userRoleDoc = await UserRole.findOne({ userId: user._id }).populate("roleId");
    if (!userRoleDoc)
      return res.status(400).json({ success: false, message: "No role assigned to user" });

    // 4. Block customer role from this endpoint
    if (userRoleDoc.roleName.toLowerCase() === "customer") {
      return res.status(403).json({
        success: false,
        message: "Customer role cannot login through this endpoint. Please use customer login.",
      });
    }

    // 5. Get RolePermissions
    const rolePermissions = await RolePermission.find({
      roleId: userRoleDoc.roleId._id,
      is_active: true,
    }).populate({
      path: "modulePermissionId",
      populate: [
        { path: "moduleId" },
        { path: "permissionId" }
      ],
    });

    // 6. Build modules map
    const modulesMap = {};

    for (const rp of rolePermissions) {
      const mp = rp.modulePermissionId;
      if (!mp || !mp.is_active) continue;
      if (!mp.moduleId || !mp.moduleId.is_active) continue;
      if (!mp.permissionId) continue;

      const moduleId = mp.moduleId._id.toString();

      if (!modulesMap[moduleId]) {
        modulesMap[moduleId] = {
          moduleId:    mp.moduleId._id,
          name:        mp.moduleId.name,
          description: mp.moduleId.description,
          route_path:  mp.moduleId.route_path,
          icon:        mp.moduleId.icon,
          parent_id:   mp.moduleId.parent_id,
          is_active:   mp.moduleId.is_active,
          is_category: mp.moduleId.is_category,
          order:       mp.moduleId.order,
          created_at:  mp.moduleId.created_at || mp.moduleId.createdAt,
          updated_at:  mp.moduleId.updated_at || mp.moduleId.updatedAt,
          permissions: [],
        };
      }

      if (!modulesMap[moduleId].permissions.includes(mp.permissionId.code)) {
        modulesMap[moduleId].permissions.push(mp.permissionId.code);
      }
    }

    // 7. Filter modules with permissions
    const userModules = Object.values(modulesMap).filter(
      (m) => m.permissions.length > 0
    );

    // ── ✅ NEW: Company filter for non-super-admin ─────────────────
    let loginCompanyId      = null;
    let loginAllowedStoreIds = [];

    const isSA = userRoleDoc.roleName === 'super-admin' || userRoleDoc.roleName === 'superadmin';

    if (!isSA) {
        try {
            const CompanyStore = require('../../admin/models/CompanyStore');
            const UserCompany  = require('../../admin/models/UserCompany');

            const userComp = await UserCompany.findOne({
                userId:   user._id,
                isActive: true,
            });
            if (userComp) {
                loginCompanyId       = userComp.companyId;
                loginAllowedStoreIds = await getCompanyStoreIds(CompanyStore, userComp.companyId);
                console.log(`[Login] user=${user._id} company=${loginCompanyId} stores=${loginAllowedStoreIds.length}`);
            } else {
                console.log(`[Login] user=${user._id} has no company assigned`);
            }
        } catch (compErr) {
            console.warn('[Login] Company lookup failed:', compErr.message);
        }
    } else {
        console.log(`[Login] super-admin login — no company filter`);
    }
    // ── END Company filter ────────────────────────────────────────

    // 8. Sign JWT — ✅ ADDED companyId + allowedStoreIds
    const token = jwt.sign(
      {
        userId:          user._id,
        role:            userRoleDoc.roleName,
        roleId:          userRoleDoc.roleId._id,
        modules:         userModules,
        isCustomer:      false,
        companyId:       loginCompanyId,        // ← NEW
        allowedStoreIds: loginAllowedStoreIds,  // ← NEW
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 9. Return response — ✅ ADDED companyId + allowedStoreIds
    return res.status(200).json({
      success:         true,
      message:         "Login successful",
      token,
      expiresIn:       3600,
      user: {
        _id:            user._id,
        name:           user.name,
        email:          user.email,
        isActive:       user.isActive,
        profilePicture: user.profilePicture || null,
      },
      role:            userRoleDoc.roleName,
      roleId:          userRoleDoc.roleId._id,
      modules:         userModules,
      companyId:       loginCompanyId,        // ← NEW
      allowedStoreIds: loginAllowedStoreIds,  // ← NEW
    });

  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};



// ===================== USER LOGIN (CUSTOMER ROLE ONLY) =====================
exports.userlogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(400).json({ success: false, message: "Invalid email or password" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(400).json({ success: false, message: "Invalid email or password" });

    // Rename variable to avoid shadowing
    const userRoleDoc = await UserRole.findOne({ userId: user._id }).populate("roleId");
    if (!userRoleDoc) return res.status(400).json({ success: false, message: "No role assigned to user" });
    if (userRoleDoc.roleName.toLowerCase() !== "customer") return res.status(400).json({ success: false, message: "User does not exist" });

    // Build userModules directly (same as in signup logic)
    let userModules = [];
    const rolePermissions = await RolePermission.find({
      roleId: userRoleDoc.roleId._id,
      is_active: true,
    }).populate({
      path: "modulePermissionId",
      populate: [{ path: "moduleId" }, { path: "permissionId" }],
    });

    for (const rp of rolePermissions) {
      const mp = rp.modulePermissionId;
      if (
        mp &&
        mp.is_active &&
        mp.moduleId &&
        mp.moduleId.is_active &&
        mp.permissionId
      ) {
        let existingModule = userModules.find(
          (m) => m.moduleId.toString() === mp.moduleId._id.toString()
        );
        if (!existingModule) {
          existingModule = {
            moduleId: mp.moduleId._id,
            name: mp.moduleId.name,
            description: mp.moduleId.description, // Include description
            route_path: mp.moduleId.route_path,
            icon: mp.moduleId.icon,
            parent_id: mp.moduleId.parent_id, // Include parent_id
            is_active: mp.moduleId.is_active, // Include is_active
            userId: mp.moduleId.userId, // Include userId
            is_category: mp.moduleId.is_category, // Include is_category
            order: mp.moduleId.order, // Include order
            created_at: mp.moduleId.created_at, // Include created_at
            updated_at: mp.moduleId.updated_at, // Include updated_at
            permissions: [],
          };
          userModules.push(existingModule);
        }
        if (!existingModule.permissions.includes(mp.permissionId.code)) {
          existingModule.permissions.push(mp.permissionId.code);
        }
      }
    }

    // Get group and group permissions
    const userGroup = await UserGroup.findOne({ userId: user._id }).populate("groupId");
    let group = null;
    let groupPermissions = [];
    let isTrial = false;
    if (userGroup && userGroup.groupId) {
      group = { _id: userGroup.groupId._id, name: userGroup.groupId.groupName || userGroup.groupId.name };
      if (group.name && group.name.toLowerCase().includes("trial")) {
        isTrial = true;
      }
      const groupPermDoc = await GroupPermission.findOne({ groupId: userGroup.groupId._id });
      if (groupPermDoc && Array.isArray(groupPermDoc.permissions)) {
        groupPermissions = groupPermDoc.permissions.filter(p => p.isActive !== false).map(p => ({
          permissionId: p.permissionId,
          permissionCode: p.permissionCode
        }));
      }
    }
    // Check for trial subscription and include subscription data
    let subscription = null;
    const userSubscription = await UserSubscription.findOne({ userId: user._id }).populate("subscriptionId");
    if (userSubscription) {
      if (userSubscription.isTrial) {
        isTrial = true;
      }
      subscription = userSubscription.subscriptionId;
    }

    const token = jwt.sign({ userId: user._id, role: userRoleDoc.roleName, roleId: userRoleDoc.roleId._id, modules: userModules }, process.env.JWT_SECRET, { expiresIn: "1h" });

    // Filter module permissions by group permission codes
    const groupPermissionCodes = groupPermissions.map(p => p.permissionCode);
    const filteredModules = userModules.map(m => ({
      ...m,
      permissions: m.permissions.filter(code => groupPermissionCodes.includes(code) || groupPermissionCodes.length === 0)
    }));

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      expiresIn: 3600,
      user: user,
      modules: filteredModules,
      group: { ...group, permissions: groupPermissions },
      subscription,
      isTrial,
      role: userRoleDoc.roleName,
      roleId: userRoleDoc.roleId._id,
      permissions: groupPermissions
    });

  } catch (error) {
    console.error("UserLogin error:", error.message);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

// Get all users with subscriptions, group permissions, and modules
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().lean();

    const usersWithDetails = [];

    for (const user of users) {
      // 1️⃣ Fetch subscription
      const subscription = await UserSubscription.findOne({ userId: user._id }).populate("subscriptionId");

      // 2️⃣ Fetch user role
      const userRoleDoc = await UserRole.findOne({ userId: user._id }).populate("roleId");

      // Check if UserRole exists
      let roleId = null;
      let roleName = null;
      if (userRoleDoc && userRoleDoc.roleId) {
        roleId = userRoleDoc.roleId._id;
        roleName = userRoleDoc.roleName;
      }

      // 3️⃣ Fetch user group
      const userGroup = await UserGroup.findOne({ userId: user._id }).populate("groupId");

      // 4️⃣ Fetch group permissions
      let groupPermissions = [];
      if (userGroup && userGroup.groupId) {
        const gp = await GroupPermission.findOne({ groupId: userGroup.groupId._id });
        if (gp && gp.permissions) {
          groupPermissions = gp.permissions.map(p => p.permissionId?.toString()).filter(Boolean); // Ensure permissionId exists
        }
      }

      // 5️⃣ Fetch role permissions
      let rolePermissions = [];
      if (roleId) {
        const rpList = await RolePermission.find({ roleId, is_active: true }).populate("modulePermissionId");
        rolePermissions = rpList.map(rp => rp.modulePermissionId?.permissionId?.toString()).filter(Boolean); // Ensure permissionId exists
      }

      // 6️⃣ Merge permissions (role + group)
      const allPermissionsSet = new Set([...groupPermissions, ...rolePermissions]);

      // 7️⃣ Determine accessible modules based on module permissions
      const authorizedModules = [];
      for (const permId of allPermissionsSet) {
        const modulePerms = await ModulePermission.find({ permissionId: permId, is_active: true })
          .populate("moduleId")
          .populate("permissionId");

        for (const mp of modulePerms) {
          const module = mp.moduleId;
          const permission = mp.permissionId;

          if (module && module.is_active && permission) {
            const existingModuleIndex = authorizedModules.findIndex(m => m.moduleId.toString() === module._id.toString());

            if (existingModuleIndex === -1) {
              authorizedModules.push({
                moduleId: module._id,
                name: module.name,
                description: module.description,
                route_path: module.route_path,
                icon: module.icon,
                is_category: module.is_category,
                parent_id: module.parent_id,
                order: module.order,
                permissions: [permission.code],
              });
            } else {
              authorizedModules[existingModuleIndex].permissions.push(permission.code);
            }
          }
        }
      }

      const uniqueModules = authorizedModules
        .filter((m, index, self) => index === self.findIndex(x => x.moduleId.toString() === m.moduleId.toString()))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      // 8️⃣ Build user object with modules and permissions
      usersWithDetails.push({
        ...user,
        role: roleName,
        roleId: roleId,
        group: userGroup ? { _id: userGroup.groupId._id, name: userGroup.groupName || userGroup.groupId.groupName } : null,
        subscription: subscription ? subscription.subscriptionId : null,
        permissions: Array.from(allPermissionsSet),
        modules: uniqueModules,
      });
    }

    res.status(200).json({
      success: true,
      data: usersWithDetails,
    });
  } catch (error) {
    console.error("Error in getAllUsers:", error.message);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, roleId, password, isActive, subscriptionId, groupId } = req.body;

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get current user role
    const currentUserRole = await UserRole.findOne({ userId: id }).populate("roleId");
    const currentRoleName = currentUserRole ? currentUserRole.roleName : null;

    // Prepare update data for User model
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (isActive !== undefined) updateData.isActive = isActive;

    // Handle Role Update
    let newRole = null;
    if (roleId !== undefined) {
      if (roleId === null || roleId === "") {
        // Remove role if empty/null
        await UserRole.deleteMany({ userId: id });
      } else {
        // Validate role exists
        const role = await Role.findById(roleId);
        if (!role) {
          return res.status(400).json({
            success: false,
            message: "Invalid role ID",
          });
        }
        
        // Find existing user role
        const existingUserRole = await UserRole.findOne({ userId: id });
        
        if (existingUserRole) {
          // Update existing role only if different
          if (existingUserRole.roleId.toString() !== roleId.toString()) {
            existingUserRole.roleId = roleId;
            existingUserRole.roleName = role.name;
            await existingUserRole.save();
          }
        } else {
          // Create new role relationship
          await UserRole.create({
            userId: id,
            roleId,
            roleName: role.name,
          });
        }
        newRole = role;
      }
    }

    // Determine the role for group/subscription logic
    const targetRole = newRole || (currentUserRole ? currentUserRole.roleId : null);
    const targetRoleName = newRole ? newRole.name : currentRoleName;

    // Check if role is changing to/from Customer
    const isChangingToCustomer = newRole && newRole.name === "Customer" && currentRoleName !== "Customer";
    const isChangingFromCustomer = newRole && newRole.name !== "Customer" && currentRoleName === "Customer";

    // If changing from Customer to non-customer, remove subscription and trial dates
    if (isChangingFromCustomer) {
      // Remove UserSubscription if exists
      await UserSubscription.deleteMany({ userId: id });
      
      // Remove trial dates from User
      await User.findByIdAndUpdate(id, {
        $unset: { trialStartDate: "", trialEndDate: "" }
      });
    }

    // If changing to Customer from non-customer, set trial dates
    if (isChangingToCustomer) {
      // Check if subscription is not being provided, then set trial dates
      if (!subscriptionId) {
        await User.findByIdAndUpdate(id, {
          trialStartDate: new Date(),
          trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        });
      }
    }

    // Handle Subscription Update
    if (subscriptionId !== undefined && subscriptionId !== null && subscriptionId !== "") {
      // Only allow subscription for Customer role
      if (targetRoleName && targetRoleName.toLowerCase() !== "customer") {
        return res.status(400).json({ 
          success: false, 
          message: "Subscription can only be assigned to Customer role users." 
        });
      }
      
      const Subscription = require("../../../modules/subscription/models/Subscription");
      const GroupPlan = require("../../../modules/admin/models/GroupPlan");
      
      const subscription = await Subscription.findById(subscriptionId);
      if (!subscription) {
        return res.status(400).json({ success: false, message: "Invalid subscriptionId" });
      }
      
      // Update or create UserSubscription
      let userSub = await UserSubscription.findOne({ userId: id });
      if (userSub) {
        // Only update if different
        if (userSub.subscriptionId.toString() !== subscriptionId.toString()) {
          userSub.subscriptionId = subscription._id;
          userSub.startDate = new Date();
          userSub.endDate = new Date(Date.now() + (subscription.durationMonths || 1) * 30 * 24 * 60 * 60 * 1000);
          userSub.isTrial = false;
          userSub.isActive = true;
          await userSub.save();
        }
      } else {
        userSub = await UserSubscription.create({
          userId: id,
          subscriptionId: subscription._id,
          startDate: new Date(),
          endDate: new Date(Date.now() + (subscription.durationMonths || 1) * 30 * 24 * 60 * 60 * 1000),
          isTrial: false,
          isActive: true,
        });
      }
      
      // For Customer role: Update UserGroup based on GroupPlan
      const planGroup = await GroupPlan.findOne({ planId: subscriptionId });
      if (!planGroup) {
        return res.status(400).json({ success: false, message: "No group mapped to this subscription plan" });
      }
      
      // Check if user already has this group
      const existingUserGroup = await UserGroup.findOne({ userId: id });
      if (existingUserGroup) {
        if (existingUserGroup.groupId.toString() !== planGroup.groupId.toString()) {
          existingUserGroup.groupId = planGroup.groupId;
          existingUserGroup.groupName = planGroup.groupName;
          await existingUserGroup.save();
        }
      } else {
        await UserGroup.create({ 
          userId: id, 
          groupId: planGroup.groupId, 
          groupName: planGroup.groupName 
        });
      }
      
      // Remove trial dates when assigning paid subscription
      await User.findByIdAndUpdate(id, {
        $unset: { trialStartDate: "", trialEndDate: "" }
      });
    }

    // Handle Direct Group Update (for non-customer roles or customer without subscription)
    if (groupId !== undefined && groupId !== null && groupId !== "") {
      // Check if user has active subscription (for Customer role)
      if (targetRoleName && targetRoleName.toLowerCase() === "customer") {
        const activeSubscription = await UserSubscription.findOne({ 
          userId: id, 
          isActive: true 
        });
        
        if (activeSubscription) {
          return res.status(400).json({ 
            success: false, 
            message: "Cannot update group directly for Customer role with active subscription. Update subscription instead." 
          });
        }
      }
      
      // Validate group exists
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(400).json({ success: false, message: "Invalid groupId" });
      }
      
      // Update or create UserGroup
      const existingUserGroup = await UserGroup.findOne({ userId: id });
      if (existingUserGroup) {
        if (existingUserGroup.groupId.toString() !== groupId.toString()) {
          existingUserGroup.groupId = groupId;
          existingUserGroup.groupName = group.groupName;
          await existingUserGroup.save();
        }
      } else {
        await UserGroup.create({ 
          userId: id, 
          groupId: groupId, 
          groupName: group.groupName 
        });
      }
    }

    // Update user document if there's anything to update
    let updatedUser = user;
    if (Object.keys(updateData).length > 0) {
      updatedUser = await User.findByIdAndUpdate(id, updateData, {
        new: true,
      }).select("-password -__v");
    } else {
      updatedUser = await User.findById(id).select("-password -__v");
    }

    // Get updated role and group info for response
    const userRole = await UserRole.findOne({ userId: id }).populate("roleId", "name description");
    const userGroup = await UserGroup.findOne({ userId: id }).populate("groupId", "groupName");
    const userSubscription = await UserSubscription.findOne({ userId: id }).populate("subscriptionId", "name price durationMonths");

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: {
        user: updatedUser,
        role: userRole ? {
          roleId: userRole.roleId._id,
          roleName: userRole.roleName,
          roleDetails: userRole.roleId
        } : null,
        group: userGroup ? {
          groupId: userGroup.groupId._id,
          groupName: userGroup.groupName || userGroup.groupId.groupName
        } : null,
        subscription: userSubscription ? userSubscription.subscriptionId : null
      },
    });
  } catch (error) {
    console.error("Error updating user:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while updating user",
      error: error.message,
    });
  }
};

// Delete
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Delete all user-related data
    await UserRole.deleteMany({ userId: id });
    await UserGroup.deleteMany({ userId: id });
    await UserSubscription.deleteMany({ userId: id });
    await GroupPermission.deleteMany({ groupId: id }); // If group-permissions are user-specific (adjust if not)

    // Then delete the user
    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User and all associated data deleted successfully",
      data: {
        userId: id
      },
    });
  } catch (error) {
    console.error("Error deleting user:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while deleting user",
      error: error.message,
    });
  }
};

// Modify the verify-token route to include the last visited page
exports.verifyToken = async (req, res) => {
  try {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Token missing. Please log in again." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({ message: "Invalid token. Please log in again." });
    }

    // Include the last visited page in the response
    res.status(200).json({ valid: true, lastVisitedPage: decoded.lastVisitedPage || '/' });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({ message: "Invalid or expired token. Please log in again." });
  }
};
// ===================== FORGOT PASSWORD – SEND OTP =====================
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });
    const clean = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))
      return res.status(400).json({ message: "Please enter a valid email address." });

    const user = await User.findOne({ email: clean });

    if (!user) {
      // Send a "not registered" notice to the email — always deliver something
      try { await sendNotRegisteredEmail(clean); } catch (_) {}
      return res.status(200).json({ message: "OTP sent to your email address." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    user.resetOTPExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    await sendOTPEmail(clean, otp);

    return res.status(200).json({ message: "OTP sent to your email address." });
  } catch (err) {
    console.error("forgotPassword error:", err);
    return res.status(500).json({ message: "Failed to send OTP. Please try again." });
  }
};

// ===================== VERIFY OTP =====================
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required." });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.resetOTP) return res.status(400).json({ message: "Invalid or expired OTP." });
    if (new Date() > user.resetOTPExpiry) return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    if (user.resetOTP !== otp.trim()) return res.status(400).json({ message: "Incorrect OTP. Please try again." });

    return res.status(200).json({ message: "OTP verified successfully." });
  } catch (err) {
    console.error("verifyOTP error:", err);
    return res.status(500).json({ message: "Verification failed. Please try again." });
  }
};

// ===================== RESET PASSWORD =====================
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ message: "Email, OTP, and new password are required." });
    if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters." });

    const clean = email.toLowerCase().trim();
    const user = await User.findOne({ email: clean });
    if (!user || !user.resetOTP) return res.status(400).json({ message: "Invalid or expired OTP." });
    if (new Date() > user.resetOTPExpiry) return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    if (user.resetOTP !== otp.trim()) return res.status(400).json({ message: "Incorrect OTP." });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Use direct DB update to guarantee the write goes through
    const result = await User.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword, resetOTP: null, resetOTPExpiry: null } }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ message: "Failed to update password. Please try again." });
    }

    return res.status(200).json({ message: "Password updated successfully. You can now log in." });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(500).json({ message: "Reset failed. Please try again." });
  }
};

// ══════════════════════════════════════════════════════════════════
//  SHARED SOCIAL AUTH HELPERS
// ══════════════════════════════════════════════════════════════════

/* Builds JWT + full response payload for any social OAuth provider */
async function handleSocialUser({ email, name, picture, mode }) {
  const clean = email.toLowerCase().trim();
  let user = await User.findOne({ email: clean });
  let isNewUser = false;

  if (!user) {
    if (mode === "login") {
      return { __error: "No account found with this email. Please sign up first." };
    }
    isNewUser = true;
    const randomPwd = await bcrypt.hash(Math.random().toString(36) + Date.now().toString(), 10);
    user = await User.create({
      name: name || clean.split("@")[0],
      email: clean,
      password: randomPwd,
      profilePicture: picture || "",
      isActive: true,
      trialStartDate: new Date(),
    });
    const customerRole = await Role.findOne({ name: "Customer" });
    if (!customerRole) throw new Error("Default Customer role not found.");
    await UserRole.create({ userId: user._id, roleId: customerRole._id, roleName: customerRole.name });
    let trialGroup = await Group.findOne({ groupName: "Trial Group" });
    if (!trialGroup) trialGroup = await Group.create({ groupName: "Trial Group", description: "Default trial group", isActive: true });
    await UserGroup.create({ userId: user._id, groupId: trialGroup._id, groupName: trialGroup.groupName });
  }

  const userRoleDoc = await UserRole.findOne({ userId: user._id }).populate("roleId");
  if (!userRoleDoc) throw new Error("No role assigned to this account.");
  if (userRoleDoc.roleName.toLowerCase() !== "customer")
    return { __error: "Only Customer accounts can use social login here." };

  let userModules = [];
  const rolePermissions = await RolePermission.find({ roleId: userRoleDoc.roleId._id, is_active: true })
    .populate({ path: "modulePermissionId", populate: [{ path: "moduleId" }, { path: "permissionId" }] });
  for (const rp of rolePermissions) {
    const mp = rp.modulePermissionId;
    if (mp && mp.is_active && mp.moduleId && mp.moduleId.is_active && mp.permissionId) {
      let mod = userModules.find(m => m.moduleId.toString() === mp.moduleId._id.toString());
      if (!mod) {
        mod = { moduleId: mp.moduleId._id, name: mp.moduleId.name, route_path: mp.moduleId.route_path, icon: mp.moduleId.icon, order: mp.moduleId.order, is_category: mp.moduleId.is_category, parent_id: mp.moduleId.parent_id, is_active: mp.moduleId.is_active, permissions: [] };
        userModules.push(mod);
      }
      if (!mod.permissions.includes(mp.permissionId.code)) mod.permissions.push(mp.permissionId.code);
    }
  }

  const userGroup = await UserGroup.findOne({ userId: user._id }).populate("groupId");
  let group = null, groupPermissions = [], isTrial = false;
  if (userGroup?.groupId) {
    group = { _id: userGroup.groupId._id, name: userGroup.groupId.groupName || userGroup.groupId.name };
    if (group.name?.toLowerCase().includes("trial")) isTrial = true;
    const gpDoc = await GroupPermission.findOne({ groupId: userGroup.groupId._id });
    if (gpDoc?.permissions) {
      groupPermissions = gpDoc.permissions.filter(p => p.isActive !== false)
        .map(p => ({ permissionId: p.permissionId, permissionCode: p.permissionCode }));
    }
  }

  let subscription = null;
  const userSub = await UserSubscription.findOne({ userId: user._id }).populate("subscriptionId");
  if (userSub) { if (userSub.isTrial) isTrial = true; subscription = userSub.subscriptionId; }

  const groupPermCodes = groupPermissions.map(p => p.permissionCode);
  const filteredModules = userModules.map(m => ({
    ...m, permissions: m.permissions.filter(c => groupPermCodes.includes(c) || groupPermCodes.length === 0),
  }));

  const token = jwt.sign(
    { userId: user._id, role: userRoleDoc.roleName, roleId: userRoleDoc.roleId._id, modules: filteredModules },
    process.env.JWT_SECRET, { expiresIn: "1h" }
  );

  return {
    success: true,
    message: isNewUser ? "Account created successfully." : "Login successful.",
    token, expiresIn: 3600,
    user: { _id: user._id, name: user.name, email: user.email, profilePicture: user.profilePicture || "", isActive: user.isActive },
    modules: filteredModules,
    group: { ...group, permissions: groupPermissions },
    subscription, isTrial,
    role: userRoleDoc.roleName,
    roleId: userRoleDoc.roleId._id,
    permissions: groupPermissions,
  };
}

/* Sends OAuth result back to the opener popup window */
function sendOAuthPopupResult(res, data) {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const safeData = JSON.stringify(data).replace(/</g, "\\u003c");
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html><html><head><title>Auth</title></head><body><script>
(function(){
  var payload = ${safeData};
  payload.type = 'SOCIAL_AUTH_SUCCESS';
  if(window.opener && !window.opener.closed){
    window.opener.postMessage(payload, '${frontendUrl}');
    setTimeout(function(){ window.close(); }, 300);
  } else {
    window.location.href = '${frontendUrl}';
  }
})();
</script></body></html>`);
}

// ===================== GOOGLE LOGIN / SIGNUP =====================
exports.googleLogin = async (req, res) => {
  try {
    const { credential, access_token, mode } = req.body;
    if (!credential && !access_token) return res.status(400).json({ message: "Google credential is required." });

    let email, name, picture;

    if (credential) {
      // ID-token flow (legacy GoogleLogin component)
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      ({ email, name, picture } = ticket.getPayload());
    } else {
      // Access-token flow (useGoogleLogin hook → icon button)
      const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const info = await infoRes.json();
      if (info.error) return res.status(401).json({ message: "Invalid Google token." });
      ({ email, name, picture } = info);
    }

    const result = await handleSocialUser({ email, name, picture, mode });
    if (result.__error) return res.status(404).json({ message: result.__error });
    return res.status(200).json(result);

  } catch (err) {
    console.error("googleLogin error:", err.message);
    return res.status(500).json({ message: "Google authentication failed. Please try again." });
  }
};

// ===================== FACEBOOK LOGIN / SIGNUP =====================
exports.facebookLogin = (req, res) => {
  const { mode = "login" } = req.query;
  const state = Buffer.from(JSON.stringify({ mode })).toString("base64url");
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
    scope: "email,public_profile",
    state,
    response_type: "code",
  });
  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
};

exports.facebookCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return sendOAuthPopupResult(res, { __error: "Facebook sign-in was cancelled." });

    const { mode } = JSON.parse(Buffer.from(state, "base64url").toString());

    // Exchange code for access token
    const tokenParams = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
      code,
    });
    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${tokenParams}`);
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Get user info from Facebook
    const userRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.type(large)&access_token=${tokenData.access_token}`);
    const fbUser = await userRes.json();
    if (!fbUser.email) throw new Error("Facebook account has no public email. Please use a different sign-in method.");

    const result = await handleSocialUser({ email: fbUser.email, name: fbUser.name, picture: fbUser.picture?.data?.url, mode });
    sendOAuthPopupResult(res, result);
  } catch (err) {
    console.error("facebookCallback error:", err.message);
    sendOAuthPopupResult(res, { __error: err.message || "Facebook authentication failed." });
  }
};

// ===================== GITHUB LOGIN / SIGNUP =====================
exports.githubLogin = (req, res) => {
  const { mode = "login" } = req.query;
  const state = Buffer.from(JSON.stringify({ mode })).toString("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_CALLBACK_URL,
    scope: "user:email",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
};

exports.githubCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return sendOAuthPopupResult(res, { __error: "GitHub sign-in was cancelled." });

    const { mode } = JSON.parse(Buffer.from(state, "base64url").toString());

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    const ghHeaders = { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" };

    // Get user profile
    const userRes = await fetch("https://api.github.com/user", { headers: ghHeaders });
    const ghUser = await userRes.json();

    // GitHub may hide email — fetch from /user/emails
    let email = ghUser.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", { headers: ghHeaders });
      const emails = await emailsRes.json();
      email = emails.find(e => e.primary && e.verified)?.email || emails[0]?.email;
    }
    if (!email) throw new Error("Could not get email from GitHub account. Make sure your email is public or verified.");

    const result = await handleSocialUser({ email, name: ghUser.name || ghUser.login, picture: ghUser.avatar_url, mode });
    sendOAuthPopupResult(res, result);
  } catch (err) {
    console.error("githubCallback error:", err.message);
    sendOAuthPopupResult(res, { __error: err.message || "GitHub authentication failed." });
  }
};
