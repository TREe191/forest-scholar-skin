export default {
  packagerConfig: {
    asar: true,
    name: "Codex Skin Theme Manager",
    executableName: "codex-skin-theme-manager",
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
};
