const { getDefaultConfig } = require('expo/metro-config');

// Expo resolves pnpm workspaces and native dependencies from this monorepo.
module.exports = getDefaultConfig(__dirname);
