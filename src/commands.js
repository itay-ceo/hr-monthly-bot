const { sendReportToAll, sendReminders, getTargetMembers, getMonthName, getAdminUserId } = require('./messages');
const { generateExcel } = require('./excel');
const { getReportsForMonth } = require('./db');
const path = require('path');

function registerCommands(app) {
  app.command('/hr-report', async ({ command, ack, respond, client }) => {
    await ack();

    // Check if user is the configured admin
    const adminUserId = getAdminUserId();
    if (!adminUserId) {
      await respond({ text: '⛔ ADMIN_USER_ID is not configured. Please set it in .env.', response_type: 'ephemeral' });
      return;
    }
    if (command.user_id !== adminUserId) {
      await respond({ text: '⛔ This command is only available to the configured admin.', response_type: 'ephemeral' });
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
        await respond({
          text: [
            '*📋 HR Report Bot - Commands:*',
            '• `/hr-report send` - Send monthly report to all members',
            '• `/hr-report reminder1` - 1st reminder (pending members)',
            '• `/hr-report reminder2` - 2nd reminder (pending members)',
            '• `/hr-report reminder3` - Final reminder (pending members)',
            '• `/hr-report export` - Generate & download Excel report',
            '• `/hr-report status` - See who has/hasn\'t submitted'
          ].join('\n'),
          response_type: 'ephemeral'
        });
      }
    }
  });
}

module.exports = { registerCommands };
