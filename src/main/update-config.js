'use strict';

// Hvor opdateringerne hentes fra. Skal svare til build.publish i package.json (scripts/prepare-build.js tjekker det).
module.exports = { provider: 'github', owner: 'peter-does-code', repo: 'the-grid-releases', releaseType: 'release' };
