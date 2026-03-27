import * as XLSX from 'xlsx';

/**
 * Export a single statement to Excel file with proper formatting
 * @param {Array} transactions - Array of transaction objects
 * @param {string} filename - Output filename
 */
export function exportToExcel(transactions, filename = 'bank_transactions.xlsx') {
  if (!transactions || transactions.length === 0) {
    alert('No transactions to export');
    return;
  }

  const workbook = XLSX.utils.book_new();

  appendStatementSheets({
    workbook,
    transactions,
    transactionSheetName: 'Transactions',
    summarySheetName: 'Summary',
    monthlySheetName: 'Monthly Breakdown',
  });

  XLSX.writeFile(workbook, filename);

  const { totalCredit, totalDebit } = calculateTotals(transactions);
  const netAmount = totalCredit - totalDebit;

  console.log(`Excel file exported: ${filename}`);
  console.log(`Total transactions: ${transactions.length}`);
  console.log(`Total income: €${totalCredit.toFixed(2)}`);
  console.log(`Total expenses: €${totalDebit.toFixed(2)}`);
  console.log(`Net amount: €${netAmount.toFixed(2)}`);
}

/**
 * Export multiple statements into a single Excel workbook
 * @param {Array<{transactions: Array, label?: string}>} statements
 * @param {string} filename
 * @param {Object} options - Export options
 * @param {boolean} options.singleSheet - If true, merge all transactions into one sheet (default: true)
 */
export function exportMultipleStatements(statements, filename = 'bank_statements.xlsx', options = {}) {
  const { singleSheet = true } = options;

  const validStatements = (statements || []).filter(
    (statement) => statement.transactions && statement.transactions.length > 0,
  );

  if (validStatements.length === 0) {
    alert('No parsed statements to export');
    return;
  }

  const workbook = XLSX.utils.book_new();

  if (singleSheet) {
    // Merge all transactions into a single sheet with source file column
    const allTransactions = [];
    validStatements.forEach((statement) => {
      const sourceLabel = statement.label || 'Unknown';
      statement.transactions.forEach(txn => {
        allTransactions.push({
          ...txn,
          source: sourceLabel,
        });
      });
    });

    // Sort all transactions by date
    allTransactions.sort((a, b) => {
      const parseDate = (dateStr) => {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          return new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
        }
        return new Date(dateStr);
      };
      return parseDate(a.date) - parseDate(b.date);
    });

    const transactionSheet = createTransactionSheet(allTransactions, true);
    XLSX.utils.book_append_sheet(workbook, transactionSheet, 'All Transactions');

    const summarySheet = createSummarySheet(allTransactions);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    const monthlyData = generateMonthlyBreakdown(allTransactions);
    if (monthlyData.length > 0) {
      const monthlySheet = createMonthlySheet(monthlyData);
      XLSX.utils.book_append_sheet(workbook, monthlySheet, 'Monthly Breakdown');
    }
  } else {
    // Create separate sheets for each statement
    const usedSheetNames = new Set();

    validStatements.forEach((statement, index) => {
      const baseName = makeUniqueSheetBaseName(
        sanitizeSheetName(statement.label || `Statement ${index + 1}`),
        usedSheetNames,
      );

      appendStatementSheets({
        workbook,
        transactions: statement.transactions,
        transactionSheetName: `${baseName} - Txns`,
        summarySheetName: `${baseName} - Summary`,
        monthlySheetName: `${baseName} - Monthly`,
      });
    });
  }

  XLSX.writeFile(workbook, filename);
}

/**
 * Build all sheets for a single statement and add them to a workbook
 */
function appendStatementSheets({
  workbook,
  transactions,
  transactionSheetName,
  summarySheetName,
  monthlySheetName,
}) {
  const transactionSheet = createTransactionSheet(transactions, false);
  XLSX.utils.book_append_sheet(workbook, transactionSheet, transactionSheetName);

  const summarySheet = createSummarySheet(transactions);
  XLSX.utils.book_append_sheet(workbook, summarySheet, summarySheetName);

  const monthlyData = generateMonthlyBreakdown(transactions);
  if (monthlyData.length > 0) {
    const monthlySheet = createMonthlySheet(monthlyData);
    XLSX.utils.book_append_sheet(workbook, monthlySheet, monthlySheetName);
  }
}

