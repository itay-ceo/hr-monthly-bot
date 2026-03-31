const { sendReportToAll, sendReminders, getTargetMembers, getAllHumanMembers, getMonthName, isAdmin } = require('./messages');
const { generateExcel } = require('./excel');
const { getReportsForMonth, addEmployee, removeEmployee, getEmployeeIds } = require('./db');
const path = require('path');

function registerCommands(app) {
  app.command('/hr-report', async ({ command, ack, respond, client }) => {
    await ack();

    // Check if user is a configured admin
    if (!isAdmin(command.user_id)) {
      await respond({ text: '⛔ This command is only available to configured admins.', response_type: 'ephemeral' });
      return;
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const subcommand = (command.text || '').trim().toLowerCase();

    switch (subcommand) {
      case 'send': {
        await respond({ text: '📤 Sending monthly report messages to all members...', response_type: 'ephemeral' });
        const result = await sendReportToAll(client, month, year);
        await respond({ text: `✅ Done! Sent to ${result.sent}/${result.total} members.`, response_type: 'ephemeral' });
        break;
      }

      case 'reminder1': {
        await respond({ text: '🔔 Sending 1st reminder to pending members...', response_type: 'ephemeral' });
        const result = await sendReminders(client, month, year, 1);
        await respond({ text: `✅ Reminder sent to ${result.sent} members.`, response_type: 'ephemeral' });
        break;
      }

      case 'reminder2': {
        await respond({ text: '⚠️ Sending 2nd reminder to pending members...', response_type: 'ephemeral' });
        const result = await sendReminders(client, month, year, 2);
        await respond({ text: `✅ Reminder sent to ${result.sent} members.`, response_type: 'ephemeral' });
        break;
      }

      case 'reminder3': {
        await respond({ text: '🚨 Sending final reminder to pending members...', response_type: 'ephemeral' });
        const result = await sendReminders(client, month, year, 3);
        await respond({ text: `✅ Reminder sent to ${result.sent} members.`, response_type: 'ephemeral' });
        break;
      }

      case 'export': {
        await respond({ text: '📊 Generating Excel report...', response_type: 'ephemeral' });
        const filePath = await generateExcel(month, year);

        await client.files.uploadV2({
          channel_id: command.user_id,
          file: filePath,
          filename: path.basename(filePath),
          title: `HR Report - ${getMonthName(month)} ${year}`,
          initial_comment: `📊 HR Report for *${getMonthName(month)} ${year}*`
        });

        await respond({ text: '✅ Excel report sent to your DMs.', response_type: 'ephemeral' });
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

        const table = [
          `*👥 Workspace Members (${allMembers.length})*`,
          '',
          header,
          ...rows
        ].join('\n');

        await respond({ text: table, response_type: 'ephemeral' });
        break;
      }

      case 'status': {
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

        const statusText = [
          `📋 *Monthly Report Status - ${getMonthName(month)} ${year}*`,
          '',
          `✅ *Submitted (${submitted.length}):*`,
          submittedList,
          '',
          `⏳ *Pending (${pending.length}):*`,
          pendingList
        ].join('\n');

        await respond({ text: statusText, response_type: 'ephemeral' });
        break;
      }

      default: {
        // Handle add/remove with arguments
        const addMatch = (command.text || '').match(/^add\s+<@(U[A-Z0-9]+)(?:\|[^>]*)?>$/i);
        const removeMatch = (command.text || '').match(/^remove\s+<@(U[A-Z0-9]+)(?:\|[^>]*)?>$/i);

        if (addMatch) {
          const userId = addMatch[1];
          const added = addEmployee(userId);
          if (added) {
            await respond({ text: `✅ Added <@${userId}> to the employee list.`, response_type: 'ephemeral' });
          } else {
            await respond({ text: `ℹ️ <@${userId}> is already in the employee list.`, response_type: 'ephemeral' });
          }
          break;
        }

        if (removeMatch) {
          const userId = removeMatch[1];
          const removed = removeEmployee(userId);
          if (removed) {
            await respond({ text: `✅ Removed <@${userId}> from the employee list.`, response_type: 'ephemeral' });
          } else {
            await respond({ text: `⚠️ <@${userId}> was not in the employee list.`, response_type: 'ephemeral' });
          }
          break;
        }

        if (subcommand === 'list') {
          const ids = getEmployeeIds();
          if (ids.length === 0) {
            await respond({ text: 'No employees configured — all workspace members are targeted.', response_type: 'ephemeral' });
          } else {
            const rows = ids.map((id, i) => `${i + 1}. <@${id}>`).join('\n');
            await respond({ text: `*👥 Employee List (${ids.length}):*\n${rows}`, response_type: 'ephemeral' });
          }
          break;
        }

        await respond({
          text: [
            '*📋 HR Report Bot - Commands:*',
            '• `/hr-report send` - Send monthly report to all members',
            '• `/hr-report reminder1` - 1st reminder (pending members)',
            '• `/hr-report reminder2` - 2nd reminder (pending members)',
            '• `/hr-report reminder3` - Final reminder (pending members)',
            '• `/hr-report export` - Generate & download Excel report',
            '• `/hr-report status` - See who has/hasn\'t submitted',
            '• `/hr-report users` - List all workspace members with IDs',
            '• `/hr-report add @user` - Add employee to the list',
            '• `/hr-report remove @user` - Remove employee from the list',
            '• `/hr-report list` - Show configured employee list'
          ].join('\n'),
          response_type: 'ephemeral'
        });
      }
    }
  });
}

module.exports = { registerCommands };
