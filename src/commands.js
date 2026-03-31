const { sendReportToAll, sendReminders, getTargetMembers, getAllHumanMembers, getMonthName, isAdmin } = require('./messages');
const { generateExcel } = require('./excel');
const { getReportsForMonth, addEmployee, removeEmployee, getEmployeeIds, setActivePeriod, getActivePeriod } = require('./db');
const path = require('path');

// === Active Period ===

function getActiveOrCurrentPeriod() {
  const active = getActivePeriod();
  if (active) return { month: active.month, year: active.year };
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

// === Admin Menu ===

function buildAdminMenu() {
  const { month, year } = getActiveOrCurrentPeriod();
  const monthName = getMonthName(month);

  return {
    text: `📋 HR Report Bot — Admin Menu (${monthName} ${year})`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📋 HR Report Bot — Admin Menu' }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Active period:* ${monthName} ${year}` }
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '📨 Send Monthly Report' }, action_id: 'admin_send', style: 'primary' },
          { type: 'button', text: { type: 'plain_text', text: '🔔 Reminder 1' }, action_id: 'admin_reminder1' },
          { type: 'button', text: { type: 'plain_text', text: '⚠️ Reminder 2' }, action_id: 'admin_reminder2' },
          { type: 'button', text: { type: 'plain_text', text: '🚨 Reminder 3' }, action_id: 'admin_reminder3' }
        ]
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '📊 Export Excel' }, action_id: 'admin_export' },
          { type: 'button', text: { type: 'plain_text', text: '📋 Status' }, action_id: 'admin_status' },
          { type: 'button', text: { type: 'plain_text', text: '👥 Employee List' }, action_id: 'admin_list' }
        ]
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '➕ Add Employee' }, action_id: 'admin_add_employee' },
          { type: 'button', text: { type: 'plain_text', text: '➖ Remove Employee' }, action_id: 'admin_remove_employee' },
          { type: 'button', text: { type: 'plain_text', text: '📅 New Month' }, action_id: 'admin_new_month' }
        ]
      }
    ]
  };
}

async function postAdminMenu(client, userId) {
  await client.chat.postMessage({ channel: userId, ...buildAdminMenu() });
}

// === Shared Action Logic ===

async function handleSend(client) {
  const { month, year } = getActiveOrCurrentPeriod();
  setActivePeriod(month, year);
  const result = await sendReportToAll(client, month, year);
  return `✅ Done! Sent to ${result.sent}/${result.total} members for ${getMonthName(month)} ${year}.`;
}

async function handleReminder(client, level) {
  const { month, year } = getActiveOrCurrentPeriod();
  const result = await sendReminders(client, month, year, level);
  return `✅ Reminder sent to ${result.sent} members for ${getMonthName(month)} ${year}.`;
}

async function handleExport(client, userId) {
  const { month, year } = getActiveOrCurrentPeriod();
  const filePath = await generateExcel(month, year);
  const dm = await client.conversations.open({ users: userId });
  await client.files.uploadV2({
    channel_id: dm.channel.id,
    file: filePath,
    filename: path.basename(filePath),
    title: `HR Report - ${getMonthName(month)} ${year}`,
    initial_comment: `📊 HR Report for *${getMonthName(month)} ${year}*`
  });
  return `✅ Excel report generated for ${getMonthName(month)} ${year}.`;
}

async function handleStatus(client) {
  const { month, year } = getActiveOrCurrentPeriod();
  const members = await getTargetMembers(client);
  const reports = getReportsForMonth(month, year);
  const submittedIds = new Set(reports.map(r => r.user_id));
  const submitted = members.filter(m => submittedIds.has(m.id));
  const pending = members.filter(m => !submittedIds.has(m.id));

  const submittedList = submitted.length > 0
    ? submitted.map(m => `• ${m.real_name || m.name}`).join('\n')
    : '_None yet_';
  const pendingList = pending.length > 0
    ? pending.map(m => `• ${m.real_name || m.name}`).join('\n')
    : '_Everyone submitted!_';

  return [
    `📋 *Monthly Report Status - ${getMonthName(month)} ${year}*`,
    '',
    `✅ *Submitted (${submitted.length}):*`,
    submittedList,
    '',
    `⏳ *Pending (${pending.length}):*`,
    pendingList
  ].join('\n');
}

