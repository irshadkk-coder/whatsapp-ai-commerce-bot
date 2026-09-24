const Module = require("module");

function loadFresh(modulePath, mocks) {
  const originalLoad = Module._load;
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  Module._load = function mockedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = { loadFresh };