function createTransactionSheet(transactions, includeSource = false) {
  const transactionData = formatTransactions(transactions, includeSource);
  const ws = XLSX.utils.json_to_sheet(transactionData);

  if (includeSource) {
    ws['!cols'] = [
      { wch: 12 },  // Date
      { wch: 25 },  // Source
      { wch: 50 },  // Details
      { wch: 15 },  // Debit
      { wch: 15 },  // Credit
      { wch: 15 },  // Balance
    ];
    ws['!autofilter'] = { ref: `A1:F${transactionData.length + 1}` };
  } else {
    ws['!cols'] = [
      { wch: 12 },  // Date
      { wch: 60 },  // Details
      { wch: 15 },  // Debit
      { wch: 15 },  // Credit
      { wch: 15 },  // Balance
    ];
    ws['!autofilter'] = { ref: `A1:E${transactionData.length + 1}` };
  }

  return ws;
}

function createSummarySheet(transactions) {
  const summaryData = formatSummary(transactions);
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);

  summaryWs['!cols'] = [
    { wch: 30 },  // Metric
    { wch: 25 },  // Value
  ];

  return summaryWs;
}

function createMonthlySheet(monthlyData) {
  const monthlyWs = XLSX.utils.json_to_sheet(monthlyData);
  monthlyWs['!cols'] = [
    { wch: 15 },  // Month
    { wch: 15 },  // Count
    { wch: 15 },  // Income
    { wch: 15 },  // Expenses
    { wch: 15 },  // Net
  ];
  return monthlyWs;
}

function formatTransactions(transactions, includeSource = false) {
  return transactions.map(txn => {
    const row = {
      Date: txn.date || '',
    };

    if (includeSource) {
      row['Source'] = txn.source || '';
    }

    row['Details'] = txn.details || '';

    // Export as actual numbers for formula support (null for empty cells)
    row['Debit (€)'] = txn.debit && parseFloat(txn.debit) > 0 ? parseFloat(txn.debit) : null;
    row['Credit (€)'] = txn.credit && parseFloat(txn.credit) > 0 ? parseFloat(txn.credit) : null;
    row['Balance (€)'] = txn.balance && parseFloat(txn.balance) !== 0 ? parseFloat(txn.balance) : null;

    return row;
  });
}

function formatSummary(transactions) {
  const { totalCredit, totalDebit } = calculateTotals(transactions);
  const netAmount = totalCredit - totalDebit;

  const dates = transactions.map(t => t.date).filter(Boolean).sort();
  const startDate = dates[0] || '';
  const endDate = dates[dates.length - 1] || '';

  return [
    { Metric: 'Statement Period', Value: `${startDate} to ${endDate}` },
    { Metric: 'Total Transactions', Value: transactions.length },
    { Metric: 'Total Income (€)', Value: totalCredit },
    { Metric: 'Total Expenses (€)', Value: totalDebit },
    { Metric: 'Net Amount (€)', Value: netAmount },
    { Metric: 'Average Transaction (€)', Value: (totalCredit + totalDebit) / transactions.length },
  ];
}

function calculateTotals(transactions) {
  const totalDebit = transactions
    .filter(t => t.debit && parseFloat(t.debit) > 0)
    .reduce((sum, t) => sum + parseFloat(t.debit), 0);

  const totalCredit = transactions
    .filter(t => t.credit && parseFloat(t.credit) > 0)
    .reduce((sum, t) => sum + parseFloat(t.credit), 0);

  return { totalDebit, totalCredit };
}

/**
 * Generate monthly breakdown of transactions
 */
function generateMonthlyBreakdown(transactions) {
  const monthlyMap = new Map();

  for (const txn of transactions) {
    if (!txn.date) continue;

    // Parse DD/MM/YYYY format
    let date;
    const parts = txn.date.split('/');
    if (parts.length === 3) {
      date = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
    } else {
      date = new Date(txn.date);
    }

    if (isNaN(date.getTime())) continue;

    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthName = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

    if (!monthlyMap.has(yearMonth)) {
      monthlyMap.set(yearMonth, {
        month: monthName,
        count: 0,
        income: 0,
        expenses: 0,
      });
    }

    const data = monthlyMap.get(yearMonth);
    data.count++;

    if (txn.credit && parseFloat(txn.credit) > 0) {
      data.income += parseFloat(txn.credit);
    }

    if (txn.debit && parseFloat(txn.debit) > 0) {
      data.expenses += parseFloat(txn.debit);
    }
  }

  return Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([_, data]) => ({
      Month: data.month,
      'Transaction Count': data.count,
      'Income (€)': data.income,
      'Expenses (€)': data.expenses,
      'Net (€)': data.income - data.expenses,
    }));
}

function sanitizeSheetName(name) {
  const cleaned = name.replace(/[\\/?*[\]:]/g, '').trim() || 'Sheet';
  return cleaned.slice(0, 31);
}

function makeUniqueSheetBaseName(name, usedNames) {
  let candidate = name;
  let counter = 1;

  while (usedNames.has(candidate)) {
    const suffix = ` (${counter})`;
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

