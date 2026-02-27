require('dotenv').config();
const { App } = require('@slack/bolt');
const { registerModalHandlers } = require('./modal');
const { registerCommands } = require('./commands');

// Validate required env vars
const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[ERROR] Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

// Register handlers
registerModalHandlers(app);
registerCommands(app);

// Initialize database on startup
require('./db').getDb();

(async () => {
  await app.start();
  console.log('');
  console.log('========================================');
  console.log('  🤖 HR Monthly Report Bot is running!');
  console.log('========================================');
  console.log('');

  // Log configuration
  const testMode = process.env.TEST_MODE === 'true';
  console.log(`[CONFIG] TEST_MODE: ${testMode}`);
  if (testMode) {
    console.log(`[CONFIG] TEST_USERS: ${process.env.TEST_USERS || '(none)'}`);
  }
  console.log(`[CONFIG] ADMIN_USER_ID: ${process.env.ADMIN_USER_ID || '(not set)'}`);
  console.log(`[CONFIG] EMPLOYEE_IDS: ${process.env.EMPLOYEE_IDS || '(all workspace members)'}`);

  console.log('');
  console.log('[APP] Listening for Slack events via Socket Mode');
})();