function handleNewMonth() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  setActivePeriod(month, year);
  return `📅 Active period set to *${getMonthName(month)} ${year}*.`;
}

function handleList() {
  const ids = getEmployeeIds();
  if (ids.length === 0) return 'No employees configured — all workspace members are targeted.';
  return `*👥 Employee List (${ids.length}):*\n${ids.map((id, i) => `${i + 1}. <@${id}>`).join('\n')}`;
}

function handleAdd(targetUserId) {
  return addEmployee(targetUserId)
    ? `✅ Added <@${targetUserId}> to the employee list.`
    : `ℹ️ <@${targetUserId}> is already in the employee list.`;
}

function handleRemoveEmployee(targetUserId) {
  return removeEmployee(targetUserId)
    ? `✅ Removed <@${targetUserId}> from the employee list.`
    : `⚠️ <@${targetUserId}> was not in the employee list.`;
}

// === Register All Handlers ===

function registerCommands(app) {
  // --- Slash Command ---
  app.command('/hr-report', async ({ command, ack, respond, client }) => {
    await ack();

    if (!isAdmin(command.user_id)) {
      await respond({ text: '⛔ This command is only available to configured admins.', response_type: 'ephemeral' });
      return;
    }

    const subcommand = (command.text || '').trim().toLowerCase();

    switch (subcommand) {
      case 'send': {
        await respond({ text: '📤 Sending monthly report messages to all members...', response_type: 'ephemeral' });
        await respond({ text: await handleSend(client), response_type: 'ephemeral' });
        break;
      }

      case 'reminder1': {
        await respond({ text: '🔔 Sending 1st reminder to pending members...', response_type: 'ephemeral' });
        await respond({ text: await handleReminder(client, 1), response_type: 'ephemeral' });
        break;
      }

      case 'reminder2': {
        await respond({ text: '⚠️ Sending 2nd reminder to pending members...', response_type: 'ephemeral' });
        await respond({ text: await handleReminder(client, 2), response_type: 'ephemeral' });
        break;
      }

      case 'reminder3': {
        await respond({ text: '🚨 Sending final reminder to pending members...', response_type: 'ephemeral' });
        await respond({ text: await handleReminder(client, 3), response_type: 'ephemeral' });
        break;
      }

      case 'export': {
        await respond({ text: '📊 Generating Excel report...', response_type: 'ephemeral' });
        await respond({ text: await handleExport(client, command.user_id), response_type: 'ephemeral' });
        break;
      }

      case 'users': {
        await respond({ text: '📋 Fetching workspace members...', response_type: 'ephemeral' });
        const allMembers = await getAllHumanMembers(client);
        if (allMembers.length === 0) {
          await respond({ text: '⚠️ No members found.', response_type: 'ephemeral' });
          break;
        }
        const header = '| # | Display Name | Real Name | Slack User ID |\n|---|---|---|---|';
        const rows = allMembers.map((m, i) => {
          const displayName = m.profile?.display_name || '_not set_';
          const realName = m.real_name || '_not set_';
          return `| ${i + 1} | ${displayName} | ${realName} | \`${m.id}\` |`;
        });
        await respond({
          text: [`*👥 Workspace Members (${allMembers.length})*`, '', header, ...rows].join('\n'),
          response_type: 'ephemeral'
        });
        break;
      }

      case 'status': {
        await respond({ text: await handleStatus(client), response_type: 'ephemeral' });
        break;
      }

      case 'list': {
        await respond({ text: handleList(), response_type: 'ephemeral' });
        break;
      }

      case 'new month': {
        await respond({ text: handleNewMonth(), response_type: 'ephemeral' });
        break;
      }

      default: {
        const addMatch = (command.text || '').match(/^add\s+<@(U[A-Z0-9]+)(?:\|[^>]*)?>$/i);
        const removeMatch = (command.text || '').match(/^remove\s+<@(U[A-Z0-9]+)(?:\|[^>]*)?>$/i);

        if (addMatch) {
          await respond({ text: handleAdd(addMatch[1]), response_type: 'ephemeral' });
          break;
        }
        if (removeMatch) {
          await respond({ text: handleRemoveEmployee(removeMatch[1]), response_type: 'ephemeral' });
          break;
        }

        // No subcommand or unrecognized → show admin menu
        await respond({ ...buildAdminMenu(), response_type: 'ephemeral' });
      }
    }
  });

  // --- Admin DM Listener ---
  // Use app.event('message') — app.message() can silently miss DMs in Socket Mode
  // because channel_type is not always set on the payload. Check channel ID prefix instead.
  app.event('message', async ({ event, client }) => {
    if (!event.channel || !event.channel.startsWith('D')) return;
    if (event.bot_id || event.subtype) return;
    if (!isAdmin(event.user)) return;

    await postAdminMenu(client, event.user);
  });

  // --- Admin Menu Button Handlers ---

  app.action('admin_send', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: '📤 Sending monthly report messages to all members...' });
    await client.chat.postMessage({ channel: userId, text: await handleSend(client) });
  });

  app.action('admin_reminder1', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: '🔔 Sending 1st reminder to pending members...' });
    await client.chat.postMessage({ channel: userId, text: await handleReminder(client, 1) });
  });

  app.action('admin_reminder2', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: '⚠️ Sending 2nd reminder to pending members...' });
    await client.chat.postMessage({ channel: userId, text: await handleReminder(client, 2) });
  });

  app.action('admin_reminder3', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: '🚨 Sending final reminder to pending members...' });
    await client.chat.postMessage({ channel: userId, text: await handleReminder(client, 3) });
  });

  app.action('admin_export', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: '📊 Generating Excel report...' });
    await client.chat.postMessage({ channel: userId, text: await handleExport(client, userId) });
  });

  app.action('admin_status', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: await handleStatus(client) });
  });

  app.action('admin_list', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: handleList() });
  });

  app.action('admin_new_month', async ({ ack, body, client }) => {
    await ack();
    const userId = body.user.id;
    if (!isAdmin(userId)) return;
    await client.chat.postMessage({ channel: userId, text: handleNewMonth() });
  });

  // --- Add Employee Modal ---

  app.action('admin_add_employee', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'admin_add_employee_modal',
        title: { type: 'plain_text', text: 'Add Employee' },
        submit: { type: 'plain_text', text: 'Add' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [{
          type: 'input',
          block_id: 'user_block',
          label: { type: 'plain_text', text: 'Select Employee to Add' },
          element: {
            type: 'users_select',
            action_id: 'selected_user',
            placeholder: { type: 'plain_text', text: 'Choose a user' }
          }
        }]
      }
    });
  });

  app.view('admin_add_employee_modal', async ({ ack, body, view, client }) => {
    await ack();
    const userId = body.user.id;
    const selectedUser = view.state.values.user_block.selected_user.selected_user;
    await client.chat.postMessage({ channel: userId, text: handleAdd(selectedUser) });
  });

  // --- Remove Employee Modal ---

  app.action('admin_remove_employee', async ({ ack, body, client }) => {
    await ack();
    if (!isAdmin(body.user.id)) return;
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'admin_remove_employee_modal',
        title: { type: 'plain_text', text: 'Remove Employee' },
        submit: { type: 'plain_text', text: 'Remove' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [{
          type: 'input',
          block_id: 'user_block',
          label: { type: 'plain_text', text: 'Select Employee to Remove' },
          element: {
            type: 'users_select',
            action_id: 'selected_user',
            placeholder: { type: 'plain_text', text: 'Choose a user' }
          }
        }]
      }
    });
  });

  app.view('admin_remove_employee_modal', async ({ ack, body, view, client }) => {
    await ack();
    const userId = body.user.id;
    const selectedUser = view.state.values.user_block.selected_user.selected_user;
    await client.chat.postMessage({ channel: userId, text: handleRemoveEmployee(selectedUser) });
  });
}

module.exports = { registerCommands };
