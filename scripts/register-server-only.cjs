/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload hook loaded by Node's --require flag. */
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
