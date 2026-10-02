const path = require("path");
const Mocha = require("mocha");
module.exports.run = function () {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 60000 });
  mocha.addFile(path.resolve(__dirname, "adapter.test.js"));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => failures ? reject(new Error(`${failures} echec(s)`)) : resolve());
  });
};
