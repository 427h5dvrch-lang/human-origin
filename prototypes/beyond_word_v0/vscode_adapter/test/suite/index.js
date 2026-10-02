const path = require("path");
const Mocha = require("mocha");
module.exports.run = function () {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 60000 });
  for (const f of (process.env.HO_SUITE || "adapter").split(",")) mocha.addFile(path.resolve(__dirname, `${f}.test.js`));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => failures ? reject(new Error(`${failures} echec(s)`)) : resolve());
  });
};
