// Validates Node.js version before install to give clear error messages.
const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 20) {
  console.error(`
  ERROR: Freeport requires Node.js >= 20.

  You are running Node.js ${process.versions.node}.
  Please upgrade: https://nodejs.org/

  Recommended: use nvm to manage versions:
    nvm install 22
    nvm use 22
`);
  process.exit(1);
}
