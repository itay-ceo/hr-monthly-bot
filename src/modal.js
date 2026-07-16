// Track users currently uploading receipts: userId -> { month, year, expenseAmount }
const receiptUploadSessions = new Map();

function buildReportModal(month, year, showExpenseAmount = false) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 Report for ${require('./messages').getMonthName(month)} ${year}` }
    },
    {
      type: 'input',
      block_id: 'sick_days_block',
      label: { type: 'plain_text', text: 'Sick Days' },
      element: {
        type: 'number_input',
        action_id: 'sick_days',
        is_decimal_allowed: true,
        min_value: '0',
        placeholder: { type: 'plain_text', text: 'Enter number of sick days' }
      }
    },
    {
      type: 'input',
      block_id: 'vacation_days_block',
      label: { type: 'plain_text', text: 'Vacation Days' },
      element: {
        type: 'number_input',
        action_id: 'vacation_days',
        is_decimal_allowed: true,
        min_value: '0',
        placeholder: { type: 'plain_text', text: 'Enter number of vacation days' }
      }
    },
    {
      type: 'input',
      block_id: 'child_sick_days_block',
      label: { type: 'plain_text', text: 'Child Sick Days (ימי מחלת ילד)' },
      element: {
        type: 'number_input',
        action_id: 'child_sick_days',
        is_decimal_allowed: true,
        min_value: '0',
        placeholder: { type: 'plain_text', text: 'Enter number of child sick days' }
      }
    },
    {
      type: 'input',
      block_id: 'reserve_duty_days_block',
      label: { type: 'plain_text', text: 'Reserve Duty Days (ימי מילואים)' },
      element: {
        type: 'number_input',
        action_id: 'reserve_duty_days',
        is_decimal_allowed: true,
        min_value: '0',
        placeholder: { type: 'plain_text', text: 'Enter number of reserve duty days' }
      }
    },
    { type: 'divider' },
    {
      type: 'input',
      block_id: 'expenses_check_block',
      optional: true,
      dispatch_action: true,
      label: { type: 'plain_text', text: 'Expenses' },
      element: {
        type: 'checkboxes',
        action_id: 'has_expenses',
        options: [{
          text: { type: 'plain_text', text: 'I have expenses to reimburse' },
          value: 'has_expenses'
        }],
        ...(showExpenseAmount ? {
          initial_options: [{
            text: { type: 'plain_text', text: 'I have expenses to reimburse' },
            value: 'has_expenses'
          }]
        } : {})
      }
    }
  ];

  if (showExpenseAmount) {
    blocks.push({
      type: 'input',
      block_id: 'expense_amount_block',
      label: { type: 'plain_text', text: 'Total Expense Amount (₪)' },
      element: {
        type: 'number_input',
        action_id: 'expense_amount',
        is_decimal_allowed: true,
        min_value: '0',
        placeholder: { type: 'plain_text', text: 'Enter total expense amount in ₪' }
      }
    });
  }

  return {
    type: 'modal',
    callback_id: 'report_modal_submit',
    title: { type: 'plain_text', text: 'Monthly Report' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: JSON.stringify({ month, year }),
    blocks
  };
}

function registerModalHandlers(app) {
  // Open modal when button is clicked
  app.action('open_report_modal', async ({ ack, body, client }) => {
    await ack();

    const { month, year } = JSON.parse(body.actions[0].value);
    const modal = buildReportModal(month, year);

    await client.views.open({
      trigger_id: body.trigger_id,
      view: modal
    });
  });

  // Toggle expense amount field when checkbox changes
  app.action('has_expenses', async ({ ack, body, client }) => {
    await ack();
    const { month, year } = JSON.parse(body.view.private_metadata);
    const checked = body.actions[0].selected_options.length > 0;

    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: buildReportModal(month, year, checked)
    });
  });

  // Handle modal submission
  app.view('report_modal_submit', async ({ ack, body, view, client }) => {
    await ack();

    const { month, year } = JSON.parse(view.private_metadata);
    const values = view.state.values;

    const sickDays = parseFloat(values.sick_days_block.sick_days.value);
    const vacationDays = parseFloat(values.vacation_days_block.vacation_days.value);
    const childSickDays = parseFloat(values.child_sick_days_block.child_sick_days.value);
    const reserveDutyDays = parseFloat(values.reserve_duty_days_block.reserve_duty_days.value);

    const expensesSelected = values.expenses_check_block?.has_expenses?.selected_options || [];
    const hasExpenses = expensesSelected.some(o => o.value === 'has_expenses');
    const expenseAmount = hasExpenses && values.expense_amount_block?.expense_amount?.value
      ? parseFloat(values.expense_amount_block.expense_amount.value) : 0;

    const userId = body.user.id;

    // Fetch real name from Slack API
    let userName = body.user.name;
    try {
      const userInfo = await client.users.info({ user: userId });
      userName = userInfo.user.real_name || userInfo.user.name;
    } catch (err) {
      console.error(`[MODAL] Failed to fetch user info for ${userId}: ${err.message}`);
    }

    const { saveReport } = require('./db');
    saveReport({ userId, userName, month, year, sickDays, vacationDays, childSickDays, reserveDutyDays, hasExpenses, expenseAmount });

    console.log(`[MODAL] Report saved for ${userName} (${month}/${year})${hasExpenses ? ` with expenses ₪${expenseAmount}` : ''}`);

    let confirmationText = `✅ Report received, thank you!\n• Sick Days: ${sickDays}\n• Vacation Days: ${vacationDays}\n• Child Sick Days: ${childSickDays}\n• Reserve Duty Days: ${reserveDutyDays}`;

    if (hasExpenses) {
      confirmationText += `\n• Expenses: ₪${expenseAmount}`;
      confirmationText += `\n\n📎 You'll receive a DM shortly to upload your receipt photos.`;
    }

    await client.chat.postMessage({
      channel: userId,
      text: confirmationText
    });

    if (hasExpenses) {
      receiptUploadSessions.set(userId, { month, year, expenseAmount });

      await client.chat.postMessage({
        channel: userId,
        text: `📸 Please upload your receipt photos one by one. Type 'done' when you've uploaded all receipts.`
      });
    }
  });
}

module.exports = { buildReportModal, registerModalHandlers, receiptUploadSessions };
