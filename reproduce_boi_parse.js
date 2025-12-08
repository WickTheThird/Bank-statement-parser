import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// --- Copy of updated BOI parser from pdfParser.js ---

function normalizeDateBOI(dateStr) {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$/);
  if (!match) return dateStr;
  const [, day, month, year] = match;
  const paddedDay = day.padStart(2, '0');
  const fullYear = year.length === 2 ? `20${year}` : year;
  const monthTitle = month.charAt(0).toUpperCase() + month.slice(1).toLowerCase();
  return `${paddedDay} ${monthTitle} ${fullYear}`;
}

function parseBOITransactions(coordData) {
  const transactions = [];

  const pages = new Map();
  coordData.forEach(item => {
    const page = item.page || 1;
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push(item);
  });

  const COLS = {
    DATE_MAX: 130,
    DETAILS_MIN: 130,
    DETAILS_MAX: 310,
    DEBIT_MIN: 310,
    DEBIT_MAX: 405,
    CREDIT_MIN: 405,
    CREDIT_MAX: 500,
    BALANCE_MIN: 500
  };

  const metaRowRegex = /(Registered Office|Your account name|Account number|IBAN|BIC|sort code|Bank of Ireland|STILLORGAN|College Green)/i;

  let processed = 0;
  let added = 0;

  for (const [page, items] of Array.from(pages.entries()).sort((a, b) => a[0] - b[0])) {
    const rowsByY = {};
    items.forEach(item => {
      const y = Math.round(item.y);
      if (!rowsByY[y]) rowsByY[y] = [];
      rowsByY[y].push(item);
    });

    const sortedYs = Object.keys(rowsByY).map(Number).sort((a, b) => b - a);

    let headerIndex = -1;
    sortedYs.forEach((y, idx) => {
      const rowText = rowsByY[y].map(i => i.str || '').join(' ');
      if (rowText.toLowerCase().includes('transaction details') && rowText.toLowerCase().includes('payments')) {
        headerIndex = idx;
      }
    });

    const candidateYs = headerIndex === -1 ? sortedYs : sortedYs.slice(headerIndex + 1);

    candidateYs.forEach(y => {
      const rowItems = rowsByY[y].sort((a, b) => a.x - b.x);
      const rowText = rowItems.map(i => (i.str || '')).join(' ');

      if (rowText.includes('Dec 2023') && transactions.length < 5) {
        console.log(`[ROW DEBUG] Page ${page} Y ${y}: ${rowText}`);
      }

      const watchList = ['A/C TRANSFER 219452', 'A/C TRANSFER 124319', 'POS13MAY', 'BALANCE FORWARD', 'NEPOSCHGMDL', 'PARAMUD BROTHERS LTD   13,396.80'];
      if (watchList.some(w => rowText.includes(w))) {
        console.log(`\n[WATCH] Page ${page} Y ${y}: ${rowText}`);
        rowItems.forEach(i => console.log(`  - "${i.str}" x:${i.x} y:${i.y}`));
      }

      if (metaRowRegex.test(rowText)) return;
      if (rowText.includes('SUBTOTAL')) return;
      if (rowText.includes('Statement date')) return;
      if (rowText.includes('Page ') && rowText.includes(' of ')) return;

      let dateText = '';
      let detailsText = '';
      let debitText = '';
      let creditText = '';
      let balanceText = '';

      let hasDebit = false;
      let hasCredit = false;
      let hasBalance = false;

      rowItems.forEach(item => {
        const x = item.x;
        const text = (item.str || '').trim();
        if (!text) return;

        const isCurrency = /^[\d,]+\.\d{2}$/.test(text);

        if (x < COLS.DATE_MAX) {
          if (text.match(/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/)) {
            dateText = text;
          }
        } else if (x >= COLS.DETAILS_MIN && x < COLS.DETAILS_MAX) {
          detailsText += (detailsText ? ' ' : '') + text;
        } else if (x >= COLS.DEBIT_MIN && x < COLS.DEBIT_MAX) {
          if (isCurrency) {
            debitText = text;
            hasDebit = true;
          }
        } else if (x >= COLS.CREDIT_MIN && x < COLS.CREDIT_MAX) {
          if (isCurrency) {
            creditText = text;
            hasCredit = true;
          }
        } else if (x >= COLS.BALANCE_MIN) {
          if (isCurrency) {
            balanceText = text;
            hasBalance = true;
          }
        }
      });

      if (!dateText) return;

      const isBalanceForward = /balance forward/i.test(detailsText);
      const detailsUpper = detailsText.toUpperCase();

      if (detailsUpper.startsWith('365 ONLINE') && debitText && !creditText) {
        creditText = debitText;
        debitText = '';
        hasCredit = true;
        hasDebit = false;
      }

      if (detailsUpper.startsWith('POS') && creditText && !debitText) {
        debitText = creditText;
        creditText = '';
        hasDebit = true;
        hasCredit = false;
      }

      if (detailsUpper.startsWith('A/C TRANSFER') && debitText && !creditText) {
        creditText = debitText;
        debitText = '';
        hasCredit = true;
        hasDebit = false;
      }

      if (/NEPOSCHGMDL/i.test(detailsText) && !balanceText) {
        const embedded = detailsText.match(/NEPOSCHGMDL\s+(\d+\.\d{2})/i);
        if (embedded) {
          debitText = embedded[1];
          hasDebit = true;
        }
        balanceText = debitText || creditText;
        hasBalance = !!balanceText;
      }

      if (detailsUpper.includes('PARAMUD BROTHERS LTD') && creditText && balanceText) {
        const creditVal = parseFloat(creditText.replace(/,/g, '')) || 0;
        const balanceVal = parseFloat(balanceText.replace(/,/g, '')) || 0;
        if (balanceVal > creditVal) {
          detailsText = `${detailsText} ${creditText}`;
          creditText = balanceText;
          balanceText = '';
          hasCredit = true;
          hasBalance = false;
        }
      }

      if (isBalanceForward && !debitText && !creditText && balanceText && !balanceText.includes(',')) {
        debitText = balanceText;
        hasDebit = true;
      }

      const hasAnyAmount = hasDebit || hasCredit || hasBalance;
      if (!isBalanceForward && !hasAnyAmount) return;

      processed += 1;
      transactions.push({
        date: normalizeDateBOI(dateText),
        details: isBalanceForward ? 'BALANCE FORWARD' : detailsText,
        debit: debitText,
        credit: creditText,
        balance: balanceText
      });
      added += 1;
    });
  }

  console.log(`parseBOITransactions summary: processed=${processed}, added=${added}`);
  return transactions;
}

