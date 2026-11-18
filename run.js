"use strict";
const { summary } = require("./helpers");
(async () => {
  for (const f of ["./site.test.js", "./crypto.test.js", "./api.test.js", "./ui.test.js"]) {
    try { await require(f)(); } catch (e) { console.log("  FAIL " + f + " crashed: " + (e && e.stack || e)); require("./helpers").ok(false, f + " ran to the end"); }
  }
  const { failed, passed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
