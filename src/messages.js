const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function getMonthName(month) {
  return MONTHS[month - 1];
}

function parseEnvList(key) {
  const val = process.env[key];
  if (!val || !val.trim()) return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function isTestMode() {
  return process.env.TEST_MODE === 'true';
}

function buildReportMessage(month, year) {
  return {
    text: `📋 Monthly Report - ${getMonthName(month)} ${year}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📋 Monthly Report - ${getMonthName(month)} ${year}` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Please fill in your monthly attendance report.' }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📝 Fill Report' },
            action_id: 'open_report_modal',
            style: 'primary',
            value: JSON.stringify({ month, year })
          }
        ]
      }
    ]
  };
}

const REMINDER_TEXTS = {
  1: '🔔 Reminder: Please fill in your monthly report.',
  2: '⚠️ Second reminder: Your monthly report is still missing.',
  3: '🚨 Final reminder: Please submit your report immediately.'
};

function buildReminderMessage(month, year, level) {
  const text = REMINDER_TEXTS[level] || REMINDER_TEXTS[1];
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${text}\n\n*${getMonthName(month)} ${year}*`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📝 Fill Report' },
            action_id: 'open_report_modal',
            style: 'primary',
            value: JSON.stringify({ month, year })
          }
        ]
      }
    ]
  };
}

async function getAllHumanMembers(client) {
  const members = [];
  let cursor;

  do {
    const result = await client.users.list({ cursor, limit: 200 });
    for (const member of result.members) {
      if (!member.is_bot && !member.deleted && member.id !== 'USLACKBOT') {
        members.push(member);
      }
    }
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return members;
}

async function getTargetMembers(client) {
  const { getEmployeeIds, isEmployeeTablePopulated } = require('./db');
  let members = await getAllHumanMembers(client);

  // Filter to employees: prefer DB, fall back to env var
  if (isEmployeeTablePopulated()) {
    const dbIds = getEmployeeIds();
    const idSet = new Set(dbIds);
    members = members.filter(m => idSet.has(m.id));
    console.log(`[MSG] Filtered to ${members.length} employees from database`);
  } else {
    const employeeIds = parseEnvList('EMPLOYEE_IDS');
    if (employeeIds.length > 0) {
      const idSet = new Set(employeeIds);
      members = members.filter(m => idSet.has(m.id));
      console.log(`[MSG] Filtered to ${members.length} employees from EMPLOYEE_IDS env`);
    }
  }

  // In test mode, further filter to TEST_USERS only
  if (isTestMode()) {
    const testUsers = parseEnvList('TEST_USERS');
    if (testUsers.length > 0) {
      const testSet = new Set(testUsers);
      members = members.filter(m => testSet.has(m.id));
      console.log(`[MSG] TEST_MODE: filtered to ${members.length} test users`);
    } else {
      console.warn('[MSG] TEST_MODE is on but TEST_USERS is empty — no messages will be sent');
      members = [];
    }
  }

  return members;
}

async function sendReportToAll(client, month, year) {
  const members = await getTargetMembers(client);
  const message = buildReportMessage(month, year);
  let sent = 0;

  for (const member of members) {
    try {
      await client.chat.postMessage({ channel: member.id, ...message });
      sent++;
    } catch (err) {
      console.error(`[MSG] Failed to DM ${member.name || member.id}: ${err.message}`);
    }
  }

  console.log(`[MSG] Sent monthly report message to ${sent}/${members.length} members`);
  return { sent, total: members.length };
}

async function sendReminders(client, month, year, level) {
  const { hasSubmitted } = require('./db');
  const members = await getTargetMembers(client);
  const message = buildReminderMessage(month, year, level);
  let sent = 0;

  for (const member of members) {
    if (!hasSubmitted(member.id, month, year)) {
      try {
        await client.chat.postMessage({ channel: member.id, ...message });
        sent++;
      } catch (err) {
        console.error(`[REMINDER] Failed to DM ${member.name || member.id}: ${err.message}`);
      }
    }
  }

  console.log(`[REMINDER] Sent level-${level} reminders to ${sent} members who haven't submitted`);
  return { sent, total: members.length };
}

function getAdminUserIds() {
  const val = process.env.ADMIN_USER_ID;
  if (!val || !val.trim()) return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function isAdmin(userId) {
  return getAdminUserIds().includes(userId);
}

module.exports = {
  getMonthName,
  buildReportMessage,
  buildReminderMessage,
  getAllHumanMembers,
  getTargetMembers,
  sendReportToAll,
  sendReminders,
  getAdminUserIds,
  isAdmin
};