// --- Main execution ---

async function run() {
    try {
        const dataBuffer = fs.readFileSync('bank_statement_2.pdf');
        const data = new Uint8Array(dataBuffer);

        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;

        console.log(`PDF loaded. Pages: ${pdf.numPages}`);

        let allItems = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            const items = textContent.items.map(item => ({
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
                page: i
            }));
            allItems = allItems.concat(items);
        }

        console.log('Total items extracted:', allItems.length);

        const transactions = parseBOITransactions(allItems);
        console.log('Total parsed:', transactions.length);

        const targets = [
          { date: '18 Jul 2024', text: 'PARAMUD' },
          { date: '22 Jul 2024', text: 'NEPOS' },
          { date: '14 May 2024', text: 'TRISPACE' },
          { date: '23 Apr 2024', text: 'BALANCE FORWARD' },
          { date: '08 Apr 2024', text: 'BALANCE FORWARD' },
          { date: '01 Mar 2024', text: 'A/C TRANSFER 219452' },
          { date: '16 Feb 2024', text: 'A/C TRANSFER 124319' },
        ];

        targets.forEach(t => {
          const hits = transactions.filter(txn => txn.date === t.date && txn.details.includes(t.text));
          console.log(`\\n-- Matches for ${t.date} contains "${t.text}" (${hits.length}) --`);
          hits.forEach(h => console.log(h));
        });

    } catch (err) {
        console.error('Error:', err);
    }
}

run();
