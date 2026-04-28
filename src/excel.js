const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { getReportsForMonth } = require('./db');
const { getMonthName, getAdminUserIds } = require('./messages');

async function generateExcel(month, year) {
  const reports = getReportsForMonth(month, year);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HR Monthly Bot';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`${getMonthName(month)} ${year}`);

  // Define columns
  sheet.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Sick Days', key: 'sick', width: 14 },
    { header: 'Vacation Days', key: 'vacation', width: 16 },
    { header: 'Child Sick Days', key: 'child_sick', width: 18 },
    { header: 'Reserve Duty Days', key: 'reserve_duty', width: 20 },
    { header: 'Submitted Date', key: 'submitted', width: 22 }
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5090' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 28;

  // Add data rows
  for (const report of reports) {
    const submittedDate = new Date(report.submitted_at).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    sheet.addRow({
      name: report.user_name,
      sick: report.sick_days,
      vacation: report.vacation_days,
      child_sick: report.child_sick_days,
      reserve_duty: report.reserve_duty_days,
      submitted: submittedDate
    });
  }

  // Style data rows with alternating colors
  for (let i = 2; i <= reports.length + 1; i++) {
    const row = sheet.getRow(i);
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    if (i % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6FC' } };
    }
  }

  // Add summary row
  const summaryRowNum = reports.length + 3;
  const summaryRow = sheet.getRow(summaryRowNum);
  summaryRow.getCell(1).value = 'TOTAL';
  summaryRow.getCell(1).font = { bold: true, size: 11 };

  if (reports.length > 0) {
    summaryRow.getCell(2).value = { formula: `SUM(B2:B${reports.length + 1})` };
    summaryRow.getCell(3).value = { formula: `SUM(C2:C${reports.length + 1})` };
    summaryRow.getCell(4).value = { formula: `SUM(D2:D${reports.length + 1})` };
    summaryRow.getCell(5).value = { formula: `SUM(E2:E${reports.length + 1})` };
  }

  summaryRow.font = { bold: true, size: 11 };
  summaryRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  summaryRow.alignment = { horizontal: 'center', vertical: 'middle' };

  // Add borders to all data cells
  const borderStyle = { style: 'thin', color: { argb: 'FFB0B0B0' } };
  const border = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };
  for (let i = 1; i <= reports.length + 1; i++) {
    const row = sheet.getRow(i);
    for (let j = 1; j <= 6; j++) {
      row.getCell(j).border = border;
    }
  }

  // Save file
  const dir = process.env.EXPORTS_PATH || path.join(__dirname, '..', 'data', 'exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `HR_Report_${getMonthName(month)}_${year}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  console.log(`[EXCEL] Generated report: ${filePath} (${reports.length} entries)`);
  return filePath;
}

async function generateAndSendExcel(client, month, year) {
  const filePath = await generateExcel(month, year);
  const adminUserIds = getAdminUserIds();

  if (adminUserIds.length === 0) {
    console.error('[EXCEL] ADMIN_USER_ID is not configured — cannot send Excel report');
    return null;
  }

  for (const adminId of adminUserIds) {
    try {
      const dm = await client.conversations.open({ users: adminId });
      await client.files.uploadV2({
        channel_id: dm.channel.id,
        file: filePath,
        filename: path.basename(filePath),
        title: `HR Report - ${getMonthName(month)} ${year}`,
        initial_comment: `📊 Here is the monthly HR report for *${getMonthName(month)} ${year}*.`
      });
      console.log(`[EXCEL] Sent report to admin: ${adminId}`);
    } catch (err) {
      console.error(`[EXCEL] Failed to send report to admin ${adminId}: ${err.message}`);
    }
  }

  return { filePath, adminUserIds };
}

module.exports = { generateExcel, generateAndSendExcel };
