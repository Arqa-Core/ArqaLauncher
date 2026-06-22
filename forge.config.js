module.exports = {
  packagerConfig: {
    name: 'arqa-launcher',
    asar: true,
    ignore: [
      /^\/out($|\/)/,
      /^\/scripts($|\/)/,
      /^\/build(_detailed)?\.log$/,
      /^\/README\.md$/,
      /^\/LICENSE$/,
    ],
  },
  rebuildConfig: {},
};
