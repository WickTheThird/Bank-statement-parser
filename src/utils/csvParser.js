import Papa from 'papaparse';

/**
 * Parse bank statement CSV and extract transactions
 * @param {File} file - The CSV file to parse
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<{bankType: string, transactions: Array}>}
 */
export async function parseCSV(file, progressCallback) {
  return new Promise((resolve, reject) => {
    progressCallback?.('Loading CSV file...');

    Papa.parse(file, {
      complete: (results) => {
        try {
          progressCallback?.('Processing CSV data...');

          const data = results.data;

          if (!data || data.length === 0) {
            throw new Error('CSV file is empty or could not be read');
          }

          progressCallback?.('Detecting bank type...');

          // Detect bank type
          const bankType = detectBankFromCSV(data);

          progressCallback?.(`Parsing ${bankType} transactions...`);

          // Parse transactions
          const transactions = parseCSVTransactions(data, bankType);

          if (transactions.length === 0) {
            throw new Error('No valid transactions found in CSV file');
          }

          progressCallback?.('Normalizing dates and sorting...');

          // Normalize dates to ISO format
          const normalizedTransactions = transactions.map(txn => ({
            ...txn,
            date: normalizeDate(txn.date),
          }));

          // Sort by date (ascending) - handle DD/MM/YYYY format
          normalizedTransactions.sort((a, b) => {
            const parseRomanianDate = (dateStr) => {
              const parts = dateStr.split('/');
              if (parts.length === 3) {
                return new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
              }
              return new Date(dateStr);
            };

            const dateA = parseRomanianDate(a.date);
            const dateB = parseRomanianDate(b.date);
            return dateA - dateB;
          });

          progressCallback?.('Removing duplicates...');

          // Remove duplicates
          const uniqueTransactions = removeDuplicates(normalizedTransactions);

          resolve({
            bankType,
            transactions: uniqueTransactions,
          });
        } catch (error) {
          console.error('CSV parsing error:', error);
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        }
      },
      error: (error) => {
        console.error('CSV file error:', error);
        reject(new Error(`Failed to read CSV file: ${error.message}`));
      },
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
  });
}

/**
 * Detect bank type from CSV data
 */
function detectBankFromCSV(data) {
  if (!data || data.length === 0) return 'Unknown';

  // Check first 10 rows for bank identifiers
  const searchText = data
    .slice(0, 10)
    .flat()
    .join(' ')
    .toLowerCase();

  if (searchText.includes('aib') || searchText.includes('allied irish')) {
    return 'AIB';
  } else if (searchText.includes('bank of ireland') || searchText.includes('boi')) {
    return 'Bank of Ireland';
  } else if (searchText.includes('revolut')) {
    return 'Revolut';
  }

  return 'Unknown';
}

/**
 * Parse CSV transactions
 */
function parseCSVTransactions(data, bankType) {
  const transactions = [];

  // Find header row
  let headerIndex = -1;
  const possibleHeaders = [
    'date', 'description', 'details', 'narrative',
    'debit', 'credit', 'balance', 'amount',
    'transaction', 'type', 'reference'
  ];

  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const rowLower = row.map(cell => String(cell || '').toLowerCase().trim());

    // Check if this row has header keywords
    const headerCount = possibleHeaders.filter(header =>
      rowLower.some(cell => cell.includes(header))
    ).length;

    // If at least 2 headers found, this is likely the header row
    if (headerCount >= 2) {
      headerIndex = i;
      break;
    }
  }

  // If no header found, assume first row is header
  if (headerIndex === -1) {
    headerIndex = 0;
  }

  const headers = data[headerIndex].map(h => String(h || '').toLowerCase().trim());

  // Map column indices with multiple possible names
  const dateIdx = findColumnIndex(headers, ['date', 'transaction date', 'posted date', 'value date']);
  const detailsIdx = findColumnIndex(headers, ['detail', 'description', 'narrative', 'memo', 'transaction']);
  const debitIdx = findColumnIndex(headers, ['debit', 'paid out', 'withdrawal', 'payment', 'money out']);
  const creditIdx = findColumnIndex(headers, ['credit', 'paid in', 'deposit', 'lodgement', 'money in']);
  const balanceIdx = findColumnIndex(headers, ['balance', 'running balance', 'available balance']);
  const amountIdx = findColumnIndex(headers, ['amount', 'value', 'transaction amount']);

  // Validate that we have at least date and one monetary column
  if (dateIdx === -1 || (debitIdx === -1 && creditIdx === -1 && amountIdx === -1 && balanceIdx === -1)) {
    throw new Error('Could not identify required columns (Date and Amount) in CSV file');
  }

  // Parse data rows
  for (let i = headerIndex + 1; i < data.length; i++) {
    const row = data[i];

    // Skip empty or invalid rows
    if (!row || row.length < 2) continue;

    const date = dateIdx >= 0 ? String(row[dateIdx] || '').trim() : '';

    // Skip rows without dates (likely summary rows)
    if (!date || date.toLowerCase().includes('total') || date.toLowerCase().includes('balance')) {
      continue;
    }

    const details = detailsIdx >= 0 ? String(row[detailsIdx] || '').trim() : '';

    // Handle different CSV formats
    let debit = '';
    let credit = '';
    let balance = '';

    // If CSV has separate debit/credit columns
    if (debitIdx >= 0 || creditIdx >= 0) {
      debit = debitIdx >= 0 ? cleanAmount(row[debitIdx]) : '';
      credit = creditIdx >= 0 ? cleanAmount(row[creditIdx]) : '';
    }
    // If CSV has single amount column (e.g., Revolut)
    else if (amountIdx >= 0) {
      const amount = cleanAmount(row[amountIdx]);
      const numAmount = parseFloat(amount);

      if (!isNaN(numAmount)) {
        if (numAmount < 0) {
          debit = Math.abs(numAmount).toFixed(2);
        } else if (numAmount > 0) {
          credit = numAmount.toFixed(2);
        }
      }
    }

    balance = balanceIdx >= 0 ? cleanAmount(row[balanceIdx]) : '';

    // Only add transaction if it has meaningful data
    if (date && (details || debit || credit || balance)) {
      transactions.push({
        date,
        details: details || 'Transaction',
        debit,
        credit,
        balance,
      });
    }
  }

  return transactions;
}

/**
 * Find column index by checking multiple possible header names
 */
function findColumnIndex(headers, possibleNames) {
  for (const name of possibleNames) {
    const index = headers.findIndex(h => h.includes(name));
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Clean and normalize monetary amounts
 */
function cleanAmount(value) {
  if (!value) return '';

  // Convert to string and clean
  let str = String(value)
    .replace(/[€$£,\s]/g, '') // Remove currency symbols, commas, and spaces
    .replace(/^[()]+|[()]+$/g, '') // Remove leading/trailing parentheses
    .trim();

  // Handle negative values in parentheses (e.g., "(100.50)")
  if (String(value).includes('(') && String(value).includes(')')) {
    str = '-' + str;
  }

  // Check if it's a valid number
  const num = parseFloat(str);
  if (!isNaN(num)) {
    return Math.abs(num).toFixed(2);
  }

  return '';
}

/**
 * Normalize date to Romanian format (DD/MM/YYYY)
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';

  // Try different date formats
  const formats = [
    // DD/MM/YYYY (already Romanian format)
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    // DD-MM-YYYY
    /(\d{1,2})-(\d{1,2})-(\d{4})/,
    // YYYY-MM-DD (ISO format)
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
    // YYYY/MM/DD
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
    // DD MMM YYYY
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
    // DD-MMM-YYYY
    /(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*-(\d{4})/i,
    // DD MMM YY
    /(\d{2})\s+([A-Za-z]{3})\s+(\d{2})/,
  ];

  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  for (let i = 0; i < formats.length; i++) {
    const format = formats[i];
    const match = dateStr.match(format);

    if (match) {
      if (i === 0 || i === 1) {
        // DD/MM/YYYY or DD-MM-YYYY (already Romanian format)
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = match[3];
        return `${day}/${month}/${year}`;
      } else if (i === 2 || i === 3) {
        // YYYY-MM-DD or YYYY/MM/DD - convert to DD/MM/YYYY
        const year = match[1];
        const month = match[2].padStart(2, '0');
        const day = match[3].padStart(2, '0');
        return `${day}/${month}/${year}`;
      } else if (i === 4 || i === 5) {
        // DD MMM YYYY or DD-MMM-YYYY
        const day = match[1].padStart(2, '0');
        const month = monthMap[match[2].toLowerCase().substring(0, 3)];
        const year = match[3];
        return `${day}/${month}/${year}`;
      } else if (i === 6) {
        // DD MMM YY
        const day = match[1].padStart(2, '0');
        const month = monthMap[match[2].toLowerCase().substring(0, 3)];
        let year = match[3];
        // Handle 2-digit years
        year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
        return `${day}/${month}/${year}`;
      }
    }
  }

  // Try parsing with JavaScript Date
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${day}/${month}/${year}`;
    }
  } catch (e) {
    // Ignore parsing errors
  }

  // If no format matched, return original
  return dateStr;
}

/**
 * Remove duplicate transactions
 */
function removeDuplicates(transactions) {
  const seen = new Set();
  const unique = [];

  for (const txn of transactions) {
    // Create a unique key based on date, amount, and description
    const key = `${txn.date}|${txn.details.substring(0, 50)}|${txn.debit}|${txn.credit}|${txn.balance}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(txn);
    }
  }

  return unique;
}
